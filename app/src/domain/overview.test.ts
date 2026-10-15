import { describe, expect, it } from 'vitest'
import { runScenario } from './engine'
import {
  buildOverviewSnapshot,
  OBSERVATION_INDEX,
  selectStagePlan,
} from './overview'
import { FIXED_SEED, UNITS } from './units'

describe('总览观察快照', () => {
  it('读取同一方案的观察时段，需求与序列一致', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED)
    const snapshot = buildOverviewSnapshot(run, run.baseline, 'baseline')
    expect(snapshot.demand).toBe(run.series.points[OBSERVATION_INDEX].demand)
    expect(snapshot.label).toBe(run.series.points[OBSERVATION_INDEX].label)
    expect(snapshot.units).toHaveLength(3)
  })

  it('离心机 AC-03 边界未核实：未知且无支路映射，不补零', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED)
    const snapshot = buildOverviewSnapshot(run, run.baseline, 'baseline')
    const ac03 = snapshot.units.find((u) => u.unit.id === 'AC-03')
    expect(ac03?.state).toBe('unknown')
    expect(ac03?.eligible).toBe(false)
    expect(ac03?.hasBranch).toBe(false)
    expect(ac03?.load).toBeNull()
    expect(ac03?.powerKw).toBeNull()
  })

  it('单机故障场景 AC-01 显示故障态且不生成支路', () => {
    const run = runScenario('unit_failure', UNITS, FIXED_SEED)
    const snapshot = buildOverviewSnapshot(run, run.baseline, 'baseline')
    const ac01 = snapshot.units.find((u) => u.unit.id === 'AC-01')
    expect(ac01?.state).toBe('fault')
    expect(ac01?.hasBranch).toBe(false)
    expect(ac01?.load).toBeNull()
  })

  it('常态建议可行：舞台使用建议策略，设备组合/负载/供气同源', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED)
    const selection = selectStagePlan(run)
    expect(selection.planType).toBe('recommendation')
    expect(selection.feasible).toBe(true)
    const snapshot = buildOverviewSnapshot(run, selection.plan, selection.planType)
    expect(snapshot.planLabel).toContain('建议')
    const period = run.recommendation.periods.find(
      (p) => p.index === OBSERVATION_INDEX,
    )
    expect(snapshot.plannedRunningUnitIds).toEqual(period?.runningUnitIds)
    expect(snapshot.supply).toBe(period?.supply)
  })

  it('常态基线与建议组合不同：可构造不同时段的装备组合 fixture', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED)
    const differing = run.series.points.filter((point) => {
      const b = run.baseline.periods.find((p) => p.index === point.index)
      const r = run.recommendation.periods.find((p) => p.index === point.index)
      return b && r && b.runningUnitIds.join(',') !== r.runningUnitIds.join(',')
    })
    expect(differing.length).toBeGreaterThan(0)
  })

  it('需求突增建议无解：退回基线对照并明确未通过，12:00 不因场景名误判超容量', () => {
    const run = runScenario('surge', UNITS, FIXED_SEED)
    const selection = selectStagePlan(run)
    expect(selection.planType).toBe('baseline')
    const snapshot = buildOverviewSnapshot(run, selection.plan, selection.planType)
    expect(snapshot.planFeasible).toBe(false)
    expect(snapshot.planLabel).toContain('基线对照')
    expect(snapshot.demand).toBe(29.8)
    expect(snapshot.margin).toBeCloseTo(0, 5)
  })
})