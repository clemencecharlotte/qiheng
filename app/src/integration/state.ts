/**
 * 气衡 M06 · 连接/新鲜度状态（纯函数，时钟可注入）。
 *
 * 连接状态语义（本片无实时接入，绝不伪造 live）：
 *   unconfigured 未配置服务 / 尚无来源
 *   connecting   请求进行中（UI 用）
 *   live         实时来源正在产数据（本片不会出现）
 *   stale        有批次但最近接收时间超过陈旧阈值
 *   offline      服务不可达 / 仅有离线批次、无实时连接
 *   error        服务返回错误
 *
 * 观察时间 / 接收时间 / 服务心跳 三者分开，见 SourceState。
 */
import type { ConnectionStatus, SourceState } from './contracts'

export interface ConnectionInput {
  enabled: boolean
  networkError?: boolean
  apiError?: boolean
  sourceState?: SourceState | null
  staleMs: number
  now: number
}

export interface ConnectionResult {
  status: ConnectionStatus
  reason: string
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} 分钟`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} 小时`
  return `${Math.round(h / 24)} 天`
}

export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** 服务心跳等可能比本地时钟快数百毫秒：给一个小容差，避免误显“距今—”。
 *  不篡改服务时间、不造零；超出容差的未来时间如实标注“时钟偏移”。 */
export const CLOCK_SKEW_TOLERANCE_MS = 2000

export function describeAge(now: number, iso: string | null | undefined, tolMs: number = CLOCK_SKEW_TOLERANCE_MS): string {
  const t = parseTime(iso)
  if (t === null) return '—'
  const delta = now - t
  if (delta < -tolMs) return '服务时间晚于本地钟（时钟偏移）'
  if (delta < 0) return '刚刚'
  return `${formatDuration(delta)}前`
}

export function deriveConnection(input: ConnectionInput): ConnectionResult {
  if (!input.enabled) return { status: 'unconfigured', reason: '只读数据服务未配置' }
  if (input.networkError) return { status: 'offline', reason: '无法连接只读数据服务' }
  if (input.apiError) return { status: 'error', reason: '只读数据服务返回错误' }
  if (!input.sourceState || !input.sourceState.configured) {
    return { status: 'unconfigured', reason: '尚未导入任何批次' }
  }
  const received = parseTime(input.sourceState.receivedAt)
  if (received !== null && input.now - received > input.staleMs) {
    return {
      status: 'stale',
      reason: `最近批次距今 ${formatDuration(input.now - received)}（超过陈旧阈值）`,
    }
  }
  return { status: 'offline', reason: '仅有离线批次，无实时连接' }
}

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  unconfigured: '未配置',
  connecting: '连接中',
  live: '实时',
  stale: '陈旧',
  offline: '离线',
  error: '错误',
}
