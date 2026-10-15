import { describe, expect, it } from 'vitest'
import { runScenario } from './engine'
import { verifyPlanConstraints } from './constraints'
import { FIXED_SEED, UNITS } from './units'
import type { PlanResult } from './types'

function clonePlan(plan: PlanResult): PlanResult {
  return JSON.parse(JSON.stringify(plan)) as PlanResult
}

const normalRun = runScenario('normal', UNITS, FIXED_SEED)

function recPlan(): PlanResult {
  return clonePlan(normalRun.recommendation)
}

describe('独立约束复验', () => {
  it('常态基线违规 17 项：复验不通过，覆盖时段不代表硬约束可行', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED)
    const verified = verifyPlanConstraints(run.baseline, run)
    expect(verified.hasSolution).toBe(true)
    expect(verified.violationCount).toBe(run.baseline.violationCount)
    expect(verified.violationCount).toBe(17)
    expect(verified.passed).toBe(false)
    expect(verified.byType.min_load).toBeGreaterThan(0)
  })

  it('常态建议覆盖 96 时段、完整且复验通过', () => {
    const verified = verifyPlanConstraints(normalRun.recommendation, normalRun)
    expect(normalRun.recommendation.periods).toHaveLength(96)
    expect(verified.complete).toBe(true)
    expect(verified.violationCount).toBe(0)
    expect(verified.passed).toBe(true)
    expect(verified.hasSolution).toBe(true)
  })

  it('需求突增建议无解：复验判定未通过（不靠覆盖时段）', () => {
    const run = runScenario('surge', UNITS, FIXED_SEED)
    const verified = verifyPlanConstraints(run.recommendation, run)
    expect(run.recommendation.feasible).toBe(false)
    expect(verified.hasSolution).toBe(false)
    expect(verified.passed).toBe(false)
  })

  it('移掉一个时段：计划完整性违规，不得判为通过', () => {
    const plan = recPlan()
    plan.periods.splice(10, 1)
    const v = verifyPlanConstraints(plan, normalRun)
    expect(v.complete).toBe(false)
    expect(v.passed).toBe(false)
    expect(v.byType.plan_completeness).toBeGreaterThan(0)
  })

  it('重复一个时段：计划完整性违规，不得判为通过', () => {
    const plan = recPlan()
    plan.periods[20] = clonePlan(normalRun.recommendation).periods[19]
    const v = verifyPlanConstraints(plan, normalRun)
    expect(v.complete).toBe(false)
    expect(v.passed).toBe(false)
    expect(v.byType.plan_completeness).toBeGreaterThan(0)
  })

  it('重排一个时段：计划完整性违规，顺序不再对应来源', () => {
    const plan = recPlan()
    const tmp = plan.periods[30]
    plan.periods[30] = plan.periods[31]
    plan.periods[31] = tmp
    const v = verifyPlanConstraints(plan, normalRun)
    expect(v.complete).toBe(false)
    expect(v.byType.plan_completeness).toBeGreaterThan(0)
  })

  it('伪造需求：与真实序列不一致即计划完整性违规', () => {
    const plan = recPlan()
    plan.periods[40].demand += 50
    const v = verifyPlanConstraints(plan, normalRun)
    expect(v.complete).toBe(false)
    expect(v.byType.plan_completeness).toBeGreaterThan(0)
  })

  it('t=0 早停：违反共享初态的 10 分钟锁定，独立检出启停间隔违规', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED, {
      runningUnitIds: ['AC-01'],
      minutesSinceChange: { 'AC-01': 5 },
    })
    const plan = clonePlan(run.recommendation)
    const p0 = plan.periods[0]
    const locked = 'AC-01'
    p0.runningUnitIds = p0.runningUnitIds.filter((id) => id !== locked)
    delete p0.unitLoads[locked]
    delete p0.unitLoadRatios[locked]
    expect(run.initial.runningUnitIds).toContain(locked)
    const v = verifyPlanConstraints(plan, run)
    expect(v.byType.start_stop_interval).toBeGreaterThan(0)
  })

  it('未知运行 ID：拒绝投运', () => {
    const plan = recPlan()
    plan.periods[0].runningUnitIds.push('AC-99')
    plan.periods[0].unitLoads['AC-99'] = 1
    plan.periods[0].unitLoadRatios['AC-99'] = 0.1
    const v = verifyPlanConstraints(plan, normalRun)
    expect(v.byType.unknown_unit).toBeGreaterThan(0)
  })

  it('重复运行 ID：拒绝重复', () => {
    const plan = recPlan()
    const first = plan.periods[0].runningUnitIds[0]
    plan.periods[0].runningUnitIds.push(first)
    const v = verifyPlanConstraints(plan, normalRun)
    expect(v.byType.unknown_unit).toBeGreaterThan(0)
  })

  it('场景故障机：故障机组出现在方案中判为不合格', () => {
    const run = runScenario('unit_failure', UNITS, FIXED_SEED)
    const plan = recPlan()
    plan.periods[0].runningUnitIds.push('AC-01')
    plan.periods[0].unitLoads['AC-01'] = 10
    plan.periods[0].unitLoadRatios['AC-01'] = 0.5
    const v = verifyPlanConstraints(plan, run)
    expect(run.faultUnitId).toBe('AC-01')
    expect(v.byType.ineligible_unit).toBeGreaterThan(0)
  })

  it('离心机未核实：出现在方案中判为不合格', () => {
    const plan = recPlan()
    plan.periods[0].runningUnitIds.push('AC-03')
    plan.periods[0].unitLoads['AC-03'] = 50
    plan.periods[0].unitLoadRatios['AC-03'] = 1.25
    const v = verifyPlanConstraints(plan, normalRun)
    expect(v.byType.ineligible_unit).toBeGreaterThan(0)
  })

  it('超额定 / 负值 / NaN 负载：非法负载', () => {
    const over = recPlan()
    const id = over.periods[0].runningUnitIds[0]
    const unit = UNITS.find((u) => u.id === id)!
    over.periods[0].unitLoads[id] = unit.ratedCapacity * 10
    expect(verifyPlanConstraints(over, normalRun).byType.invalid_load).toBeGreaterThan(0)

    const neg = recPlan()
    neg.periods[0].unitLoads[id] = -5
    expect(verifyPlanConstraints(neg, normalRun).byType.invalid_load).toBeGreaterThan(0)

    const nan = recPlan()
    nan.periods[0].unitLoads[id] = Number.NaN
    expect(verifyPlanConstraints(nan, normalRun).byType.invalid_load).toBeGreaterThan(0)
  })

  it('负载率与供气声明不符：load_mismatch', () => {
    const ratio = recPlan()
    const id = ratio.periods[0].runningUnitIds[0]
    ratio.periods[0].unitLoadRatios[id] = 0.123
    expect(verifyPlanConstraints(ratio, normalRun).byType.load_mismatch).toBeGreaterThan(0)

    const supply = recPlan()
    supply.periods[0].supply = supply.periods[0].supply + 100
    expect(verifyPlanConstraints(supply, normalRun).byType.load_mismatch).toBeGreaterThan(0)
  })

  it('两个故障场景仍阻断建议：可行且通过复验才允许批准', () => {
    for (const scenario of ['surge', 'unit_failure'] as const) {
      const run = runScenario(scenario, UNITS, FIXED_SEED)
      const v = verifyPlanConstraints(run.recommendation, run)
      const approvable = run.recommendation.feasible && v.passed
      expect(approvable).toBe(false)
    }
  })
})