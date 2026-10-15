/**
 * 气衡 M06b · 独立数据代理守卫（纯函数，可在 Node/Vitest 单测）。
 *
 * 目标：只放行**固定路由合同**与允许方法；公网浏览器同源写要求精确 Origin/Host；
 * 拒绝 /api/qh-dataevil、双前缀、任意 URL 与外部目标。绝不无条件重写 Origin。
 *
 * 注意：Origin/Host 可被非浏览器客户端伪造，因此这不是生产鉴权；后端仍要求
 * loopback + 本地能力令牌。本守卫用于把 dev 候选的写路径收敛到同源浏览器。
 */

export const DATA_PREFIX = '/api/qh-data'

export interface ProxyPolicy {
  /** 精确 Origin 白名单（区分 http/https 与端口）。 */
  origins: string[]
  /** 精确 Host 头白名单。 */
  hosts: string[]
}

export type HttpMethod = 'GET' | 'POST'

export type GuardResult =
  | { ok: true; rest: string }
  | { ok: false; status: number; error: string }

interface Route {
  re: RegExp
  methods: HttpMethod[]
}

const ROUTES: Route[] = [
  { re: /^\/health$/, methods: ['GET'] },
  { re: /^\/batches$/, methods: ['GET', 'POST'] },
  { re: /^\/batches\/[A-Za-z0-9_-]+$/, methods: ['GET'] },
  { re: /^\/batches\/[A-Za-z0-9_-]+\/observations$/, methods: ['GET'] },
  { re: /^\/batches\/[A-Za-z0-9_-]+\/quality$/, methods: ['GET'] },
  { re: /^\/sources\/[A-Za-z0-9_-]+\/state$/, methods: ['GET'] },
  { re: /^\/events$/, methods: ['GET'] },
  { re: /^\/events\/[A-Za-z0-9_-]+$/, methods: ['GET'] },
]

const DOUBLE_PREFIX = '/' + DATA_PREFIX.slice(1) // '/api/qh-data'

function matchRoute(pathname: string): Route | null {
  for (const r of ROUTES) if (r.re.test(pathname)) return r
  return null
}

export function authorizeProxyRequest(
  method: string,
  rawUrl: string,
  headers: Record<string, string | string[] | undefined>,
  policy: ProxyPolicy,
): GuardResult {
  if (!rawUrl.startsWith(DATA_PREFIX)) return { ok: false, status: 404, error: 'not_data_path' }
  const rest = rawUrl.slice(DATA_PREFIX.length)
  // /api/qh-dataevil -> rest='evil'（不以 / 开头）=> 拒绝
  if (!rest.startsWith('/')) return { ok: false, status: 404, error: 'bad_path' }
  const pathname = rest.split('?')[0]
  // 双前缀 /api/qh-data/api/qh-data/... => 拒绝
  if (pathname.startsWith(DOUBLE_PREFIX)) return { ok: false, status: 404, error: 'bad_path' }

  const route = matchRoute(pathname)
  if (!route) return { ok: false, status: 404, error: 'route_not_allowed' }
  if (!route.methods.includes(method as HttpMethod)) {
    return { ok: false, status: 405, error: 'method_not_allowed' }
  }

  const origin = headers['origin']
  const originStr = Array.isArray(origin) ? origin[0] : origin
  const host = headers['host']
  const hostStr = Array.isArray(host) ? host[0] : host

  if (method === 'POST') {
    // 浏览器写：必须有精确 Origin（缺 / null / 外国一律拒绝）
    if (!originStr || originStr === 'null' || !policy.origins.includes(originStr)) {
      return { ok: false, status: 403, error: 'origin_not_allowed' }
    }
    // 精确 Host 校验（写请求）
    if (!hostStr || !policy.hosts.includes(hostStr)) {
      return { ok: false, status: 403, error: 'host_not_allowed' }
    }
  } else if (originStr && originStr !== 'null' && !policy.origins.includes(originStr)) {
    // GET：带 Origin 时也校验（防御性）
    return { ok: false, status: 403, error: 'origin_not_allowed' }
  }

  return { ok: true, rest }
}
