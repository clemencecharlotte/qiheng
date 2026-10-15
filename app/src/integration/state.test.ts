import { describe, expect, it } from 'vitest'
import { CONNECTION_LABEL, deriveConnection, describeAge, formatDuration, parseTime } from './state'
import type { SourceState } from './contracts'

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0)
const STALE = 15 * 60 * 1000

function src(over: Partial<SourceState> = {}): SourceState {
  return {
    sourceId: 's1', configured: true,
    sourceObservedAt: '2026-10-07T11:55:00.000Z',
    receivedAt: new Date(NOW - 60 * 1000).toISOString(),
    heartbeatAt: new Date(NOW - 5 * 1000).toISOString(),
    status: 'unconfigured', observationCount: 1, ruleVersion: 'v1',
    ...over,
  }
}

describe('M06 connection state (clock injected)', () => {
  it('unconfigured when disabled', () => {
    expect(deriveConnection({ enabled: false, staleMs: STALE, now: NOW }).status).toBe('unconfigured')
  })
  it('offline on network error, error on api error', () => {
    expect(deriveConnection({ enabled: true, networkError: true, staleMs: STALE, now: NOW }).status).toBe('offline')
    expect(deriveConnection({ enabled: true, apiError: true, staleMs: STALE, now: NOW }).status).toBe('error')
  })
  it('unconfigured when no source yet', () => {
    expect(deriveConnection({ enabled: true, sourceState: null, staleMs: STALE, now: NOW }).status).toBe('unconfigured')
  })
  it('stale when recent receipt older than threshold', () => {
    const old = src({ receivedAt: new Date(NOW - 40 * 60 * 1000).toISOString() })
    const r = deriveConnection({ enabled: true, sourceState: old, staleMs: STALE, now: NOW })
    expect(r.status).toBe('stale')
    expect(r.reason).toContain('分钟')
  })
  it('fresh offline batch is offline, never live', () => {
    const r = deriveConnection({ enabled: true, sourceState: src(), staleMs: STALE, now: NOW })
    expect(r.status).toBe('offline')
    expect(r.status).not.toBe('live')
    expect(CONNECTION_LABEL[r.status]).toBe('离线')
  })
  it('formatDuration + parseTime', () => {
    expect(formatDuration(45 * 1000)).toBe('45 秒')
    expect(formatDuration(5 * 60 * 1000)).toBe('5 分钟')
    expect(formatDuration(3 * 3600 * 1000)).toBe('3 小时')
    expect(parseTime('not-a-time')).toBeNull()
    expect(parseTime(null)).toBeNull()
  })

  it('describeAge tolerates small future skew, flags large drift, never fabricates zero', () => {
    const now = 1_000_000
    expect(describeAge(now, new Date(now - 60_000).toISOString())).toBe('1 分钟前')
    expect(describeAge(now, new Date(now + 500).toISOString())).toBe('刚刚') // 容差内，如实“刚刚”
    expect(describeAge(now, new Date(now + 5_000).toISOString())).toContain('时钟偏移') // 超出容差
    expect(describeAge(now, null)).toBe('—')
  })
})
