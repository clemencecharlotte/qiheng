-- 气衡 M06 只读数据服务 · SQLite schema v1
-- 由 services/readonly-data/store.py 以 PRAGMA user_version 管理版本；
-- 本文件是同一 DDL 的可读副本（迁移说明见 MIGRATIONS.md）。
--
-- 设计要点：
--   · observations.value 为 REAL NOT NULL：只有通过有限值校验的行才会落库，
--     异常值进入 rejections（原始内容截断），**绝不补 0**。
--   · quality 只取 'valid' | 'isolated'，由验证器生成，不采信输入的 pass/quality。
--   · observed_epoch 用于排序/乱序判定；observed_at 保留带时区的 ISO 文本。
--   · received_at 一律由服务生成；batches.batch_key 唯一，保证幂等导入不重复。

CREATE TABLE IF NOT EXISTS sources (
  source_id        TEXT PRIMARY KEY,
  entity           TEXT,
  last_observed_at TEXT,
  last_received_at TEXT,
  heartbeat_at     TEXT,
  status           TEXT NOT NULL DEFAULT 'unconfigured',
  rule_version     TEXT,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
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
);

CREATE TABLE IF NOT EXISTS observations (
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
);

CREATE TABLE IF NOT EXISTS rejections (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id  TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  reason    TEXT NOT NULL,
  raw       TEXT
);

CREATE INDEX IF NOT EXISTS idx_obs_batch      ON observations(batch_id);
CREATE INDEX IF NOT EXISTS idx_obs_source_key ON observations(source_id, entity, metric, observed_epoch);
CREATE INDEX IF NOT EXISTS idx_batches_source ON batches(source_id, received_at);
CREATE INDEX IF NOT EXISTS idx_reject_batch   ON rejections(batch_id);

-- ── v2：治理事件（M07）────────────────────────────────────────────
-- 只记录真实发生的事：批次导入完成 / 校验拒绝 / 隔离 / 服务错误。
-- 幂等命中不写入事件（不重复制造“新完成”）。事件/日志不含 token/请求原文/密钥。
CREATE TABLE IF NOT EXISTS events (
  event_id     TEXT PRIMARY KEY,
  source_id    TEXT,
  batch_id     TEXT,
  type         TEXT NOT NULL,   -- import_completed | rows_isolated | rows_rejected | service_error
  severity     TEXT NOT NULL,   -- info | warn | error
  occurred_at  TEXT NOT NULL,
  received_at  TEXT NOT NULL,
  rule_version TEXT,
  reasons      TEXT,            -- JSON: [{reason, c}] 结构化原因
  detail       TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_time   ON events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type   ON events(type, received_at DESC);

