import { describe, expect, it } from 'vitest'
import {
  EVAL_MANIFEST,
  EVALUATION_DECLARATIONS,
  computePlanMetrics,
  exportEvaluationJson,
  runSyntheticEvaluation,
} from './evaluation'
import {
  DEFAULT_INITIAL_STATE,
  evaluateUnits,
  planConservativeBaseline,
  runScenario,
  type InitialUnitState,
} from './engine'
import { verifyPlanConstraints, type VerifyContext } from './constraints'
import { buildSeries } from './demand'
import { UNITS } from './units'
import type { DemandPoint, SyntheticSeries } from './types'

function contextFor(
  series: SyntheticSeries,
  initial: InitialUnitState,
): VerifyContext {
  return {
    series,
    allUnits: UNITS,
    evaluation: evaluateUnits(UNITS, 'normal'),
    initial,
    faultUnitId: null,
  }
}

function seriesFromDemands(demands: number[], stepMinutes = 15): SyntheticSeries {
  const points: DemandPoint[] = demands.map((demand, index) => ({
    index,
    minuteOfDay: index * stepMinutes,
    label: `${String(Math.floor((index * stepMinutes) / 60)).padStart(2, '0')}:${String(
      (index * stepMinutes) % 60,
    ).padStart(2, '0')}`,
    demand,
  }))
  return {
    seed: 1,
    scenario: 'normal',
    scenarioLabel: '常态',
    synthetic: true,
    stepMinutes,
    points,
    note: '测试用合成序列',
  }
}

const normalCandidates = evaluateUnits(UNITS, 'normal').candidates

describe('同条件合成评测：manifest', () => {
  it('种子冻结点互不重叠且总例数为 27（3+6 × 3 场景）', () => {
    const dev = new Set<number>(EVAL_MANIFEST.devSeeds)
    const overlap = EVAL_MANIFEST.holdoutSeeds.filter((s) => dev.has(s))
    expect(overlap).toEqual([])
    expect(dev.size).toBe(3)
    expect(EVAL_MANIFEST.holdoutSeeds.length).toBe(6)
    expect(
      EVAL_MANIFEST.scenarios.length *
        (EVAL_MANIFEST.devSeeds.length + EVAL_MANIFEST.holdoutSeeds.length),
    ).toBe(27)
  })

  it('同输入可复现：相同 seed/initial 生成相同用例指标', () => {
    const a = runSyntheticEvaluation()
    const b = runSyntheticEvaluation()
    expect(a.cases.map((c) => c.id)).toEqual(b.cases.map((c) => c.id))
    expect(a.cases.map((c) => c.conservativeBaseline.metrics)).toEqual(
      b.cases.map((c) => c.conservativeBaseline.metrics),
    )
    expect(a.cases.map((c) => c.pair)).toEqual(b.cases.map((c) => c.pair))
  })
})

describe('保守规则基线：初态与边界', () => {
  it('共享初态：锁定的在役机组不会在首个时段被切除，且零违规', () => {
    const series = seriesFromDemands([5, 6, 4])
    const initial: InitialUnitState = {
      runningUnitIds: ['AC-01'],
      minutesSinceChange: { 'AC-01': 5 },
    }
    const plan = planConservativeBaseline(
      series,
      normalCandidates,
      UNITS,
      [],
      initial,
    )
    expect(plan.feasible).toBe(true)
    expect(plan.periods[0].runningUnitIds).toContain('AC-01')
    const verdict = verifyPlanConstraints(plan, contextFor(series, initial))
    expect(verdict.passed).toBe(true)
    expect(verdict.violationCount).toBe(0)
  })

  it('低负载：强制最小稳定负载，过量供气不视为硬约束违规', () => {
    const series = seriesFromDemands([3, 3, 3])
    const plan = planConservativeBaseline(
      series,
      normalCandidates,
      UNITS,
      [],
      { runningUnitIds: ['AC-01'], minutesSinceChange: { 'AC-01': 30 } },
    )
    const verdict = verifyPlanConstraints(
      plan,
      contextFor(series, {
        runningUnitIds: ['AC-01'],
        minutesSinceChange: { 'AC-01': 30 },
      }),
    )
    expect(verdict.passed).toBe(true)
    const metrics = computePlanMetrics(plan, {
      ...runScenario('normal', UNITS, EVAL_MANIFEST.devSeeds[0], DEFAULT_INITIAL_STATE),
      series,
    })
    expect(metrics.status).toBe('planned')
    expect(metrics.violationCount).toBe(0)
    expect(metrics.unmetDemandBuckets).toBe(0)
    expect((metrics.excessSupplyVolumeM3 as number) > 0).toBe(true)
  })

  it('启停边界：被最小启停间隔锁定的停机机组不可被拉起，返回 not_found 及首个原因', () => {
    const series = seriesFromDemands([30])
    const plan = planConservativeBaseline(
      series,
      normalCandidates,
      UNITS,
      [],
      { runningUnitIds: [], minutesSinceChange: { 'AC-02': 3 } },
    )
    expect(plan.feasible).toBe(false)
    expect(plan.infeasibleReasons[0]).toContain('not_found')
    expect(plan.infeasibleReasons[0]).not.toContain('全局无解')
    const metrics = computePlanMetrics(plan, {
      ...runScenario('normal', UNITS, EVAL_MANIFEST.devSeeds[0]),
      series,
    })
    expect(metrics.status).toBe('not_found')
    expect(metrics.violationCount).toBeNull()
    expect(metrics.energyKwh).toBeNull()
    expect(metrics.periodCount).toBeNull()
  })

  it('故障场景：候选容量不足时返回 not_found，不称全局无解', () => {
    const run = runScenario('unit_failure', UNITS, EVAL_MANIFEST.devSeeds[0], DEFAULT_INITIAL_STATE)
    const surgeDemand = Math.max(...run.series.points.map((p) => p.demand))
    expect(surgeDemand).toBeGreaterThan(12)
    const conservative = run.conservativeBaseline
    expect(conservative.feasible).toBe(false)
    expect(conservative.infeasibleReasons[0]).toContain('not_found')
    // 故障机 AC-01 不在候选中，不能借调它来满足容量。
    expect(run.evaluation.candidates.map((u) => u.id)).toEqual(['AC-02'])
  })
})

describe('评测汇总：失败保留、配对分母与 null', () => {
  const result = runSyntheticEvaluation()

  it('27 例全部保留，成功失败分离展示在开发/留出', () => {
    expect(result.cases.length).toBe(27)
    expect(result.aggregates.map((a) => a.split)).toEqual(['dev', 'holdout'])
    expect(result.aggregates[0].totalCases).toBe(9)
    expect(result.aggregates[1].totalCases).toBe(18)
    // 失败例（如突增 / 故障）不因失败而从结果消失。
    expect(result.cases.some((c) => c.recommendation.metrics.status === 'not_found')).toBe(true)
  })

  it('配对分母明确：只统计双方独立校验通过的样本，且差值非 0 填充', () => {
    for (const agg of result.aggregates) {
      expect(agg.pairedCases).toBeLessThanOrEqual(agg.totalCases)
      const paired = result.cases.filter(
        (c) => c.split === agg.split && c.pair.eligible,
      )
      expect(paired.length).toBe(agg.pairedCases)
      for (const c of paired) {
        expect(c.pair.energyDeltaKwh).not.toBeNull()
        expect(c.conservativeBaseline.executable).toBe(true)
        expect(c.recommendation.executable).toBe(true)
      }
    }
  })

  it('旧规则基线作为历史对照，不参与配对收益', () => {
    const normal = result.cases.find(
      (c) => c.scenario === 'normal' && c.split === 'dev',
    )
    expect(normal).toBeTruthy()
    // 历史对照基线违规项可大于 0，但配对差值只来自保守基线与建议。
    expect(normal?.legacyBaseline.metrics.violationCount).toBeGreaterThan(0)
    if (normal?.pair.eligible) {
      const expected =
        (normal.recommendation.metrics.energyKwh as number) -
        (normal.conservativeBaseline.metrics.energyKwh as number)
      expect(normal.pair.energyDeltaKwh).toBeCloseTo(expected, 3)
    }
  })

  it('JSON 可解析，保持 null 与 manifest', () => {
    const parsed = JSON.parse(exportEvaluationJson(result))
    expect(parsed.localOnly).toBe(true)
    expect(parsed.holdoutApprovable).toBe(false)
    expect(parsed.manifest.devSeeds).toHaveLength(3)
    expect(parsed.manifest.holdoutSeeds).toHaveLength(6)
    expect(parsed.cases).toHaveLength(27)
    expect(parsed.declarations).toEqual(EVALUATION_DECLARATIONS)
    const failed = parsed.cases.find(
      (c: { recommendation: { metrics: { status: string } } }) =>
        c.recommendation.metrics.status === 'not_found',
    )
    expect(failed.recommendation.metrics.energyKwh).toBeNull()
    expect(failed.recommendation.metrics.reasons.length).toBeGreaterThan(0)
  })
})

describe('保守基线与建议共用需求/故障流', () => {
  it('常态开发种子下保守基线零违规且可执行，建议可执行或如实失败', () => {
    const run = runScenario('normal', UNITS, EVAL_MANIFEST.devSeeds[0], EVAL_MANIFEST.initial)
    // 建议与保守基线使用同一序列对象（同需求/故障事件流）。
    const c = computePlanMetrics(run.conservativeBaseline, run)
    expect(c.status).toBe('planned')
    expect(c.violationCount).toBe(0)
    expect(verifyPlanConstraints(run.conservativeBaseline, run).passed).toBe(true)
    // 离心机 AC-03 仍不进入候选（仅监测）。
    expect(run.evaluation.candidates.map((u) => u.id)).not.toContain('AC-03')
    expect(buildSeries('normal', EVAL_MANIFEST.devSeeds[0]).points.length).toBe(96)
  })
})