"""气衡 M06 · 只读数据服务（Python 标准库 sqlite3 + http.server）。

安全与边界：
  · 仅绑定 loopback（默认 127.0.0.1），不裸露公网。
  · 本地能力令牌（X-QH-Capability）用常量时间比较；令牌只从环境变量读，不写日志。
  · 精确 Origin 检查：带 Origin 的请求必须命中白名单，否则 403；绝不返回 CORS *。
  · 请求体大小上限（默认 1 MiB）。
  · 不记录请求体/令牌；日志仅 method + path（去掉 query）+ status。

路由（同时接受去掉/保留 /api/qh-data 前缀）：
  GET  /health
  POST /batches?format=csv|json&filename=...
  GET  /batches
  GET  /batches/{id}
  GET  /batches/{id}/observations
  GET  /batches/{id}/quality
  GET  /sources/{id}/state
"""

from __future__ import annotations

import csv
import hmac
import io
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import store as store_mod  # noqa: E402
from store import Store, utc_now_iso  # noqa: E402
from validate import validate_records, RULE_VERSION  # noqa: E402

PREFIX = "/api/qh-data"


def _batch_out(b: dict) -> dict:
    return {
        "id": b["id"], "sourceId": b["source_id"], "entity": b["entity"],
        "format": b["format"], "filename": b["filename"], "ruleVersion": b["rule_version"],
        "receivedAt": b["received_at"], "totalRows": b["total_rows"], "validRows": b["valid_rows"],
        "isolatedRows": b["isolated_rows"], "rejectedRows": b["rejected_rows"],
        "status": b["status"], "unordered": bool(b["unordered"]), "note": b["note"],
    }


def _obs_out(o: dict) -> dict:
    return {
        "id": o["id"], "batchId": o["batch_id"], "sourceId": o["source_id"], "entity": o["entity"],
        "metric": o["metric"], "value": o["value"], "unit": o["unit"],
        "observedAt": o["observed_at"], "receivedAt": o["received_at"],
        "quality": o["quality"], "reason": o["reason"],
    }


EVENT_TYPES = {"import_completed", "rows_isolated", "rows_rejected", "service_error"}
EVENT_SEVERITIES = {"info", "warn", "error"}


def _event_out(e: dict) -> dict:
    reasons = None
    if e.get("reasons"):
        try:
            reasons = json.loads(e["reasons"])
        except (TypeError, ValueError):
            reasons = None
    return {
        "eventId": e["event_id"], "sourceId": e["source_id"], "batchId": e["batch_id"],
        "type": e["type"], "severity": e["severity"], "occurredAt": e["occurred_at"],
        "receivedAt": e["received_at"], "ruleVersion": e["rule_version"],
        "reasons": reasons, "detail": e["detail"],
    }


class Config:
    def __init__(self):
        self.host = os.environ.get("QH_DATA_HOST", "127.0.0.1")
        self.port = int(os.environ.get("QH_DATA_PORT", "4203"))
        self.token = os.environ.get("QH_DATA_TOKEN", "")
        self.db_path = os.environ.get(
            "QH_DATA_DB",
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "var", "qh-data.sqlite3"),
        )
        self.max_body = int(os.environ.get("QH_DATA_MAX_BODY", str(1024 * 1024)))
        origins = os.environ.get(
            "QH_DATA_ALLOWED_ORIGINS",
            # 精确枚举：M06b 4202 / M07 4205 / M08 4208 候选 HTTPS 公网 Origin + 必要本地 dev。
            # 不使用通配、不放行整个 .cosmoplat.cn、不做无条件 Origin 重写。
            "https://4220-a1db149b692927f8.code.cosmoplat.cn,https://4217-a1db149b692927f8.code.cosmoplat.cn,https://4214-a1db149b692927f8.code.cosmoplat.cn,"
            "https://4211-a1db149b692927f8.code.cosmoplat.cn,"
            "https://4208-a1db149b692927f8.code.cosmoplat.cn,"
            "https://4205-a1db149b692927f8.code.cosmoplat.cn,"
            "https://4202-a1db149b692927f8.code.cosmoplat.cn,"
            "http://127.0.0.1:4220,http://localhost:4220,http://127.0.0.1:4217,http://localhost:4217,http://127.0.0.1:4214,http://localhost:4214,"
            "http://127.0.0.1:4211,http://localhost:4211,"
            "http://127.0.0.1:4208,http://localhost:4208,"
            "http://127.0.0.1:4205,http://localhost:4205,"
            "http://127.0.0.1:4202,http://localhost:4202",
        )
        self.allowed_origins = {o.strip() for o in origins.split(",") if o.strip()}
        self.stale_ms = int(os.environ.get("QH_DATA_STALE_MS", str(15 * 60 * 1000)))


def make_handler(cfg: Config, store: Store):
    class Handler(BaseHTTPRequestHandler):
        server_version = "QHReadonlyData/1.0"
        protocol_version = "HTTP/1.1"

        # ── 日志：仅 method + path（去 query）+ status，不含头/体/令牌 ──
        def log_request(self, code="-", size="-"):
            try:
                sys.stderr.write("[qh-data] %s %s %s\n" % (self.command, self.path.split("?")[0], code))
            except Exception:
                pass

        def log_message(self, fmt, *args):  # noqa: A003
            return

        # ── 响应工具 ────────────────────────────────────────
        def _send_json(self, code: int, payload: dict, origin_allowed: str | None = None, close: bool = False):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if close:
                self.close_connection = True
                self.send_header("Connection", "close")
            if origin_allowed:
                # 只回显命中的精确 Origin，绝不使用 *
                self.send_header("Access-Control-Allow-Origin", origin_allowed)
                self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(body)

        def _origin_ok(self) -> str | None:
            """返回允许回显的 Origin；None 表示无 Origin（非浏览器）或允许但无需回显。"""
            origin = self.headers.get("Origin")
            if origin is None:
                return None
            if origin in cfg.allowed_origins:
                return origin
            return "DENY"

        def _authorized(self) -> bool:
            got = self.headers.get("X-QH-Capability", "")
            return bool(cfg.token) and hmac.compare_digest(got, cfg.token)

        def _reject(self, code: int, reason: str, origin):
            if origin == "DENY":
                self._send_json(403, {"error": "origin_not_allowed", "reason": reason})
            elif code == 401:
                self._send_json(401, {"error": "unauthorized", "reason": reason})
            else:
                self._send_json(code, {"error": reason})

        # ── 路由 ────────────────────────────────────────────
        def do_OPTIONS(self):  # noqa: N802
            origin = self._origin_ok()
            if origin == "DENY":
                return self._send_json(403, {"error": "origin_not_allowed"})
            self.send_response(204)
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-QH-Capability")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):  # noqa: N802
            self._handle("GET")

        def do_POST(self):  # noqa: N802
            self._handle("POST")

        def _handle(self, method: str):
            parsed = urlparse(self.path)
            path = parsed.path
            if path.startswith(PREFIX):
                path = path[len(PREFIX):] or "/"
            query = parse_qs(parsed.query)

            origin = self._origin_ok()
            if origin == "DENY":
                return self._send_json(403, {"error": "origin_not_allowed"})

            if path == "/health" and method == "GET":
                if not self._authorized():
                    return self._send_json(401, {"error": "unauthorized"}, origin)
                return self._send_json(200, {
                    "status": "ok", "service": "qh-readonly-data",
                    "schemaVersion": store.schema_version(),
                    "time": utc_now_iso(), "ruleVersion": RULE_VERSION,
                }, origin)

            if not self._authorized():
                return self._send_json(401, {"error": "unauthorized"}, origin)

            try:
                if path == "/batches" and method == "POST":
                    return self._post_batch(query, origin)
                if path == "/batches" and method == "GET":
                    limit = min(200, int(query.get("limit", ["50"])[0]))
                    offset = max(0, int(query.get("offset", ["0"])[0]))
                    rows, total = store.list_batches(limit, offset)
                    return self._send_json(200, {"items": [_batch_out(r) for r in rows], "total": total}, origin)
                if path.startswith("/batches/"):
                    parts = [unquote(p) for p in path.strip("/").split("/")]
                    # /batches/{id}[, /observations, /quality]
                    batch_id = parts[1] if len(parts) > 1 else ""
                    sub = parts[2] if len(parts) > 2 else None
                    if sub is None and method == "GET":
                        b = store.get_batch(batch_id)
                        if not b:
                            return self._send_json(404, {"error": "batch_not_found"}, origin)
                        return self._send_json(200, _batch_out(b), origin)
                    if sub == "observations" and method == "GET":
                        limit = min(500, int(query.get("limit", ["200"])[0]))
                        offset = max(0, int(query.get("offset", ["0"])[0]))
                        rows, total = store.get_observations(batch_id, limit, offset)
                        return self._send_json(200, {"items": [_obs_out(r) for r in rows], "total": total}, origin)
                    if sub == "quality" and method == "GET":
                        q = store.get_quality(batch_id)
                        if not q:
                            return self._send_json(404, {"error": "batch_not_found"}, origin)
                        q = dict(q)
                        q["rejections"] = [
                            {"rowIndex": r["row_index"], "reason": r["reason"], "raw": r["raw"]}
                            for r in q["rejections"]
                        ]
                        return self._send_json(200, q, origin)
                if path.startswith("/sources/") and path.endswith("/state") and method == "GET":
                    source_id = unquote(path.strip("/").split("/")[1])
                    store.touch_heartbeat(source_id)
                    return self._send_json(200, store.get_source_state(source_id), origin)
                if path == "/events" and method == "GET":
                    return self._get_events(query, origin)
                if path == "/events" and method != "GET":
                    return self._send_json(405, {"error": "method_not_allowed"}, origin)
                if path.startswith("/events/"):
                    parts = [unquote(p) for p in path.strip("/").split("/")]
                    if len(parts) == 2 and method == "GET":
                        e = store.get_event(parts[1])
                        if not e:
                            return self._send_json(404, {"error": "event_not_found"}, origin)
                        return self._send_json(200, _event_out(e), origin)
            except ValueError:
                return self._send_json(400, {"error": "bad_request"}, origin)
            except Exception as exc:  # noqa: BLE001
                sys.stderr.write("[qh-data] internal_error: %s\n" % type(exc).__name__)
                try:
                    store.record_service_error(
                        source_id=(query.get("sourceId", [""])[0] or None),
                        error_type=type(exc).__name__, rule_version=RULE_VERSION,
                    )
                except Exception:
                    pass
                return self._send_json(500, {"error": "internal_error"}, origin)

            return self._send_json(404, {"error": "not_found"}, origin)

        # ── GET /events（受控筛选/分页；非法参数明确 400）──────────
        _EVENT_QUERY_KEYS = {"limit", "offset", "sourceId", "type", "severity", "since", "until"}
        _EVENT_LIMIT_MAX = 100
        _EVENT_OFFSET_MAX = 1_000_000

        def _get_events(self, query, origin):
            for key in query:
                if key not in self._EVENT_QUERY_KEYS:
                    return self._send_json(400, {"error": "bad_request", "reason": f"unknown_param:{key}"}, origin)

            def _int(name, default, lo, hi):
                raw = query.get(name, [str(default)])[0]
                try:
                    v = int(raw)
                except ValueError:
                    raise ValueError(f"bad_param:{name}")
                if v < lo or v > hi:
                    raise ValueError(f"range_param:{name}")
                return v

            def _time(name):
                raw = query.get(name, [""])[0]
                if not raw:
                    return None
                s = raw.strip()
                if s.endswith(("Z", "z")):
                    s = s[:-1] + "+00:00"
                try:
                    from datetime import datetime as _dt, timezone as _tz
                    dt = _dt.fromisoformat(s)
                except ValueError:
                    raise ValueError(f"bad_param:{name}")
                if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
                    raise ValueError(f"bad_param:{name}")
                # 归一化为与存储同口径的 UTC 'Z' 文本（保证字符串区间比较正确）
                return dt.astimezone(_tz.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

            try:
                limit = _int("limit", 20, 1, self._EVENT_LIMIT_MAX)
                offset = _int("offset", 0, 0, self._EVENT_OFFSET_MAX)
                since = _time("since")
                until = _time("until")
            except ValueError as exc:
                return self._send_json(400, {"error": "bad_request", "reason": str(exc)}, origin)

            etype = query.get("type", [""])[0]
            if etype and etype not in EVENT_TYPES:
                return self._send_json(400, {"error": "bad_request", "reason": "bad_param:type"}, origin)
            severity = query.get("severity", [""])[0]
            if severity and severity not in EVENT_SEVERITIES:
                return self._send_json(400, {"error": "bad_request", "reason": "bad_param:severity"}, origin)
            source_id = query.get("sourceId", [""])[0]
            if len(source_id) > 128:
                return self._send_json(400, {"error": "bad_request", "reason": "bad_param:sourceId"}, origin)
            if since and until and since > until:
                return self._send_json(400, {"error": "bad_request", "reason": "range_param:since_gt_until"}, origin)

            rows, total = store.list_events(
                limit=limit, offset=offset, source_id=source_id or None, etype=etype or None,
                severity=severity or None, since=since, until=until,
            )
            return self._send_json(200, {
                "items": [_event_out(r) for r in rows], "total": total, "limit": limit, "offset": offset,
            }, origin)

        # ── POST /batches ───────────────────────────────────
        def _post_batch(self, query, origin):
            length = self.headers.get("Content-Length")
            if length is None:
                return self._send_json(411, {"error": "length_required"}, origin)
            try:
                length = int(length)
            except ValueError:
                return self._send_json(400, {"error": "bad_length"}, origin)
            if length > cfg.max_body:
                # 超限：保持 413 + JSON 与体积上限不变；**不做无上限读取**。
                # 有界地丢弃一部分请求体（至多 max_body + 64KiB），再带 Connection: close 响应，
                # 以降低客户端“还在发 body 时服务端已关连接”导致的连接中止（Windows 曾见 WinError 10053）。
                drain_cap = min(length, cfg.max_body + 65536)
                remaining = drain_cap
                while remaining > 0:
                    chunk = self.rfile.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                return self._send_json(
                    413, {"error": "payload_too_large", "maxBody": cfg.max_body}, origin, close=True
                )
            if length <= 0:
                return self._send_json(400, {"error": "empty_body"}, origin)

            raw = self.rfile.read(length)
            fmt = (query.get("format", [""])[0] or "").lower()
            ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if not fmt:
                if ctype == "application/json":
                    fmt = "json"
                elif ctype in ("text/csv", "application/csv"):
                    fmt = "csv"
                else:
                    fmt = "json" if raw.lstrip()[:1] in (b"[", b"{") else "csv"

            filename = query.get("filename", [""])[0][:200]
            try:
                records = _parse_records(raw, fmt)
            except ValueError as exc:
                return self._send_json(400, {"error": "parse_error", "reason": str(exc)}, origin)

            if not records:
                return self._send_json(400, {"error": "no_records"}, origin)

            source_id = query.get("sourceId", [""])[0]
            if not source_id:
                for r in records:
                    if isinstance(r, dict) and str(r.get("sourceId", "")).strip():
                        source_id = str(r["sourceId"]).strip()
                        break
            if not source_id:
                return self._send_json(400, {"error": "missing_source"}, origin)

            entity = ""
            for r in records:
                if isinstance(r, dict) and str(r.get("entity", "")).strip():
                    entity = str(r["entity"]).strip()
                    break

            import hashlib
            content_digest = hashlib.sha256(raw).hexdigest()
            batch_key = hashlib.sha256(
                f"{source_id}|{fmt}|{content_digest}".encode("utf-8")
            ).hexdigest()

            # 幂等短路：同名同内容已导入 -> 直接返回既有批次的真实计数，不重新校验。
            existing_id = store.find_batch_by_key(batch_key)
            if existing_id:
                b = store.get_batch(existing_id)
                return self._send_json(200, {
                    "batchId": existing_id, "idempotent": True, "status": b["status"],
                    "counts": {
                        "total": b["total_rows"], "valid": b["valid_rows"],
                        "isolated": b["isolated_rows"], "rejected": b["rejected_rows"],
                    },
                    "unordered": bool(b["unordered"]), "receivedAt": b["received_at"],
                    "ruleVersion": b["rule_version"],
                }, origin)

            result = validate_records(records, existing_keys=store.existing_keys_for(source_id))
            received_at = utc_now_iso()

            inserted = store.insert_batch(
                batch_key=batch_key, source_id=source_id, entity=entity, fmt=fmt,
                filename=filename, rule_version=RULE_VERSION, received_at=received_at,
                valid=result["valid"], isolated=result["isolated"], rejected=result["rejected"],
                unordered=result["unordered"],
            )
            code = 200 if inserted["idempotent"] else 201
            return self._send_json(code, {
                "batchId": inserted["id"],
                "idempotent": inserted["idempotent"],
                "status": inserted["status"],
                "counts": {
                    "total": len(records), "valid": len(result["valid"]),
                    "isolated": len(result["isolated"]), "rejected": len(result["rejected"]),
                },
                "unordered": result["unordered"],
                "receivedAt": received_at,
                "ruleVersion": RULE_VERSION,
            }, origin)

    return Handler


def _parse_records(raw: bytes, fmt: str):
    text = raw.decode("utf-8-sig", errors="strict")
    if fmt == "json":
        data = json.loads(text)
        if isinstance(data, dict):
            recs = data.get("records")
            if recs is None:
                recs = [data]
        elif isinstance(data, list):
            recs = data
        else:
            raise ValueError("json_root_must_be_object_or_array")
        return list(recs)
    if fmt == "csv":
        reader = csv.DictReader(io.StringIO(text))
        return [dict(row) for row in reader]
    raise ValueError("unknown_format")


def build_server(cfg: Config | None = None, store: Store | None = None):
    cfg = cfg or Config()
    store = store or Store(cfg.db_path)
    httpd = ThreadingHTTPServer((cfg.host, cfg.port), make_handler(cfg, store))
    return httpd, cfg, store


def main():
    cfg = Config()
    if not cfg.token:
        sys.stderr.write(
            "QH_DATA_TOKEN 未设置：拒绝启动（能力令牌缺失）。\n"
            "请用 run.sh 启动，或先 export QH_DATA_TOKEN=...。\n"
        )
        sys.exit(2)
    httpd, cfg, store = build_server(cfg)
    sys.stderr.write(
        "[qh-data] listening on http://%s:%d (loopback only), schema=%d, db=%s\n"
        % (cfg.host, cfg.port, store.schema_version(), cfg.db_path)
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        store.close()


if __name__ == "__main__":
    main()
