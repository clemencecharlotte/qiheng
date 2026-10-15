import { describe, expect, it } from 'vitest'
import { deriveSourceFreshness, FUTURE_SKEW_MS } from './freshness'

const STALE = 15 * 60 * 1000
const NOW = Date.parse('2026-10-09T12:00:00.000Z')

describe('M12 r02 来源观测时效（sourceObservedAt 判定）', () => {
  it('新心跳不掩盖旧观测：2026-01 旧观测 + 无关心跳 → stale（反例1）', () => {
    // 观测时间是 2026-01（远旧于 now），心跳时间再新也不改变观测时效。
    expect(deriveSourceFreshness('2026-01-05T00:00:00.000Z', NOW, STALE)).toBe('stale')
  })

  it('null / 非法观测 → unknown，绝不冒充 fresh（反例2）', () => {
    expect(deriveSourceFreshness(null, NOW, STALE)).toBe('unknown')
    expect(deriveSourceFreshness(undefined, NOW, STALE)).toBe('unknown')
    expect(deriveSourceFreshness('not-a-date', NOW, STALE)).toBe('unknown')
    expect(deriveSourceFreshness('', NOW, STALE)).toBe('unknown')
  })

  it('明显未来 → unknown（不误判）', () => {
    const future = new Date(NOW + FUTURE_SKEW_MS * 10).toISOString()
    expect(deriveSourceFreshness(future, NOW, STALE)).toBe('unknown')
  })

  it('真实时效：新鲜→fresh；超过阈值→stale；轻微时钟偏差仍按实际', () => {
    expect(deriveSourceFreshness(new Date(NOW - 60_000).toISOString(), NOW, STALE)).toBe('fresh')
    expect(deriveSourceFreshness(new Date(NOW - STALE - 1000).toISOString(), NOW, STALE)).toBe('stale')
    expect(deriveSourceFreshness(new Date(NOW + 1000).toISOString(), NOW, STALE)).toBe('fresh')
  })
})
