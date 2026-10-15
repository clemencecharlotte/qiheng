import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'
import type { Connect } from 'vite'
import { authorizeProxyRequest, DATA_PREFIX, type ProxyPolicy } from './src/integration/proxyGuard.ts'

/**
 * 气衡 M10 r05 · 独立 production preview 配置（隔离树 m16r03；不改 app/vite.config.ts，不写 dist-next）。
 *
 * · 提供 build 用 define + `vite preview` 用同源代理（configurePreviewServer），
 *   使候选真正以 production build + preview 代理服务，而非 Vite dev。
 * · 自实现严格代理：只放行固定路由合同 + 允许方法；写请求要求精确 Origin/Host；
 *   拒绝 /api/qh-dataevil、双前缀、任意 URL；目标只允许 loopback。
 * · 能力令牌由本进程从环境读并注入上游请求，**不下发浏览器**；缺令牌 fail closed。
 * · 只起独立 4245 候选；preview 代理 ≠ 生产部署。
 */
const TARGET = process.env.QH_DATA_TARGET || 'http://127.0.0.1:4246'
const TOKEN = process.env.QH_DATA_TOKEN || ''
const ORIGINS = (process.env.QH_DATA_ALLOWED_ORIGINS ||
  'https://4245-a1db149b692927f8.code.cosmoplat.cn,http://127.0.0.1:4245,http://localhost:4245')
  .split(',').map((s) => s.trim()).filter(Boolean)
const HOSTS = (process.env.QH_DATA_ALLOWED_HOSTS ||
  '4245-a1db149b692927f8.code.cosmoplat.cn,127.0.0.1:4245,localhost:4245')
  .split(',').map((s) => s.trim()).filter(Boolean)

if (!TOKEN) throw new Error('QH_DATA_TOKEN 未设置：独立数据代理 fail closed（拒绝启动）。')

const targetUrl = new URL(TARGET)
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
if (!LOOPBACK.has(targetUrl.hostname)) {
  throw new Error(`QH_DATA_TARGET 必须是 loopback，收到：${targetUrl.hostname}`)
}

const policy: ProxyPolicy = { origins: ORIGINS, hosts: HOSTS }

/** 同源数据代理中间件：dev server 与 preview server 共用同一合同。 */
function qhDataMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (!req.url || !req.url.startsWith(DATA_PREFIX)) return next()
    const method = (req.method || 'GET').toUpperCase()
    const guard = authorizeProxyRequest(method, req.url, req.headers, policy)
    if (!guard.ok) {
      res.statusCode = guard.status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: guard.error }))
      return
    }
    const headers: http.OutgoingHttpHeaders = { ...req.headers }
    headers.host = targetUrl.host
    headers['x-qh-capability'] = TOKEN
    const preq = http.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || 80,
        path: guard.rest,
        method,
        headers,
      },
      (pres) => {
        res.statusCode = pres.statusCode || 502
        for (const [k, v] of Object.entries(pres.headers)) {
          const lk = k.toLowerCase()
          if (v === undefined || lk === 'transfer-encoding' || lk === 'connection') continue
          res.setHeader(k, v as string | string[])
        }
        pres.pipe(res)
      },
    )
    preq.on('error', () => {
      if (!res.headersSent) {
        res.statusCode = 502
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'upstream_unreachable' }))
      }
    })
    req.pipe(preq)
  }
}

function qhDataProxy(): Plugin {
  return {
    name: 'qh-m16r03-data-proxy',
    configureServer(server) {
      server.middlewares.use(qhDataMiddleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(qhDataMiddleware())
    },
  }
}

export default defineConfig({
  plugins: [react(), qhDataProxy()],
  define: {
    __QH_DATA_BASE__: JSON.stringify('/api/qh-data'),
    __QH_DATA_ENABLED__: JSON.stringify('1'),
  },
  server: {
    host: '0.0.0.0',
    port: 4245,
    strictPort: true,
    allowedHosts: ['.cosmoplat.cn', '.cosmoplat.com', '.cosmoplat.net'],
  },
  preview: {
    host: '0.0.0.0',
    port: 4245,
    strictPort: true,
    allowedHosts: ['.cosmoplat.cn', '.cosmoplat.com', '.cosmoplat.net'],
  },
})
