import { describe, expect, it } from 'vitest'
import { runScenario } from './engine'
import { analyzeSupplyGap } from './capacity'
import { FIXED_SEED, UNITS } from './units'

describe('供气缺口容量下界', () => {
  it('逐桶缺口 = max(0, 需求 − 安全可用容量上限)', () => {
    const run = runScenario('surge', UNITS, FIXED_SEED)
    const gap = analyzeSupplyGap(run)
    expect(gap.buckets).toHaveLength(run.series.points.length)
    for (const b of gap.buckets) {
      const expected = Math.max(0, b.demand - gap.availableCapacity)
      expect(b.gap).toBeCloseTo(expected, 3)
    }
  })

  it('常态：容量下界无缺口且存在完整方案', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED)
    const gap = analyzeSupplyGap(run)
    expect(gap.availableCapacity).toBe(32)
    expect(gap.capacityInsufficient).toBe(false)
    expect(gap.planFeasible).toBe(true)
    expect(gap.title).toBe('容量下界满足')
    expect(gap.gapBucketCount).toBe(0)
  })

  it('需求突增：安全可用容量不足，不能用“求解器失败”草率归因', () => {
    const run = runScenario('surge', UNITS, FIXED_SEED)
    const gap = analyzeSupplyGap(run)
    expect(gap.availableCapacity).toBe(32)
    expect(gap.planFeasible).toBe(false)
    expect(gap.capacityInsufficient).toBe(true)
    expect(gap.title).toBe('安全可用容量不足')
    expect(gap.gapBucketCount).toBeGreaterThan(0)
    expect(gap.peakGap).toBeGreaterThan(0)
    expect(gap.statement).toContain('安全可用容量不足')
  })

  it('单机故障：候选只剩 AC-02，容量下界说明随之下降', () => {
    const run = runScenario('unit_failure', UNITS, FIXED_SEED)
    const gap = analyzeSupplyGap(run)
    expect(gap.candidates).toEqual(['AC-02'])
    expect(gap.availableCapacity).toBe(12)
    expect(gap.capacityInsufficient).toBe(true)
    expect(gap.excluded.some((e) => e.unitId === 'AC-01')).toBe(true)
  })

  it('AC-03 始终被排除，且不修改真实需求', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED)
    const before = run.series.points.map((p) => p.demand)
    const gap = analyzeSupplyGap(run)
    expect(gap.candidates).not.toContain('AC-03')
    expect(gap.excluded.some((e) => e.unitId === 'AC-03')).toBe(true)
    expect(run.series.points.map((p) => p.demand)).toEqual(before)
  })

  it('说明声明为合成容量下界，不是已执行供气或收益', () => {
    const gap = analyzeSupplyGap(runScenario('surge', UNITS, FIXED_SEED))
    expect(gap.note).toContain('容量下界')
    expect(gap.note).toContain('不是已执行供气')
  })
})
