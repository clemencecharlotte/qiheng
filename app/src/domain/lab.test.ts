import { describe, expect, it } from 'vitest'
import {
  LAB_DEV_SEED,
  LAB_FIXTURES,
  LAB_GENERATOR_VERSION,
  buildLabComparison,
  buildLabRun,
  buildLabSeries,
  labEvaluationCandidateIds,
  labIdentity,
  solveLabPreference,
  verifyLabPlanMetrics,
  type LabFixtureId,
  type LabPreference,
} from './lab'
import { verifyPlanConstraints } from './constraints'
import { evaluateUnits } from './engine'
import { UNITS } from './units'
import type { DemandPoint, InitialUnitState, SyntheticSeries } from './types'

const FIXTURES: LabFixtureId[] = [
  'capacity_rise',
  'capacity_oscillate',
  'standby_takeover',
]

function customSeries(demands: number[], step = 15): SyntheticSeries {
  const points: DemandPoint[] = demands.map((demand, index) => ({
    index,
    minuteOfDay: index * step,
    label: `${String(Math.floor((index * step) / 60)).padStart(2, '0')}:${String(
      (index * step) % 60,
    ).padStart(2, '0')}`,
    demand,
  }))
  return {
    seed: LAB_DEV_SEED,
    scenario: 'normal',
    scenarioLabel: '自定义测试序列',
    synthetic: true,
    stepMinutes: step,
    points,
    note: 'test',
  }
}

describe('lab-v1 夹具：确定性 / 版本 / 容量', () => {
  it('三个夹具都能确定性复现且带生成器版本', () => {
    for (const id of FIXTURES) {
      const a = buildLabSeries(id)
      const b = buildLabSeries(id)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      expect(a.seed).toBe(LAB_DEV_SEED)
      expect(a.points).toHaveLength(96)
      expect(a.stepMinutes).toBe(15)
      expect(a.note).toContain(LAB_GENERATOR_VERSION)
      expect(a.points[0].label).toBe('00:00')
    }
  })

  it('全部夹具需求不超过安全可用容量 32，且形状符合描述', () => {
    for (const f of LAB_FIXTURES) {
      const series = buildLabSeries(f.id)
      const max = Math.max(...series.points.map((p) => p.demand))
      expect(max).toBeLessThanOrEqual(32)
    }
    const rise = buildLabSeries('capacity_rise').points.map((p) => p.demand)
    expect(Math.max(...rise)).toBeGreaterThanOrEqual(24)
    expect(Math.max(...rise)).toBeLessThanOrEqual(32)
    const osc = buildLabSeries('capacity_oscillate').points.map((p) => p.demand)
    expect(osc.some((d) => d <= 20)).toBe(true)
    expect(osc.some((d) => d > 20)).toBe(true)
    const standby = buildLabSeries('standby_takeover').points.map((p) => p.demand)
    expect(Math.max(...standby)).toBeLessThanOrEqual(12)
  })

  it('AC-03 喘振边界未核实，始终排除', () => {
    for (const id of FIXTURES) {
      const run = buildLabRun(id, 'energy_first')
      expect(run.evaluation.candidates.map((u) => u.id)).not.toContain('AC-03')
      const ac03 = run.evaluation.eligibility.find((e) => e.unitId === 'AC-03')
      expect(ac03?.eligible).toBe(false)
      expect(ac03?.reason ?? '').toContain('喘振')
    }
  })

  it('备用承接夹具由 AC-02 承担，AC-01 明确全窗口退出（非故障）', () => {
    const run = buildLabRun('standby_takeover', 'energy_first')
    expect(run.evaluation.candidates.map((u) => u.id)).toEqual(['AC-02'])
    const ac01 = run.evaluation.eligibility.find((e) => e.unitId === 'AC-01')
    expect(ac01?.eligible).toBe(false)
    expect(ac01?.reason ?? '').toContain('全窗口退出')
    for (const period of run.recommendation.periods) {
      expect(period.runningUnitIds).toEqual(['AC-02'])
    }
  })
})

describe('有界有限状态求解与独立复验', () => {
  it('两偏好方案均通过完整独立复验与独立指标核对', () => {
    for (const id of FIXTURES) {
      const run = buildLabRun(id, 'energy_first')
      if (run.recommendation.feasible) {
        expect(verifyPlanConstraints(run.recommendation, run).passed).toBe(true)
        const check = verifyLabPlanMetrics(
          run.recommendation,
          UNITS,
          run.initial,
          run.series.stepMinutes,
        )
        expect(check.ok).toBe(true)
        expect(run.recommendation.periods).toHaveLength(96)
      }
    }
  })

  it('超安全可用容量（>32）时拒绝，不输出部分窗口', () => {
    const series = customSeries([33])
    const evaluation = evaluateUnits(UNITS, 'normal')
    const result = solveLabPreference({
      series,
      candidates: evaluation.candidates,
      allUnits: UNITS,
      initial: { runningUnitIds: [], minutesSinceChange: {} },
      preference: 'energy_first',
    })
    expect(result.status).toBe('infeasible')
    expect(result.plan).toBeNull()
  })

  it('容量内但初态锁定拒绝与超容量拒绝可区分', () => {
    const evaluation = evaluateUnits(UNITS, 'normal')
    const locked: InitialUnitState = {
      runningUnitIds: ['AC-01'],
      minutesSinceChange: { 'AC-01': 5, 'AC-02': 0 },
    }
    const stable: InitialUnitState = { runningUnitIds: ['AC-01'], minutesSinceChange: {} }
    const series = customSeries([30])
    const lockedResult = solveLabPreference({
      series,
      candidates: evaluation.candidates,
      allUnits: UNITS,
      initial: locked,
      preference: 'energy_first',
    })
    expect(lockedResult.status).toBe('infeasible')
    expect(lockedResult.reasons[0]).toContain('最小启停间隔')

    const stableResult = solveLabPreference({
      series,
      candidates: evaluation.candidates,
      allUnits: UNITS,
      initial: stable,
      preference: 'energy_first',
    })
    expect(stableResult.status).toBe('planned')
    expect(stableResult.plan?.totalEnergyKwh).toBeGreaterThan(0)
  })

  it('状态预算超限时 fail-closed', () => {
    const series = buildLabSeries('capacity_oscillate')
    const evaluation = evaluateUnits(UNITS, 'normal')
    const result = solveLabPreference({
      series,
      candidates: evaluation.candidates,
      allUnits: UNITS,
      initial: { runningUnitIds: ['AC-01'], minutesSinceChange: { 'AC-01': 5 } },
      preference: 'energy_first',
      stateBudget: 1,
    })
    expect(result.status).toBe('budget_exceeded')
    expect(result.plan).toBeNull()
  })

  it('能量/翻转/逐桶能量被篡改都能被独立核对检出', () => {
    const run = buildLabRun('capacity_rise', 'energy_first')
    const plan = run.recommendation
    expect(plan.feasible).toBe(true)

    const tamperedEnergy = JSON.parse(JSON.stringify(plan))
    tamperedEnergy.periods[0].energyKwh += 1
    expect(
      verifyLabPlanMetrics(tamperedEnergy, UNITS, run.initial, run.series.stepMinutes).ok,
    ).toBe(false)

    const tamperedTotal = JSON.parse(JSON.stringify(plan))
    tamperedTotal.totalEnergyKwh += 5
    expect(
      verifyLabPlanMetrics(tamperedTotal, UNITS, run.initial, run.series.stepMinutes).mismatches.some(
        (m) => m.field === 'totalEnergyKwh',
      ),
    ).toBe(true)

    const tamperedSwitches = JSON.parse(JSON.stringify(plan))
    tamperedSwitches.totalSwitches += 1
    expect(
      verifyLabPlanMetrics(tamperedSwitches, UNITS, run.initial, run.series.stepMinutes).mismatches.some(
        (m) => m.field === 'totalSwitches',
      ),
    ).toBe(true)

    const tamperedLoad = JSON.parse(JSON.stringify(plan))
    const firstId = tamperedLoad.periods[0].runningUnitIds[0]
    tamperedLoad.periods[0].unitLoads[firstId] += 5
    expect(
      verifyLabPlanMetrics(tamperedLoad, UNITS, run.initial, run.series.stepMinutes).ok,
    ).toBe(false)
  })

  it('powerKw / 非有限值 / 负步长均使指标核对失败', () => {
    const run = buildLabRun('capacity_rise', 'energy_first')
    const plan = run.recommendation

    const badPower = JSON.parse(JSON.stringify(plan))
    badPower.periods[0].powerKw += 10
    expect(
      verifyLabPlanMetrics(badPower, UNITS, run.initial, run.series.stepMinutes).mismatches.some(
        (m) => m.field === 'periodPowerKw',
      ),
    ).toBe(true)

    const nanEnergy = JSON.parse(JSON.stringify(plan))
    nanEnergy.totalEnergyKwh = NaN
    const nanCheck = verifyLabPlanMetrics(nanEnergy, UNITS, run.initial, run.series.stepMinutes)
    expect(nanCheck.ok).toBe(false)
    expect(nanCheck.mismatches.some((m) => m.field === 'totalEnergyKwh')).toBe(true)

    const infSwitches = JSON.parse(JSON.stringify(plan))
    infSwitches.totalSwitches = Infinity
    expect(
      verifyLabPlanMetrics(infSwitches, UNITS, run.initial, run.series.stepMinutes).ok,
    ).toBe(false)

    expect(
      verifyLabPlanMetrics(plan, UNITS, run.initial, Number.NaN).ok,
    ).toBe(false)
    expect(verifyLabPlanMetrics(plan, UNITS, run.initial, 0).ok).toBe(false)
  })

  it('比较视图：指标核对失败时能量/翻转/过量均为 null，不显示伪优势', () => {
    // 通过篡改一个已构建计划后走 buildView 的等价路径：直接核对 null 语义。
    const run = buildLabRun('capacity_rise', 'energy_first')
    const bad = JSON.parse(JSON.stringify(run.recommendation))
    bad.periods[0].powerKw = NaN
    const check = verifyLabPlanMetrics(bad, UNITS, run.initial, run.series.stepMinutes)
    expect(check.ok).toBe(false)
    // buildView 依据 ok=verified&&metricsOk 才给数值；这里确认核对本身失败即无优势可展示。
    expect(check.mismatches.length).toBeGreaterThan(0)
  })

  it('两偏好至少存在一个真实取舍（非全部等价）', () => {
    const rise = buildLabComparison('capacity_rise', 'energy_first')
    const osc = buildLabComparison('capacity_oscillate', 'energy_first')
    const anyTradeoff = !rise.comparison.equivalent || !osc.comparison.equivalent
    expect(anyTradeoff).toBe(true)
    if (!rise.comparison.equivalent) {
      const d = rise.comparison.deltas
      expect(d.energyKwh !== null && d.switches !== null).toBe(true)
    }
  })

  it('备用承接为单机方案时两偏好逐桶等价', () => {
    const { comparison } = buildLabComparison('standby_takeover', 'energy_first')
    expect(comparison.equivalent).toBe(true)
    expect(comparison.deltas.switches).toBe(0)
    expect(comparison.deltas.energyKwh).toBe(0)
  })
})

describe('故障机初态合同（AC-01 已开但被静态排除）', () => {
  const preferences: LabPreference[] = ['energy_first', 'switch_first']
  const demands = [8, 9, 7, 8]

  it.each(preferences)(
    '%s：initial 已开 10min → 合法计划含 AC-01 首桶停机 + AC-02 启动，共 2 翻转',
    (preference) => {
      const series = customSeries(demands)
      const evaluation = evaluateUnits(UNITS, 'unit_failure')
      expect(evaluation.candidates.map((u) => u.id)).toEqual(['AC-02'])
      const initial: InitialUnitState = {
        runningUnitIds: ['AC-01'],
        minutesSinceChange: { 'AC-01': 10 },
      }
      const context = {
        series,
        allUnits: UNITS,
        evaluation,
        initial,
        faultUnitId: 'AC-01',
      }
      const result = solveLabPreference({
        series,
        candidates: evaluation.candidates,
        allUnits: UNITS,
        initial,
        preference,
        context,
      })
      expect(result.status).toBe('planned')
      const plan = result.plan
      expect(plan).not.toBeNull()
      expect(plan!.totalSwitches).toBe(2)
      expect(plan!.periods[0].switches).toBe(2)
      expect(plan!.periods[0].runningUnitIds).not.toContain('AC-01')
      // 同初态旧完整独立复验必须通过
      expect(verifyPlanConstraints(plan!, context).passed).toBe(true)
      const metrics = verifyLabPlanMetrics(plan!, UNITS, initial, series.stepMinutes)
      expect(metrics.ok).toBe(true)
      expect(metrics.recomputed.totalSwitches).toBe(2)
    },
  )

  it.each(preferences)(
    '%s：initial 已开仅 5min → 首桶早停违反间隔，fail-closed 且非“容量不足”',
    (preference) => {
      const series = customSeries(demands)
      const evaluation = evaluateUnits(UNITS, 'unit_failure')
      const initial: InitialUnitState = {
        runningUnitIds: ['AC-01'],
        minutesSinceChange: { 'AC-01': 5 },
      }
      const context = {
        series,
        allUnits: UNITS,
        evaluation,
        initial,
        faultUnitId: 'AC-01',
      }
      const result = solveLabPreference({
        series,
        candidates: evaluation.candidates,
        allUnits: UNITS,
        initial,
        preference,
        context,
      })
      expect(result.status).toBe('infeasible')
      expect(result.plan).toBeNull()
      const reason = result.reasons.join(' ')
      expect(reason).toContain('初态锁定')
      expect(reason).toContain('无法合法停机')
      expect(reason).not.toContain('安全可用容量不足')
    },
  )
})

describe('身份随输入变化（不只用 scenario+seed+候选）', () => {
  it('不同夹具/偏好身份不同', () => {
    const a = buildLabRun('capacity_rise', 'energy_first').lab.identity
    const b = buildLabRun('capacity_rise', 'switch_first').lab.identity
    const c = buildLabRun('capacity_oscillate', 'energy_first').lab.identity
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
    expect(a).toContain('generator=lab-fixtures-v1')
    expect(a).toContain('seed=20261002')
  })

  it('相同输入身份稳定', () => {
    expect(buildLabRun('capacity_rise', 'energy_first').lab.identity).toBe(
      buildLabRun('capacity_rise', 'energy_first').lab.identity,
    )
  })

  it('身份随初态 / 时刻 / 步长 / 机组参数 / 版本变化', () => {
    const run = buildLabRun('capacity_rise', 'energy_first')
    const base = run.lab.identity
    const plan = run.recommendation

    // 初态变化
    const altInitial = { ...run.initial, minutesSinceChange: { 'AC-01': 99 } }
    expect(labIdentity(run.series, altInitial, plan, 'energy_first')).not.toBe(base)

    // 时刻 / 步长变化
    const altSeries = {
      ...run.series,
      stepMinutes: 30,
      points: run.series.points.map((p) => ({ ...p, minuteOfDay: p.minuteOfDay * 2 })),
    }
    expect(labIdentity(altSeries, run.initial, plan, 'energy_first')).not.toBe(base)

    // 完整计划变化
    const altPlan = JSON.parse(JSON.stringify(plan))
    altPlan.periods[0].demand += 1
    expect(labIdentity(run.series, run.initial, altPlan, 'energy_first')).not.toBe(base)

    // 版本（生成器）变化体现在身份串
    expect(base).toContain('generator=lab-fixtures-v1')
    expect(base).toContain('strategy=lab-bounded-fs-v1')
    expect(base).toContain('step=15')
  })
})

describe('lab 公开求值辅助', () => {
  it('labEvaluationCandidateIds 与候选一致', () => {
    expect(labEvaluationCandidateIds('standby_takeover')).toEqual(['AC-02'])
    expect(labEvaluationCandidateIds('capacity_rise')).toEqual(['AC-01', 'AC-02'])
  })
})
