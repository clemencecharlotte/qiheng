import { describe, expect, it } from 'vitest'
import { formatLoadPercent, ratioFromLoad } from './hostPlayback'

describe('M29 r20 · 负载比例回归（修复 1970%）', () => {
  it('绝对 m³/min 与额定容量推真实比例，不把绝对值当比例', () => {
    expect(formatLoadPercent(ratioFromLoad(19.7, 20))).toBe('98.5%')
    expect(ratioFromLoad(19.7, 20)).toBeCloseTo(0.985, 3)
  })
  it('非有限 / 额定缺失或 ≤0 → 未知（不 clamp 掩盖）', () => {
    expect(ratioFromLoad(Number.NaN, 20)).toBeNull()
    expect(ratioFromLoad(19.7, null)).toBeNull()
    expect(ratioFromLoad(19.7, 0)).toBeNull()
    expect(formatLoadPercent(null)).toBe('未知')
  })
  it('真实 unitLoadRatios 直接乘 100（不再退化为 1970）', () => {
    expect(formatLoadPercent(0.985)).toBe('98.5%')
    expect(formatLoadPercent(1.7)).toBe('170.0%')
  })
})
