# 气衡 M06 · 只读数据服务（services/readonly-data）

离线只读数据接入与治理闭环的后端。**纯 Python 标准库**（`sqlite3` + `http.server`），
不新增第三方依赖，不改 `app/package` 与锁文件。这是**离线批次**接入，不是实时生产连接。

## 运行

```bash
cd services/readonly-data
./run.sh            # 生成/复用本地能力令牌（var/.capability，值不打印），监听 127.0.0.1:4203
```

环境变量（均有默认值）：`QH_DATA_HOST`（默认 127.0.0.1，仅 loopback）、`QH_DATA_PORT`（4203）、
`QH_DATA_DB`（var/qh-data.sqlite3）、`QH_DATA_TOKEN`（能力令牌，缺省由 run.sh 生成）、
`QH_DATA_ALLOWED_ORIGINS`（默认 `http://127.0.0.1:4202,http://localhost:4202`）、
`QH_DATA_MAX_BODY`（默认 1 MiB）、`QH_DATA_STALE_MS`（默认 900000）。

## API（同时接受带/不带 `/api/qh-data` 前缀）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康 + schema 版本 + 服务时间 |
| POST | `/batches?format=csv\|json&filename=...` | 导入一批（body 为 CSV 或 JSON） |
| GET | `/batches?limit=&offset=` | 批次列表 |
| GET | `/batches/{id}` | 批次详情 |
| GET | `/batches/{id}/observations` | 观测行 |
| GET | `/batches/{id}/quality` | 质量计数 + 拒绝/隔离原因 |
| GET | `/sources/{id}/state` | 来源状态（观察/接收/心跳分离） |

必需头：`X-QH-Capability: <token>`。带 `Origin` 的请求必须命中白名单，否则 403；不回 `CORS *`。

## 安全与边界

- 仅绑定 loopback；不裸露公网、不接生产 PLC、不创建外部连接。
- 本地能力令牌（常量时间比较）；令牌只从环境/本地文件读，写日志不含令牌与请求体。
- 请求体大小上限；参数化 SQL；显式事务，失败整体回滚（不半写）。
- 幂等：相同来源+格式+内容哈希 -> 同一批次，不重复落盘。
- 记录级校验仅代表“字段合法”，**不等于**官方 15 分钟质量门 pass。

## 测试

```bash
cd services/readonly-data
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

## 数据模型 / 迁移

见 `schema.sql` 与 `MIGRATIONS.md`。数据库文件在 `var/`，已被 `.gitignore` 排除。

## 候选与公网同源（M06b）

本任务 4202 候选为 HTTPS 公网预览：`https://4202-a1db149b692927f8.code.cosmoplat.cn`。
浏览器同源写请求会带 `Origin: https://4202-a1db149b692927f8.code.cosmoplat.cn`，后端与代理都**精确**放行该 Origin：

- 后端 `QH_DATA_ALLOWED_ORIGINS` 默认 = `https://4202-a1db149b692927f8.code.cosmoplat.cn,http://127.0.0.1:4202,http://localhost:4202`
  （精确枚举，无通配、不放行整个 `.cosmoplat.cn`、不做 Origin 重写）。
- 独立 dev 代理（`app/vite.data.config.ts`）自实现严格守卫：只放行固定路由合同 + 允许方法；
  写请求要求精确 `Origin` 与 `Host`，缺 Origin / `null` / 外国 Origin → 403；拒绝 `/api/qh-dataevil`、双前缀、任意 URL；
  目标只允许 loopback；缺令牌 fail closed。能力令牌由代理注入上游，**不下发浏览器**。

### 同时启动（loopback 4203 + 独立 4202）

```bash
# 1) 后端（loopback 4203；令牌写 var/.capability，值不打印；重启保留 DB）
bash services/readonly-data/run.sh          # 前台运行

# 2) 前端候选（独立 4202，仅代理固定 /api/qh-data）
cd app
QH_DATA_TOKEN="$(cat ../services/readonly-data/var/.capability)" \
QH_DATA_TARGET=http://127.0.0.1:4203 \
npx vite --config vite.data.config.ts
```

- 深链（回放证据 / 趋势页，面板在其上方）：`https://4202-a1db149b692927f8.code.cosmoplat.cn/#/history/trend`
- 重启后端**不会清空** DB（`var/qh-data.sqlite3` 持久化）；令牌仍在 `var/.capability`，不外发。
- **独立 4202 是 dev 候选，不是生产部署**；生产代理/鉴权另片决定。

### 测试边界（勿误解）

后端在 loopback 上允许**无 Origin** 的 capability 请求，供本地受控 curl/脚本冒烟（如 `REPLAY.sh`）；
这不是公网写入口——公网写入只能经代理，且代理对写请求强制精确 Origin/Host。token 不落前端、不打印。

## M07 独立候选（治理事件）

M07 使用独立工作树与端口：后端 loopback **4206**（自带 DB `var/m07.sqlite3`），前端 **4205**。

```bash
# 后端 4206（独立 DB）
cd services/readonly-data
QH_DATA_PORT=4206 QH_DATA_DB="$PWD/var/m07.sqlite3" bash run.sh

# 前端 4205（独立 vite 配置，仅代理固定 /api/qh-data -> 4206）
cd app
QH_DATA_TOKEN="$(cat ../services/readonly-data/var/.capability)" \
QH_DATA_TARGET=http://127.0.0.1:4206 \
npx vite --config vite.m07.config.ts
```

- 公网深链（回放证据 / 趋势页，治理事件面板在数据面板之后）：
  `https://4205-a1db149b692927f8.code.cosmoplat.cn/#/history/trend`
- `GET /events` 提供受控分页/来源/类型/时间筛选（非法参数 400）；事件仅记录真实发生的
  导入完成 / 隔离 / 拒绝 / 服务错误；幂等命中不写事件。迁移到 schema v2（事务）；重启保留 DB。
- 回退：源码回退到 M06b 即可移除事件能力；数据库采用**非破坏恢复**（见 `MIGRATIONS.md`）——
  先停写或 `sqlite3 .backup` 一致备份，再替换；**不删现有 DB**、不把删库当回退。


