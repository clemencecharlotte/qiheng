# API 契约 · services/readonly-data

基址：同源前缀 `/api/qh-data`（服务端同时接受带/不带该前缀）。仅 loopback。
所需头：`X-QH-Capability: <本地能力令牌>`。带 `Origin` 的请求必须命中白名单（默认
`http://127.0.0.1:4202,http://localhost:4202`），否则 403；不回 `CORS *`。

## GET /health
`200` → `{ "status":"ok", "service":"qh-readonly-data", "schemaVersion":1, "time":<ISO>, "ruleVersion":"qh-readonly-validate/1" }`
无令牌 → `401 {"error":"unauthorized"}`。

## POST /batches?format=csv|json&filename=<name>[&sourceId=<id>]
Body 为该 CSV/JSON 文本（≤ 上限，默认 1 MiB）。JSON 可为对象数组，或 `{ "records": [...] }`。
`201` → `{ batchId, idempotent:false, status:"ok"|"partial",
counts:{total,valid,isolated,rejected}, unordered, receivedAt, ruleVersion }`
同来源+格式+内容重复导入 → `200`，`idempotent:true`，返回**既有批次真实计数**。
体积超限 → `413 {"error":"payload_too_large"}`；空体 `400`；缺来源 `400`；解析失败 `400`。

## GET /batches?limit=&offset=
`200` → `{ items:[BatchSummary], total }`。
BatchSummary = `{ id, sourceId, entity, format, filename, ruleVersion, receivedAt,
totalRows, validRows, isolatedRows, rejectedRows, status, unordered, note }`

## GET /batches/{id}
`200` → BatchSummary；不存在 `404`。

## GET /batches/{id}/observations?limit=&offset=
`200` → `{ items:[Observation], total }`。
Observation = `{ id, batchId, sourceId, entity, metric, value, unit, observedAt, receivedAt, quality:"valid"|"isolated", reason }`。

## GET /batches/{id}/quality
`200` → `{ batchId, ruleVersion, status, unordered, note,
counts:{total,valid,isolated,rejected}, rejectReasons:[{reason,c}], isolateReasons:[{reason,c}],
rejections:[{rowIndex,reason,raw}] }`

## GET /sources/{id}/state
`200` → `{ sourceId, configured, sourceObservedAt, receivedAt, heartbeatAt, status, observationCount, ruleVersion }`
三个时间分开：`sourceObservedAt`=数据观察时间（max），`receivedAt`=批次接收（服务生成），`heartbeatAt`=服务心跳（服务生成）。
`status` 本片恒为 `unconfigured`（离线批次，无实时连接，不标 live/offline）。

## GET /events（M07，只读治理事件）
查询参数：`limit`(1–100，默认 20)、`offset`(0–1000000)、`sourceId`(≤128)、`type`(枚举)、`severity`(枚举)、`since`/`until`(ISO8601)。
未知参数、越界数值、非法类型/级别、非法时间、`since>until` → **400**（`{error:"bad_request", reason}`）。
`200` → `{ items:[GovernanceEvent], total, limit, offset }`。
GovernanceEvent = `{ eventId, sourceId, batchId, type, severity, occurredAt, receivedAt, ruleVersion, reasons:[{reason,c}]|null, detail }`。
仅含真实存储事件；**不含 token / 请求原文 / 密钥**。

## GET /events/{id}
`200` → GovernanceEvent；不存在 `404`；非 GET `405`。

## 记录级校验 policy（`qh-readonly-validate/1`）
必需 `sourceId/entity/metric/value/unit/observedAt`；`value` 必须有限数值；`unit` 走白名单；
`observedAt` 必须带时区。缺字段/非有限值/未知单位/无时区→ **rejected**（进 rejections，**不补 0**）；
批内或库内重复键 → **isolated**（`duplicate_key`/`duplicate_existing`）；乱序 → valid 且标记 `unordered`。
输入的 `pass/quality` 一律忽略。**记录级合法 ≠ 官方 15 分钟质量门 pass。**
