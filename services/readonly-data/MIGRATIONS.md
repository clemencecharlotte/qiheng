# DB 迁移说明

SQLite 由 `store.py` 用 `PRAGMA user_version` 管理 schema 版本，启动时自动迁移。

## v1（当前）

DDL 见 `schema.sql`。表：

- `sources(source_id PK, entity, last_observed_at, last_received_at, heartbeat_at, status, rule_version, updated_at)`
- `batches(id PK, batch_key UNIQUE, source_id, entity, format, filename, rule_version, received_at, total_rows, valid_rows, isolated_rows, rejected_rows, status, unordered, note)`
- `observations(id PK, batch_id FK, source_id, entity, metric, value REAL NOT NULL, unit, observed_at, observed_epoch, received_at, quality, reason)`
- `rejections(id PK, batch_id FK, row_index, reason, raw)`

要点：

- `observations.value` 为 `REAL NOT NULL`：只有通过“有限值/单位白名单/带时区时间”校验的行才落库；
  非法值进入 `rejections`（原始内容截断），**绝不补 0**。
- `observed_at` 归一化为定宽 UTC `Z` 字符串，`observed_epoch` 用于排序与乱序判定。
- `received_at` 一律由服务生成；`quality ∈ {valid, isolated}` 由验证器生成，不采信输入 `pass/quality`。
- `batch_key = sha256(source_id | format | sha256(raw_body))`，唯一约束保证幂等。
- `sources.status` 本片恒为 `unconfigured`（只有离线批次，无实时连接，不标 live/offline）。

## 迁移方法

`store.py::Store._migrate()` 读取 `PRAGMA user_version`：`< 1` 时执行 v1 DDL 并置 1；`< 2` 时执行 v2 DDL 并置 2。
每一步在**显式事务**内逐语句执行（`BEGIN` → 语句 → `PRAGMA user_version=N` → `COMMIT`，失败 `ROLLBACK`），
因此迁移要么整体成功、要么不落半截。后续版本在此按序追加。

## v2（当前）

新增 `events` 表（v1 表与数据不变，迁移不产生任何事件行）：

```
events(event_id PK, source_id, batch_id, type, severity,
       occurred_at, received_at, rule_version, reasons(json), detail)
```

- `type ∈ {import_completed, rows_isolated, rows_rejected, service_error}`，`severity ∈ {info, warn, error}`。
- 只在**真实发生**时写入：新批次落盘后写 `import_completed`；有隔离/拒绝时分别写 `rows_isolated`/`rows_rejected`；
  服务内部错误写 `service_error`。**幂等命中不写事件**。
- 不含 token / 请求原文 / 密钥；`reasons` 仅结构化计数。
- 迁移已在 `tests/test_store.py::test_migration_v1_to_v2_preserves_batches` 覆盖（原批次保留、事件数 0）。

## 备份与恢复（非破坏）

DB 文件位于 `services/readonly-data/var/qh-data.sqlite3`（gitignore）。**禁止**把“删库”当作正常回退手段；
**禁止**直接复制正在写入的库并承诺一致。

- **一致备份**（二选一）：
  1. 先**停写**（停服务，或确认无进行中的导入），再复制 `var/qh-data.sqlite3`（含 `-wal`/`-shm`，若存在）；
  2. 或对运行中的库用 SQLite 在线备份：`sqlite3 var/qh-data.sqlite3 ".backup 'var/backup-YYYYmmdd.sqlite3'"`（或 `VACUUM INTO`）。
- **迁移失败**：迁移在显式事务内执行，失败自动 `ROLLBACK`，库保持原版本、原数据；修复后**重跑**即可。不要删库重建。
- **恢复**：停服务 → 用备份**替换** `var/qh-data.sqlite3` → 重启（启动时自动校验并迁移到当前版本）。
- 本文件所述 `m07.sqlite3`/`qh-data.sqlite3` 等现有库一律保留，迁移不破坏原批次与幂等结果。
