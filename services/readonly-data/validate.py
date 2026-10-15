"""气衡 M06 · 记录级验证（纯标准库，无第三方依赖）。

职责：把上传的原始记录（dict）分成 valid / isolated / rejected 三类。

明示 policy（不是官方 15 分钟质量门）：
  · 缺字段或空值            -> rejected  reason=missing_field:<field>
  · value 非有限数值         -> rejected  reason=non_finite_value   （绝不补 0）
  · unit 不在白名单          -> rejected  reason=unknown_unit
  · observedAt 无时区/非法   -> rejected  reason=naive_timestamp / bad_timestamp
  · 批内重复键               -> isolated  reason=duplicate_key
  · 库内已存在同键           -> isolated  reason=duplicate_existing
  · 乱序（非单调时间）       -> valid，但在 meta 里标记 unordered=True

字段合法的行只代表"通过记录级校验"，不代表通过官方质量门。
输入里的 quality / pass 字段一律忽略，quality 由本验证器生成。
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

RULE_VERSION = "qh-readonly-validate/1"

REQUIRED_FIELDS = ("sourceId", "entity", "metric", "value", "unit", "observedAt")

# 单位白名单：合成演示覆盖到的量纲；未知单位一律拒绝。
UNIT_WHITELIST = {
    "kW", "kWh", "MW", "MW.h",
    "m3/min", "m3/h", "m3", "Nm3", "Nm3/min",
    "MPa", "bar", "kPa", "Pa",
    "degC", "degF", "K",
    "%", "rpm", "Hz", "A", "V", "kg", "t", "h", "min", "s", "pcs", "unit",
}

_MAX_RAW_LEN = 300


def _raw_preview(rec: dict) -> str:
    try:
        s = repr(rec)
    except Exception:  # pragma: no cover - 防御
        s = "<unrepresentable>"
    return s[:_MAX_RAW_LEN]


def _is_present(v) -> bool:
    return v is not None and not (isinstance(v, str) and v.strip() == "")


def _clean_str(v) -> str:
    return v.strip() if isinstance(v, str) else str(v).strip()


def parse_observed_at(raw: str):
    """解析带时区的 ISO8601；返回 (iso_utc, epoch)。无法/无时区则抛 ValueError(code)。

    兼容 Python 3.9 与 3.11：3.9 的 datetime.fromisoformat 不认末尾 'Z'，
    这里先归一化 'Z'/'z' 为 '+00:00' 再解析；小数秒同理。缺时区仍拒绝。
    """
    if not isinstance(raw, str) or raw.strip() == "":
        raise ValueError("bad_timestamp")
    s = raw.strip()
    normalized = s[:-1] + "+00:00" if s[-1] in ("Z", "z") else s
    dt = None
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        # 兼容仅写 +0800（无冒号）的形式（Python 3.9 的 fromisoformat 不接受）
        try:
            dt = datetime.strptime(s, "%Y-%m-%dT%H:%M:%S%z")
        except ValueError:
            raise ValueError("bad_timestamp")
    if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
        raise ValueError("naive_timestamp")
    dt_utc = dt.astimezone(timezone.utc)
    iso_utc = dt_utc.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return iso_utc, dt_utc.timestamp()


def _validate_one(rec) -> tuple[str | None, dict | None]:
    """返回 (reject_reason, normalized_record)。"""
    if not isinstance(rec, dict):
        return "bad_record_type", None
    for f in REQUIRED_FIELDS:
        if not _is_present(rec.get(f)):
            return f"missing_field:{f}", None

    # value：仅接受有限数值（数字或可解析的数值字符串）。
    try:
        value = float(rec.get("value"))
    except (TypeError, ValueError):
        return "non_finite_value", None
    if not math.isfinite(value):
        return "non_finite_value", None

    unit = _clean_str(rec.get("unit"))
    if unit not in UNIT_WHITELIST:
        return "unknown_unit", None

    try:
        iso_utc, epoch = parse_observed_at(rec.get("observedAt"))
    except ValueError as exc:
        return str(exc), None

    source_id = _clean_str(rec.get("sourceId"))
    entity = _clean_str(rec.get("entity"))
    metric = _clean_str(rec.get("metric"))
    if not source_id or not metric:
        return "missing_field:metric", None

    return None, {
        "sourceId": source_id,
        "entity": entity,
        "metric": metric,
        "value": value,
        "unit": unit,
        "observedAt": iso_utc,
        "observedEpoch": epoch,
        "key": (source_id, entity, metric, iso_utc),
    }


def validate_records(records, existing_keys=None):
    """把原始记录列表分成 valid / isolated / rejected。

    existing_keys: 库中已存在的键集合 {(source_id, entity, metric, observed_at)}
    返回 dict: valid[], isolated[], rejected[], unordered(bool)
    """
    existing_keys = existing_keys or set()
    valid: list[dict] = []
    isolated: list[dict] = []
    rejected: list[dict] = []
    seen: set = set()
    prev_epoch = None
    unordered = False

    for idx, rec in enumerate(records):
        reason, norm = _validate_one(rec)
        if reason is not None:
            rejected.append({"row": idx, "reason": reason, "raw": _raw_preview(rec)})
            continue

        key = norm["key"]
        if key in seen:
            isolated.append({**norm, "row": idx, "reason": "duplicate_key"})
            continue
        if key in existing_keys:
            isolated.append({**norm, "row": idx, "reason": "duplicate_existing"})
            continue
        seen.add(key)

        if prev_epoch is not None and norm["observedEpoch"] < prev_epoch:
            unordered = True
        prev_epoch = norm["observedEpoch"]

        valid.append(norm)

    return {"valid": valid, "isolated": isolated, "rejected": rejected, "unordered": unordered}
