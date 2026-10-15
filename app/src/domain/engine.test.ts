import { describe, expect, it } from 'vitest'
import {
  allocateLoads,
  evaluateUnits,
  planBaseline,
  planRecommendation,
  runScenario,
} from './engine'
import { FIXED_SEED, UNITS } from './units'
import { STEP_MINUTES } from './demand'
import type { DemandPoint, SyntheticSeries, Unit } from './types'

function makeSeries(
  demands: number[],
  stepMinutes: number = STEP_MINUTES,
): SyntheticSeries {
  const points: DemandPoint[] = demands.map((demand, index) => ({
    index,
    minuteOfDay: index * stepMinutes,
    label: `T${index}`,
    demand,
  }))
  return {
    seed: 1,
    scenario: 'normal',
    scenarioLabel: 'test',
    synthetic: true,
    stepMinutes,
    points,
    note: 'unit-test series',
  }
}

function cloneUnits(): Unit[] {
  return UNITS.map((u) => ({ ...u }))
}

function copyWithoutParam(id: string, field: keyof Unit): Unit[] {
  return cloneUnits().map((u) =>
    u.id === id ? ({ ...u, [field]: undefined } as unknown as Unit) : u,
  )
}

describe('供气不足', () => {
  it('需求突增场景下建议返回无可行方案并说明原因', () => {
    const run = runScenario('surge')
    expect(run.recommendation.feasible).toBe(false)
    expect(run.recommendation.periods).toHaveLength(0)
    expect(run.recommendation.infeasibleReasons.length).toBeGreaterThan(0)
    expect(run.recommendation.infeasiblePeriods.length).toBeGreaterThan(0)
    expect(run.recommendation.infeasiblePeriods[0].reason).toContain('安全可用容量')
  })

  it('基线在超出供气能力时给出供气不足约束违规', () => {
    const run = runScenario('surge')
    const types = new Set(
      run.baseline.periods.flatMap((p) => p.violations.map((v) => v.type)),
    )
    expect(types.has('supply_shortage')).toBe(true)
  })

  it('自定义超容量序列同样判定无可行建议', () => {
    const series = makeSeries([10, 35, 10])
    const evaluation = evaluateUnits(UNITS, 'normal')
    const rec = planRecommendation(series, evaluation.candidates, UNITS, [])
    expect(rec.feasible).toBe(false)
    expect(rec.infeasiblePeriods).toHaveLength(1)
    expect(rec.infeasiblePeriods[0].index).toBe(1)
  })
})

describe('最小稳定负载', () => {
  it('分配时可将负载率抬升到最小稳定负载', () => {
    const ac01 = UNITS[0]
    const alloc = allocateLoads([ac01], 2, true)
    expect(alloc.loads[ac01.id]).toBeCloseTo(ac01.ratedCapacity * ac01.minLoadRatio, 5)
    expect(alloc.ratios[ac01.id]).toBeCloseTo(ac01.minLoadRatio, 5)
  })

  it('基线会出现最小稳定负载违规，建议不出现', () => {
    const series = makeSeries([2, 2, 2])
    const evaluation = evaluateUnits(UNITS, 'normal')
    const baseline = planBaseline(series, evaluation.candidates, UNITS, [])
    const rec = planRecommendation(series, evaluation.candidates, UNITS, [])
    const baselineMin = baseline.periods.flatMap((p) =>
      p.violations.filter((v) => v.type === 'min_load'),
    )
    const recMin = rec.periods.flatMap((p) =>
      p.violations.filter((v) => v.type === 'min_load'),
    )
    expect(baselineMin.length).toBeGreaterThan(0)
    expect(recMin).toHaveLength(0)
  })
})

describe('最小启停间隔', () => {
  it('建议遵守最小启停间隔，基线在频繁投切时违规', () => {
    const series = makeSeries([5, 30, 5, 30, 5, 30], 5)
    const evaluation = evaluateUnits(UNITS, 'normal')
    const baseline = planBaseline(series, evaluation.candidates, UNITS, [])
    const rec = planRecommendation(series, evaluation.candidates, UNITS, [])
    const baselineInterval = baseline.periods.flatMap((p) =>
      p.violations.filter((v) => v.type === 'start_stop_interval'),
    )
    const recInterval = rec.periods.flatMap((p) =>
      p.violations.filter((v) => v.type === 'start_stop_interval'),
    )
    expect(baselineInterval.length).toBeGreaterThan(0)
    expect(rec.feasible).toBe(true)
    expect(recInterval).toHaveLength(0)
  })

  it('锁定中的机组不会被提前停机', () => {
    const series = makeSeries([30, 5, 5, 5, 5, 5, 5, 5])
    const evaluation = evaluateUnits(UNITS, 'normal')
    const rec = planRecommendation(series, evaluation.candidates, UNITS, [])
    expect(rec.feasible).toBe(true)
    const first = rec.periods[0]
    expect(first.switches).toBeGreaterThan(0)
    const intervalViolations = rec.periods.flatMap((p) =>
      p.violations.filter((v) => v.type === 'start_stop_interval'),
    )
    expect(intervalViolations).toHaveLength(0)
  })
})

describe('关键参数缺失', () => {
  it('缺失供气能力的机组被排除并给出原因', () => {
    const units = copyWithoutParam('AC-02', 'ratedCapacity')
    const evaluation = evaluateUnits(units, 'normal')
    const ac02 = evaluation.eligibility.find((e) => e.unitId === 'AC-02')
    expect(ac02?.eligible).toBe(false)
    expect(ac02?.reason).toContain('关键参数缺失')
    expect(evaluation.candidates.map((u) => u.id)).toEqual(['AC-01'])
  })

  it('候选因关键参数缺失导致容量不足时返回无可行建议', () => {
    const units = copyWithoutParam('AC-01', 'ratedCapacity')
    const series = makeSeries([15, 18, 16])
    const evaluation = evaluateUnits(units, 'normal')
    const rec = planRecommendation(series, evaluation.candidates, units, [])
    expect(rec.feasible).toBe(false)
    expect(rec.infeasibleReasons.length).toBeGreaterThan(0)
  })

  it('全部候选缺失关键参数时不编造方案', () => {
    let units = copyWithoutParam('AC-01', 'ratedCapacity')
    units = units.map((u) =>
      u.id === 'AC-02' ? ({ ...u, ratedPower: undefined } as unknown as Unit) : u,
    )
    const series = makeSeries([10])
    const evaluation = evaluateUnits(units, 'normal')
    expect(evaluation.candidates).toHaveLength(0)
    const rec = planRecommendation(series, evaluation.candidates, units, [])
    expect(rec.feasible).toBe(false)
  })
})

describe('离心机喘振边界', () => {
  it('离心机因喘振边界未核实被排除出自动调度候选', () => {
    const evaluation = evaluateUnits(UNITS, 'normal')
    const ac03 = evaluation.eligibility.find((e) => e.unitId === 'AC-03')
    expect(ac03?.eligible).toBe(false)
    expect(ac03?.reason).toContain('喘振')
    expect(evaluation.candidates.map((u) => u.id)).toEqual(['AC-01', 'AC-02'])
  })
})

describe('确定性与合成数据', () => {
  it('相同种子与场景输出完全一致', () => {
    const a = runScenario('normal', UNITS, FIXED_SEED)
    const b = runScenario('normal', UNITS, FIXED_SEED)
    expect(JSON.stringify(a.baseline)).toBe(JSON.stringify(b.baseline))
    expect(JSON.stringify(a.recommendation)).toBe(JSON.stringify(b.recommendation))
  })

  it('常态场景建议可行且覆盖全部时段', () => {
    const run = runScenario('normal')
    expect(run.recommendation.feasible).toBe(true)
    expect(run.recommendation.periods).toHaveLength(96)
    expect(run.recommendation.violationCount).toBe(0)
  })

  it('单机故障场景候选减少并按故障排除', () => {
    const run = runScenario('unit_failure')
    expect(run.evaluation.candidates.map((u) => u.id)).toEqual(['AC-02'])
    const ac01 = run.evaluation.eligibility.find((e) => e.unitId === 'AC-01')
    expect(ac01?.reason).toContain('故障')
  })
})