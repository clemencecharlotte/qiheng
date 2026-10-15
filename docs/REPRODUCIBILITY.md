# 固定公开版本的独立复现记录

检查日期：2026-10-15（北京时间）。

- 被检公开commit：`40f735f17bbba3d0381c91496d45c16d04fb9a85`（r44）。
- 对应产品源commit：`979ddc88425479fcfdd2ff5e03250a527f89b927`。
- 来源：从公开GitHub仓重新克隆并detached checkout；没有借用原工作树的node_modules、服务凭据、SQLite或浏览器记录。
- 平台：Windows，Node.js24.16.0、npm11.13.0；Python检查显式使用3.12。
- SOURCE-MANIFEST记录的384件文件在克隆后逐件SHA256匹配。

## 实际执行结果

| 目录 | 命令 | 结果 |
| --- | --- | --- |
| `app` | `npm ci --no-audit --no-fund --cache <独立缓存目录>` | 退出0，安装87个包 |
| `app` | `npm run typecheck` | 退出0 |
| `app` | `npm run build` | 退出0 |
| `app` | `npm test -- --reporter=dot` | 118文件、889项通过，退出0 |
| `services/agent-mcp` | `npm ci --no-audit --no-fund --cache <独立缓存目录>` | 退出0，安装95个包 |
| `services/agent-mcp` | `npm test` | 15项通过，退出0 |
| `services/readonly-data` | `py -3.12 -m unittest discover -s tests -v` | 34项通过，退出0 |

在macOS/Linux或已激活正确Python环境时，最后一条可用`python3 -m unittest discover -s tests -v`；本记录没有宣称已做跨系统复现。

## 环境问题与边界

- 首次直接`npm ci`因本机共享npm缓存临时文件`EEXIST`失败；仅改为独立缓存后成功，未删除全局缓存、提权、使用force或改变项目依赖版本。这是本机缓存问题，不等于产品构建失败。
- Vite8.3.1的Node引擎要求为`^20.19.0 || >=22.12.0`；根README选择推荐22.12+，不能把任意Node22早期版本都称为受支持。
- 构建有单chunk大于500kB提示；测试有SVG title子节点数组的React警告。它们未使本次命令失败；本记录不把警告消失或性能达标列为已验证。
- 后端测试会使用本地隔离夹具/临时HTTP服务，不是对生产设备、官方收费模型或COSMO平台做故障注入。在线模型仍未连接。
- 本记录核的是固定公开源版本的安装、类型、测试与构建，不是最新版视觉、真机触控、启动性能或业务安全认证。
- 本次没有启动新的持久预览服务，也没有替换线上部署。后续产品commit不自动继承这次固定版本结果。

## 默认前端与完整部署的区别

基础前端按根README运行，不要求真实密钥。完整数据/MCP路径须按实际配置提供服务端能力令牌、允许的精确Origin及只监听loopback的后台；缺失能力应明确未连接，不能关闭鉴权或将令牌暴露给浏览器来凑演示。

历史服务README中的旧端口/旧预览地址及未收录的`vite.m07.config.ts`不是本快照的当前一键部署命令；完整代理入口以已收录的`app/vite.m17r01.config.ts`为准。
