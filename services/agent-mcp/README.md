# 气衡正规MCP接入包 v1

用途：同源网关 → 正规SDK client → 独立Node子进程stdio server → 三只读工具/三资料资源。不是内存函数冒MCP。SDK固定1.32.1、Zod4.6.7，Node>=20。全部依赖来自npm官方注册表，未运行安装脚本。

## 安全和来源

仅接受当前用户提交的合成调度/合成历史快照与其本地护照摘要。不读取文件、DB、浏览器存储、工业资料或任意URL；无批准/Start/advance/设备控制工具。

快照来自浏览器，**不是认证的数据或服务端原件**。工具输出明确`provenance.kind=client_snapshot, certified=false`；SHA只检查本次一致性，不是签名、独立复验或生产存证。MCP通信真实与数据认证是不同门。

网关只监听127.0.0.1；服务端Bearer token至少32字符，拒绝不匹配Host/Origin、任意tool/role/model字段和过大请求；限制4并发/60请求每分钟。本工具参数、范围和对象白名单服务端执行；权限来自服务端通道而不是浏览器传入角色。面向多账号或工业数据时须接现有服务端身份及对象权限，**本包没有实现多租户账号授权**，不能扩大成企业级安全承诺。

## 部署

1. 将本目录完整源码/lock解包至平台`services/agent-mcp`，不要覆盖原readonly-data或App。`npm ci --ignore-scripts`，`npm test`。
2. 在服务端私密配置创建随机`QH_AGENT_TOKEN`，不能输出到聊天/前端/VITE变量/包。`deploy/env.example`不含真实值。
3. 设置`QH_AGENT_ALLOWED_ORIGINS`为准确候选origin，例如当前4247的HTTPS origin；开发需另列精确localhost origin，不用`*`。
4. 启动`npm start`，默认loopback4249；若已占用可配置未冲突端口，登记进程/用途。不为每视口创建新服务。
5. 修改实际生效Vite/应用代理（包括preview配置）处理`/agent-api`：target=`http://127.0.0.1:<端口>`，changeOrigin=true，rewrite去`/agent-api`前缀；**只在服务端代理层**从QH_AGENT_TOKEN注入Authorization。不要把token写入前端bundle。保持原只读服务代理不变。
6. 生产/候选反向代理必须保留相同服务端鉴权和精确Origin合同，不能为接通而关闭auth或直接公开网关。

## 实际HTTP合同

所有接口由同源代理使用server token；浏览器不得带或获知token。

- GET `/agent-api/status` → `{status:'ok',protocol:'mcp-stdio',mcp:{state:'available',verifiedByThisRequest:false},provider:{state:'not_connected'|'configured',model:'DeepSeek',onlineVerified:false,...}}`。健康响应**不能单独证明协议接通**。
- GET `/agent-api/tools` → 真启动SDK客户端/服务器并initialize/tools/list，返回3项`tools`；页面用此实际发现成功确认MCP联通。
- POST `/agent-api/query` → `{name,arguments,snapshot}`。名称：`get_device_constraints`（unitId）、`get_time_window`（startMinute,endMinute,可选unitId）、`get_passport_evidence`（passportId）。通过真实tools/call返回`{status,data,references,provenance,protocol,requestId}`。业务未知为not_found，schema/参数不合法400，权限拒绝401/403，大小413，超时504。不要把not_found/isError当成功答案。
- GET `/agent-api/resources` → 真实MCP资源发现；GET `/agent-api/resource?uri=<编码的qiheng://docs/...>` → 真实readResource，固定产品/数据/约束三个文档。其他URI拒绝，不能读file/http任意资源。
- POST `/agent-api/model` → `{question,contextId?}`，仅当正式授权/接口合同/服务端配置完备才调用。默认not_connected。没有model参数透传，没有自动工具控制或审批。当前provider未自动消费工具结果，不能据此签“完整模型工具智能体”闭环；模型正式接通后再按官方合同加受控证据摘要消费。

## 前端集成

`browser/build-snapshot.mjs`直接消费真实App `ScenarioRun`/`HistoryFixture`/当前护照摘要，禁止另造演示数据。`buildScheduleSnapshot({run,scenario,observationMinute,passports})`、`buildHistorySnapshot({fixture,observationMinute,passports})`输出严格v1快照。历史能量未做完整积分时保持null，不能为调用填0。捕获所选源/时刻，不随着拖轴改写旧请求。

`browser/request-coordinator.mjs`为无Node/SDK/凭据的浏览器模块。建立一个RequestCoordinator；query(name,args,snapshot)复制本次快照，取消旧请求，使用AbortSignal；旧结果返回superseded，**不能写入新问题**。组件卸载调用cancel。返回工具引用分别按kind=device/window/passport走项目现有navigate/sessionNav，不造第二返回store。API结果不含React状态管理与导航实现，必须在真实AgentWorkspace接好并验收往返。

TypeScript项目复制这些mjs及相应声明或将其转为等价TS，不删除snapshot校验/迟到保护。显示“真实MCP”须工具发现+至少一个实际调用成功；未接就明确不可用或本地确定性（非MCP），不能健康响应冒接通。

## 模型外部合同

QH_MODEL_APPROVED默认false。只有官方确认部署应用API、积分消费、机器鉴权、实际DeepSeek modelID与兼容协议后，服务端配置才可启用。本包只实现显式声明的OpenAI-compatible请求格式，不能猜COSMO私有接口。未知接口/cookie/开发积分/未知密钥不使用，不新增付费。Configured仅为配置存在，不等于真实在线验证。默认不发任何收费模型请求。

## 验证

`npm test`：11项通过（真实stdio协议、三工具/三资源、null/未知/错误、输入和跨源拒绝、SDK实际cancel与timeout、HTTP权限/大小/资源白名单、provider断开/固定ID/脱敏/取消、浏览器快照与迟到保护、App两源映射）。Provider测试只对本机无费用HTTP夹具，不是COSMO模型验证。平台部署/浏览器端实际UI/返回/手机/日间尚需接入后检查，不把本机通过冒整包完成。

来源： https://ts.sdk.modelcontextprotocol.io/server 、https://ts.sdk.modelcontextprotocol.io/client 、https://github.com/modelcontextprotocol/typescript-sdk 。MCP SDK依赖MIT许可见其package，不把依赖复制到源交付包。
