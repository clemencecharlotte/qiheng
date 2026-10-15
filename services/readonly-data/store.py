"""气衡 M07 · SQLite 存储层（纯标准库 sqlite3）。

· schema 版本用 PRAGMA user_version 管理；迁移**事务化**（逐语句 BEGIN/COMMIT）。
· 所有写入在显式事务里；失败整体回滚，绝不半写。
· 全部 SQL 参数化；批次幂等键唯一。
· v2 新增治理事件 events：只记录**真实发生**的导入完成/校验拒绝/隔离/服务错误；
  幂等命中不重复制造“新完成”。事件与日志不含 token/请求原文/密钥。
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

SCHEMA_VERSION = 2

_STATEMENTS_V1 = [
    """CREATE TABLE IF NOT EXISTS sources (
      source_id        TEXT PRIMARY KEY,
      entity           TEXT,
      last_observed_at TEXT,
      last_received_at TEXT,
      heartbeat_at     TEXT,
      status           TEXT NOT NULL DEFAULT 'unconfigured',
      rule_version     TEXT,
      updated_at       TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS batches (
      id            TEXT PRIMARY KEY,
      batch_key     TEXT NOT NULL UNIQUE,
      source_id     TEXT NOT NULL,
      entity        TEXT,
      format        TEXT NOT NULL,
      filename      TEXT,
      rule_version  TEXT NOT NULL,
      received_at   TEXT NOT NULL,
      total_rows    INTEGER NOT NULL,
      valid_rows    INTEGER NOT NULL,
      isolated_rows INTEGER NOT NULL,
      rejected_rows INTEGER NOT NULL,
      status        TEXT NOT NULL,
      unordered     INTEGER NOT NULL DEFAULT 0,
      note          TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS observations (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id       TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      source_id      TEXT NOT NULL,
      entity         TEXT,
      metric         TEXT NOT NULL,
      value          REAL NOT NULL,
      unit           TEXT NOT NULL,
      observed_at    TEXT NOT NULL,
      observed_epoch REAL NOT NULL,
      received_at    TEXT NOT NULL,
      quality        TEXT NOT NULL,
      reason         TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS rejections (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id  TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      reason    TEXT NOT NULL,
      raw       TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_obs_batch      ON observations(batch_id)",
    "CREATE INDEX IF NOT EXISTS idx_obs_source_key ON observations(source_id, entity, metric, observed_epoch)",
    "CREATE INDEX IF NOT EXISTS idx_batches_source ON batches(source_id, received_at)",
    "CREATE INDEX IF NOT EXISTS idx_reject_batch   ON rejections(batch_id)",
]

_STATEMENTS_V2 = [
    """CREATE TABLE IF NOT EXISTS events (
      event_id     TEXT PRIMARY KEY,
      source_id    TEXT,
      batch_id     TEXT,
      type         TEXT NOT NULL,
      severity     TEXT NOT NULL,
      occurred_at  TEXT NOT NULL,
      received_at  TEXT NOT NULL,
      rule_version TEXT,
      reasons      TEXT,
      detail       TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_events_time   ON events(received_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_id, received_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_events_type   ON events(type, received_at DESC)",
]

MIGRATIONS = {1: _STATEMENTS_V1, 2: _STATEMENTS_V2}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _group_reasons(rows) -> list:
    counts: dict[str, int] = {}
    for r in rows:
        reason = r.get("reason") or "unknown"
        counts[reason] = counts.get(reason, 0) + 1
    return [{"reason": k, "c": v} for k, v in sorted(counts.items(), key=lambda kv: -kv[1])]


class Store:
    def __init__(self, db_path: str):
        self.db_path = db_path
        parent = os.path.dirname(os.path.abspath(db_path))
        os.makedirs(parent, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._lock = threading.RLock()
        self._migrate()

    # ── 迁移（事务化）────────────────────────────────────────
    def _migrate(self):
        with self._lock:
            version = self._conn.execute("PRAGMA user_version").fetchone()[0]
            while version < SCHEMA_VERSION:
                target = version + 1
                try:
                    self._conn.execute("BEGIN")
                    for stmt in MIGRATIONS[target]:
                        self._conn.execute(stmt)
                    self._conn.execute(f"PRAGMA user_version={target}")
                    self._conn.execute("COMMIT")
                except Exception:
                    self._conn.execute("ROLLBACK")
                    raise
                version = target

    def schema_version(self) -> int:
        with self._lock:
            return self._conn.execute("PRAGMA user_version").fetchone()[0]

    def close(self):
        with self._lock:
            self._conn.close()

    # ── 批次 ────────────────────────────────────────────────
    def existing_keys_for(self, source_id: str) -> set:
        with self._lock:
            rows = self._conn.execute(
                "SELECT source_id, entity, metric, observed_at FROM observations WHERE source_id=?",
                (source_id,),
            ).fetchall()
        return {(r["source_id"], r["entity"], r["metric"], r["observed_at"]) for r in rows}

    def find_batch_by_key(self, batch_key: str):
        with self._lock:
            row = self._conn.execute("SELECT id FROM batches WHERE batch_key=?", (batch_key,)).fetchone()
        return row["id"] if row else None

    def _insert_event(self, *, source_id, batch_id, etype, severity, occurred_at, received_at, rule_version, reasons, detail):
        self._conn.execute(
            "INSERT INTO events (event_id,source_id,batch_id,type,severity,occurred_at,received_at,"
            "rule_version,reasons,detail) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (uuid.uuid4().hex, source_id, batch_id, etype, severity, occurred_at, received_at,
             rule_version, json.dumps(reasons, ensure_ascii=False) if reasons is not None else None, detail),
        )

    def insert_batch(self, *, batch_key, source_id, entity, fmt, filename, rule_version,
                     received_at, valid, isolated, rejected, unordered):
        total = len(valid) + len(isolated) + len(rejected)
        status = "ok" if rejected == [] and isolated == [] else "partial"
        note = (
            f"记录级校验版本 {rule_version}；非官方 15 分钟质量门。"
            f" 有效 {len(valid)} / 隔离 {len(isolated)} / 拒绝 {len(rejected)}；"
            f" 乱序={'是' if unordered else '否'}。"
        )
        batch_id = uuid.uuid4().hex
        with self._lock:
            try:
                self._conn.execute("BEGIN IMMEDIATE")
                existing = self._conn.execute("SELECT id FROM batches WHERE batch_key=?", (batch_key,)).fetchone()
                if existing:
                    self._conn.execute("ROLLBACK")
                    # 幂等命中：不插入任何事件，不制造新的“完成”。
                    return {"id": existing["id"], "idempotent": True, "status": "ok"}

                self._conn.execute(
                    "INSERT INTO batches (id,batch_key,source_id,entity,format,filename,"
                    "rule_version,received_at,total_rows,valid_rows,isolated_rows,rejected_rows,"
                    "status,unordered,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (batch_id, batch_key, source_id, entity, fmt, filename, rule_version,
                     received_at, total, len(valid), len(isolated), len(rejected),
                     status, 1 if unordered else 0, note),
                )
                for row in valid:
                    self._conn.execute(
                        "INSERT INTO observations (batch_id,source_id,entity,metric,value,unit,"
                        "observed_at,observed_epoch,received_at,quality,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (batch_id, row["sourceId"], row["entity"], row["metric"], row["value"], row["unit"],
                         row["observedAt"], row["observedEpoch"], received_at, "valid", None),
                    )
                for row in isolated:
                    self._conn.execute(
                        "INSERT INTO observations (batch_id,source_id,entity,metric,value,unit,"
                        "observed_at,observed_epoch,received_at,quality,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (batch_id, row["sourceId"], row["entity"], row["metric"], row["value"], row["unit"],
                         row["observedAt"], row["observedEpoch"], received_at, "isolated", row.get("reason")),
                    )
                for r in rejected:
                    self._conn.execute(
                        "INSERT INTO rejections (batch_id,row_index,reason,raw) VALUES (?,?,?,?)",
                        (batch_id, r["row"], r["reason"], r.get("raw")),
                    )

                max_obs_iso = None
                max_epoch = None
                for row in valid:
                    if max_epoch is None or row["observedEpoch"] > max_epoch:
                        max_epoch = row["observedEpoch"]
                        max_obs_iso = row["observedAt"]
                heartbeat = utc_now_iso()
                self._conn.execute(
                    "INSERT INTO sources (source_id,entity,last_observed_at,last_received_at,"
                    "heartbeat_at,status,rule_version,updated_at) VALUES (?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(source_id) DO UPDATE SET "
                    "entity=excluded.entity,"
                    "last_observed_at=CASE "
                    "  WHEN excluded.last_observed_at IS NULL THEN sources.last_observed_at "
                    "  WHEN sources.last_observed_at IS NULL THEN excluded.last_observed_at "
                    "  WHEN excluded.last_observed_at > sources.last_observed_at THEN excluded.last_observed_at "
                    "  ELSE sources.last_observed_at END,"
                    "last_received_at=excluded.last_received_at,"
                    "heartbeat_at=excluded.heartbeat_at,"
                    "status='unconfigured',"
                    "rule_version=excluded.rule_version,"
                    "updated_at=excluded.updated_at",
                    (source_id, entity, max_obs_iso, received_at, heartbeat, "unconfigured", rule_version, heartbeat),
                )

                # ── 治理事件：只记录真实发生的事 ──
                ev_received = utc_now_iso()
                self._insert_event(
                    source_id=source_id, batch_id=batch_id, etype="import_completed", severity="info",
                    occurred_at=received_at, received_at=ev_received, rule_version=rule_version,
                    reasons=[{"reason": "valid", "c": len(valid)}],
                    detail=f"批次导入完成：有效 {len(valid)} / 隔离 {len(isolated)} / 拒绝 {len(rejected)}",
                )
                if isolated:
                    self._insert_event(
                        source_id=source_id, batch_id=batch_id, etype="rows_isolated", severity="warn",
                        occurred_at=received_at, received_at=ev_received, rule_version=rule_version,
                        reasons=_group_reasons(isolated),
                        detail=f"隔离 {len(isolated)} 行（重复键等）",
                    )
                if rejected:
                    self._insert_event(
                        source_id=source_id, batch_id=batch_id, etype="rows_rejected", severity="warn",
                        occurred_at=received_at, received_at=ev_received, rule_version=rule_version,
                        reasons=_group_reasons(rejected),
                        detail=f"拒绝 {len(rejected)} 行（字段/单位/时间等）",
                    )

                self._conn.execute("COMMIT")
                return {"id": batch_id, "idempotent": False, "status": status}
            except Exception:
                try:
                    self._conn.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise

    def record_service_error(self, *, source_id, error_type, rule_version):
        """记录一次真实发生的服务错误（如内部异常）。不含请求原文/密钥。"""
        with self._lock:
            now = utc_now_iso()
            try:
                self._conn.execute("BEGIN")
                self._insert_event(
                    source_id=source_id or None, batch_id=None, etype="service_error", severity="error",
                    occurred_at=now, received_at=now, rule_version=rule_version,
                    reasons=[{"reason": error_type or "internal_error", "c": 1}],
                    detail=f"服务错误：{error_type or 'internal_error'}",
                )
                self._conn.execute("COMMIT")
            except Exception:
                try:
                    self._conn.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise

    def touch_heartbeat(self, source_id: str):
        with self._lock:
            hb = utc_now_iso()
            self._conn.execute(
                "INSERT INTO sources (source_id,heartbeat_at,status,updated_at) VALUES (?,?,?,?) "
                "ON CONFLICT(source_id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at, updated_at=excluded.updated_at",
                (source_id, hb, "unconfigured", hb),
            )
            return hb

    # ── 查询 ────────────────────────────────────────────────
    def list_batches(self, limit=50, offset=0):
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM batches ORDER BY received_at DESC, id DESC LIMIT ? OFFSET ?", (limit, offset)
            ).fetchall()
            total = self._conn.execute("SELECT COUNT(*) AS c FROM batches").fetchone()["c"]
        return [dict(r) for r in rows], total

    def get_batch(self, batch_id):
        with self._lock:
            row = self._conn.execute("SELECT * FROM batches WHERE id=?", (batch_id,)).fetchone()
        return dict(row) if row else None

    def get_observations(self, batch_id, limit=200, offset=0):
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM observations WHERE batch_id=? ORDER BY observed_epoch ASC, id ASC LIMIT ? OFFSET ?",
                (batch_id, limit, offset),
            ).fetchall()
            total = self._conn.execute(
                "SELECT COUNT(*) AS c FROM observations WHERE batch_id=?", (batch_id,)
            ).fetchone()["c"]
        return [dict(r) for r in rows], total

    def get_quality(self, batch_id):
        with self._lock:
            b = self._conn.execute(
                "SELECT total_rows,valid_rows,isolated_rows,rejected_rows,rule_version,status,unordered,note "
                "FROM batches WHERE id=?", (batch_id,)
            ).fetchone()
            if not b:
                return None
            reasons = self._conn.execute(
                "SELECT reason, COUNT(*) AS c FROM rejections WHERE batch_id=? GROUP BY reason ORDER BY c DESC",
                (batch_id,),
            ).fetchall()
            iso_reasons = self._conn.execute(
                "SELECT reason, COUNT(*) AS c FROM observations WHERE batch_id=? AND quality='isolated' "
                "GROUP BY reason ORDER BY c DESC", (batch_id,),
            ).fetchall()
            rejects = self._conn.execute(
                "SELECT row_index,reason,raw FROM rejections WHERE batch_id=? ORDER BY row_index", (batch_id,)
            ).fetchall()
        return {
            "batchId": batch_id, "ruleVersion": b["rule_version"], "status": b["status"],
            "unordered": bool(b["unordered"]), "note": b["note"],
            "counts": {"total": b["total_rows"], "valid": b["valid_rows"],
                       "isolated": b["isolated_rows"], "rejected": b["rejected_rows"]},
            "rejectReasons": [dict(r) for r in reasons],
            "isolateReasons": [dict(r) for r in iso_reasons],
            "rejections": [dict(r) for r in rejects],
        }

    def get_source_state(self, source_id):
        with self._lock:
            row = self._conn.execute("SELECT * FROM sources WHERE source_id=?", (source_id,)).fetchone()
            agg = self._conn.execute(
                "SELECT COUNT(*) AS obs, MAX(observed_at) AS max_obs FROM observations WHERE source_id=?",
                (source_id,),
            ).fetchone()
        if not row:
            return {"sourceId": source_id, "configured": False, "sourceObservedAt": None, "receivedAt": None,
                    "heartbeatAt": None, "status": "unconfigured", "observationCount": (agg["obs"] or 0),
                    "ruleVersion": None}
        d = dict(row)
        return {"sourceId": d["source_id"], "configured": True,
                "sourceObservedAt": d["last_observed_at"] or agg["max_obs"], "receivedAt": d["last_received_at"],
                "heartbeatAt": d["heartbeat_at"], "status": d["status"], "observationCount": agg["obs"] or 0,
                "ruleVersion": d["rule_version"]}

    # ── 治理事件查询 ────────────────────────────────────────
    def list_events(self, *, limit=20, offset=0, source_id=None, etype=None, severity=None, since=None, until=None):
        where = []
        params: list = []
        if source_id:
            where.append("source_id = ?")
            params.append(source_id)
        if etype:
            where.append("type = ?")
            params.append(etype)
        if severity:
            where.append("severity = ?")
            params.append(severity)
        if since:
            where.append("received_at >= ?")
            params.append(since)
        if until:
            where.append("received_at <= ?")
            params.append(until)
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        with self._lock:
            rows = self._conn.execute(
                f"SELECT * FROM events{clause} ORDER BY received_at DESC, event_id DESC LIMIT ? OFFSET ?",
                (*params, limit, offset),
            ).fetchall()
            total = self._conn.execute(f"SELECT COUNT(*) AS c FROM events{clause}", tuple(params)).fetchone()["c"]
        return [dict(r) for r in rows], total

    def get_event(self, event_id):
        with self._lock:
            row = self._conn.execute("SELECT * FROM events WHERE event_id=?", (event_id,)).fetchone()
        return dict(row) if row else None

    def count_events(self) -> int:
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) AS c FROM events").fetchone()["c"]
