/**
 * 气衡 M06 · 只读数据客户端（typed）。
 *
 * · base 固定同源前缀（默认 /api/qh-data），不做任意 URL 代理。
 * · 能力令牌默认由 dev 代理在服务端注入，浏览器侧无需持有；
 *   测试可显式传 token。绝不把令牌写进日志。
 */
import type {
  BatchList,
  BatchSummary,
  EventList,
  EventQuery,
  GovernanceEvent,
  HealthInfo,
  ImportResult,
  ObservationList,
  QualityReport,
  SourceState,
} from './contracts'

export class DataApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) {
    super(`data api error: ${status} ${code}`)
    this.name = 'DataApiError'
    this.status = status
    this.code = code
  }
}

export interface DataClientOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  token?: string
}

export interface ImportOptions {
  format: 'csv' | 'json'
  filename: string
  sourceId?: string
}

export function createDataClient(opts: DataClientOptions = {}) {
  const baseUrl = (opts.baseUrl ?? '/api/qh-data').replace(/\/$/, '')
  const fetchImpl = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined)

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    if (!fetchImpl) throw new DataApiError(0, 'no_fetch')
    const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) }
    if (opts.token) headers['X-QH-Capability'] = opts.token
    let res: Response
    try {
      res = await fetchImpl(baseUrl + path, { ...init, headers })
    } catch {
      throw new DataApiError(0, 'network_error')
    }
    const text = await res.text()
    let body: unknown = {}
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = {}
      }
    }
    if (!res.ok) {
      const code = (body as { error?: string }).error ?? 'http_error'
      throw new DataApiError(res.status, code)
    }
    return body as T
  }

  return {
    baseUrl,
    health: () => call<HealthInfo>('/health'),
    listBatches: (limit = 50, offset = 0) => call<BatchList>(`/batches?limit=${limit}&offset=${offset}`),
    getBatch: (id: string) => call<BatchSummary>(`/batches/${encodeURIComponent(id)}`),
    getObservations: (id: string, limit = 200, offset = 0) =>
      call<ObservationList>(`/batches/${encodeURIComponent(id)}/observations?limit=${limit}&offset=${offset}`),
    getQuality: (id: string) => call<QualityReport>(`/batches/${encodeURIComponent(id)}/quality`),
    getSourceState: (id: string) => call<SourceState>(`/sources/${encodeURIComponent(id)}/state`),
    listEvents: (q: EventQuery = {}) => {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(q)) {
        if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
      }
      const qs = params.toString()
      return call<EventList>(`/events${qs ? `?${qs}` : ''}`)
    },
    getEvent: (id: string) => call<GovernanceEvent>(`/events/${encodeURIComponent(id)}`),
    importBatch: (body: string, o: ImportOptions) => {
      const q = new URLSearchParams({ format: o.format, filename: o.filename })
      if (o.sourceId) q.set('sourceId', o.sourceId)
      return call<ImportResult>(`/batches?${q.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': o.format === 'csv' ? 'text/csv' : 'application/json' },
        body,
      })
    },
  }
}

export type DataClient = ReturnType<typeof createDataClient>
