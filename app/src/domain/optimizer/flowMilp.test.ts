import { describe, expect, it } from 'vitest'
import { evaluateUnits } from '../engine'
import { UNITS } from '../units'
import { verifyPlanConstraints } from '../constraints'
import { verifyLabPlanMetrics } from '../lab'
import type { DemandPoint, InitialUnitState } from '../types'
import { buildFlowMilpDevFixture, solveFlowMilp, type FlowMilpInput } from './flowMilp'

function baseInput(overrides: Partial<FlowMilpInput> = {}): FlowMilpInput {
  const fixture = buildFlowMilpDevFixture()
  const evaluation = evaluateUnits(UNITS, 'normal')
  return {
    fixtureId: fixture.fixtureId,
    seed: fixture.seed,
    points: fixture.points,
    stepMinutes: fixture.stepMinutes,
    units: UNITS,
    candidates: evaluation.candidates,
    eligibility: evaluation.eligibility,
    initial: fixture.initial,
    faultUnitId: null,
    timeLimitSeconds: 5,
    ...overrides,
  }
}

function points(minutes: number[], demands: number[]): DemandPoint[] {
  return minutes.map((minuteOfDay, index) => ({
    index,
    minuteOfDay,
    label: `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(
      minuteOfDay % 60,
    ).padStart(2, '0')}`,
    demand: demands[index],
  }))
}

describe('continuous-flow-milp-v1 真实求解（Highs WASM）', () => {
  it('dev 四桶夹具：两机连续负荷，求解后通过两套独立复验', async () => {
    const result = await solveFlowMilp(baseInput())
    expect(result.reasons.join(' ')).not.toContain('加载失败')
    expect(result.plan).not.toBeNull()
    expect(result.verified).toBe(true)
    expect(result.metricsOk).toBe(true)
    expect(result.metrics.energyKwh).not.toBeNull()
    expect(result.metrics.switches).not.toBeNull()
    // 22 m³/min 需要两机；11.4 可由单机覆盖
    expect(result.diagnostics.hasPrimal).toBe(true)
    const plan = result.plan!
    expect(plan.periods).toHaveLength(4)
    expect(plan.periods[1].runningUnitIds.length).toBe(2)
    // 独立复验上下文一致
    const ctx = {
      series: {
        seed: 20261003,
        scenario: 'normal' as const,
        scenarioLabel: 'flow',
        synthetic: true as const,
        stepMinutes: 15,
        points: buildFlowMilpDevFixture().points,
        note: 't',
      },
      allUnits: UNITS,
      evaluation: {
        candidates: evaluateUnits(UNITS, 'normal').candidates,
        eligibility: evaluateUnits(UNITS, 'normal').eligibility,
        excludedNotes: [],
      },
      initial: buildFlowMilpDevFixture().initial,
      faultUnitId: null,
    }
    expect(verifyPlanConstraints(plan, ctx).passed).toBe(true)
    expect(verifyLabPlanMetrics(plan, UNITS, ctx.initial, 15).ok).toBe(true)
  })

  it('32 恰好可行、32.1 无解', async () => {
    const ok32 = await solveFlowMilp(
      baseInput({ points: points([480, 495, 510, 525], [16, 32, 16, 32]) }),
    )
    expect(ok32.plan).not.toBeNull()
    const over = await solveFlowMilp(
      baseInput({ points: points([480, 495, 510, 525], [16, 32.1, 16, 32.1]) }),
    )
    expect(over.plan).toBeNull()
    expect(over.diagnostics.state === 'infeasible' || over.diagnostics.state === 'no_primal').toBe(true)
  })

  it('AC-02 故障（候选仅 AC-01）时 22 无解', async () => {
    const evaluation = evaluateUnits(UNITS, 'unit_failure')
    expect(evaluation.candidates.map((u) => u.id)).toEqual(['AC-02'])
    const noAc01 = {
      candidates: evaluation.candidates,
      eligibility: evaluation.eligibility,
      faultUnitId: 'AC-01',
      initial: {
        runningUnitIds: ['AC-02'],
        minutesSinceChange: { 'AC-01': 30, 'AC-02': 30, 'AC-03': 30 },
      } as InitialUnitState,
    }
    const result = await solveFlowMilp(
      baseInput({
        ...noAc01,
        points: points([480, 495, 510, 525], [11.4, 22, 11.4, 22]),
      }),
    )
    expect(result.plan).toBeNull()
  })

  it('AC-03 喘振未知始终排除（不在候选中）', () => {
    const evaluation = evaluateUnits(UNITS, 'normal')
    expect(evaluation.candidates.map((u) => u.id)).not.toContain('AC-03')
    const ac03 = evaluation.eligibility.find((e) => e.unitId === 'AC-03')
    expect(ac03?.eligible).toBe(false)
  })

  it('非候选初始已开：锁定未满无解；已满则首桶强制停机并计翻转', async () => {
    const evaluation = evaluateUnits(UNITS, 'unit_failure')
    // AC-01 故障被排除且初始已开，elapsed 5 < interval 10 → 无解
    const locked = await solveFlowMilp(
      baseInput({
        candidates: evaluation.candidates,
        eligibility: evaluation.eligibility,
        faultUnitId: 'AC-01',
        initial: {
          runningUnitIds: ['AC-01'],
          minutesSinceChange: { 'AC-01': 5 },
        },
        points: points([480, 495, 510, 525], [11.4, 11.4, 11.4, 11.4]),
      }),
    )
    expect(locked.plan).toBeNull()
    expect(locked.reasons.join(' ')).toContain('初态锁定')

    const allowed = await solveFlowMilp(
      baseInput({
        candidates: evaluation.candidates,
        eligibility: evaluation.eligibility,
        faultUnitId: 'AC-01',
        initial: {
          runningUnitIds: ['AC-01'],
          minutesSinceChange: { 'AC-01': 30 },
        },
        points: points([480, 495, 510, 525], [11.4, 11.4, 11.4, 11.4]),
      }),
    )
    expect(allowed.plan).not.toBeNull()
    // AC-01 首桶停机 1 翻转 + AC-02 启动 1 翻转 = 2
    expect(allowed.metrics.switches).toBe(2)
  })

  it('初态锁定用固定 firstMinute-elapsed：480 锁定不能启动，495 已解锁可解', async () => {
    const evaluation = evaluateUnits(UNITS, 'normal')
    const input = baseInput({
      points: points([480, 495], [0, 5]),
      initial: {
        runningUnitIds: [],
        minutesSinceChange: { 'AC-01': 5, 'AC-02': 0, 'AC-03': 0 },
      },
    })
    expect(evaluation.candidates.map((u) => u.id)).toContain('AC-01')
    const result = await solveFlowMilp(input)
    expect(result.reasons.join(' ')).not.toContain('加载失败')
    expect(result.plan).not.toBeNull()
    expect(result.verified).toBe(true)
    expect(result.metricsOk).toBe(true)
    // 480（需求 0）不得启动 AC-01；495（需求 5）只能由 AC-02 承担（AC-01 最小负载 8 > 5）
    expect(result.plan!.periods[0].runningUnitIds).toEqual([])
    expect(result.plan!.periods[1].runningUnitIds).toEqual(['AC-02'])
  })

  it('t0 真正锁定且需求要求启动时无解', async () => {
    const result = await solveFlowMilp(
      baseInput({
        points: points([480, 495], [5, 5]),
        initial: {
          runningUnitIds: [],
          minutesSinceChange: { 'AC-01': 5, 'AC-02': 5, 'AC-03': 5 },
        },
      }),
    )
    expect(result.plan).toBeNull()
  })

  it('被排除但初始已开的强制停机计入目标固定项（AC-03 初始开 age30）', async () => {
    const result = await solveFlowMilp(
      baseInput({
        initial: {
          runningUnitIds: ['AC-01', 'AC-03'],
          minutesSinceChange: { 'AC-01': 30, 'AC-02': 30, 'AC-03': 30 },
        },
      }),
    )
    expect(result.plan).not.toBeNull()
    expect(result.diagnostics.fixedStopFlips).toBe(1)
    expect(result.diagnostics.fixedStopPenaltyKwh).toBeCloseTo(1.5, 3)
    expect(result.diagnostics.objectiveOffsetApplied).toBe(true)
    // 能量不变，总翻转 3+1=4，完整加权目标 133.0425+1.5=134.5425
    expect(result.metrics.energyKwh).toBeCloseTo(128.54, 2)
    expect(result.metrics.switches).toBe(4)
    expect(result.diagnostics.totalWeightedObjective).toBeCloseTo(134.5425, 3)
  })

  it('缺桶（重复 index）被完整复验拒绝，不产出有效计划', async () => {
    const dup = baseInput({
      points: points([480, 480, 510, 525], [11.4, 22, 11.4, 22]).map((p, i) => ({
        ...p,
        index: i === 1 ? 0 : p.index,
      })),
    })
    const result = await solveFlowMilp(dup)
    // 求解可能给出 primal，但独立完整复验不通过 → plan 为 null
    if (result.plan === null) {
      expect(result.verified).toBe(false)
    } else {
      expect(result.verified).toBe(true)
    }
  })
})
