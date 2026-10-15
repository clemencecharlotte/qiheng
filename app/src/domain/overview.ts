import { unitPower, type ScenarioRun } from './engine'
import { verifyPlanConstraints } from './constraints'
import { formatMinuteOfDay, STEP_MINUTES } from './demand'
import type { PlanResult, Unit } from './types'

export const OBSERVATION_MINUTE = 12 * 60
export const OBSERVATION_INDEX = OBSERVATION_MINUTE / STEP_MINUTES

export type DeviceState = 'running' | 'idle' | 'fault' | 'unknown'

export type StagePlanKind = 'baseline' | 'recommendation'

export interface SnapshotUnitView {
  unit: Unit
  state: DeviceState
  eligible: boolean
  running: boolean
  load: number | null
  loadRatio: number | null
  powerKw: number | null
  note: string | null
  hasBranch: boolean
}

export interface OverviewSnapshot {
  minuteOfDay: number
  label: string
  demand: number
  supply: number | null
  margin: number | null
  plannedRunningUnitIds: string[]
  planType: StagePlanKind
  planFeasible: boolean
  planLabel: string
  planNote: string
  units: SnapshotUnitView[]
}

function stateForUnit(
  run: ScenarioRun,
  unit: Unit,
  running: boolean,
): { state: DeviceState; note: string | null; eligible: boolean } {
  const eligibility = run.evaluation.eligibility.find((e) => e.unitId === unit.id)
  if (!eligibility || !eligibility.eligible) {
    const reason = eligibility?.reason ?? '该机组未纳入自动调度候选。'
    const isFault = eligibility?.reason?.includes('单机故障') ?? false
    return {
      state: isFault ? 'fault' : 'unknown',
      note: reason,
      eligible: false,
    }
  }
  return {
    state: running ? 'running' : 'idle',
    note: running
      ? null
      : '未参与此时刻方案（在当前候选序列中，本时刻未被选中）。',
    eligible: true,
  }
}

interface PlanView {
  planType: StagePlanKind
  planLabel: string
  planNote: string
}

function planView(planType: StagePlanKind, feasible: boolean): PlanView {
  if (planType === 'recommendation') {
    return {
      planType,
      planLabel: '建议（优化）',
      planNote: feasible
        ? '设备组合、负载与供气总量均来自同一“建议”策略，并已通过独立硬约束复验。'
        : '建议策略存在无解时段，以下不展示建议组合。',
    }
  }
  return {
    planType,
    planLabel: '基线对照（约束未通过）',
    planNote: feasible
      ? '设备组合、负载与供气总量均来自同一“基线”策略。'
      : '基线仅作对照：设备组合、负载与供气总量来自同一“基线”策略，但未通过全部硬约束复验。',
  }
}

/**
 * 读取同一次合成调度方案在观察时刻的结果，仅用于视图呈现；
 * 不修改求解器、事件来源或审批依据。缺值时保持未知，不补零。
 */
export function buildOverviewSnapshot(
  run: ScenarioRun,
  plan: PlanResult,
  planType: StagePlanKind,
  minuteOfDay: number = OBSERVATION_MINUTE,
): OverviewSnapshot {
  const index = Math.min(
    run.series.points.length - 1,
    Math.max(0, Math.round(minuteOfDay / run.series.stepMinutes)),
  )
  const point = run.series.points[index]
  const period = plan.periods.find((p) => p.index === index) ?? null
  const runningIds = new Set(period?.runningUnitIds ?? [])
  const verified = verifyPlanConstraints(plan, run)
  const feasible = plan.feasible && verified.passed
  const view = planView(planType, feasible)

  const units: SnapshotUnitView[] = run.allUnits.map((unit) => {
    const running = runningIds.has(unit.id)
    const { state, note, eligible } = stateForUnit(run, unit, running)
    const hasLoad = running && period !== null && unit.id in period.unitLoads
    const load = hasLoad ? period.unitLoads[unit.id] : null
    const loadRatio =
      running && period !== null && unit.id in period.unitLoadRatios
        ? period.unitLoadRatios[unit.id]
        : null
    const powerKw = load === null ? null : unitPower(unit, load)
    return {
      unit,
      state,
      eligible,
      running,
      load,
      loadRatio,
      powerKw,
      note,
      hasBranch: eligible,
    }
  })

  return {
    minuteOfDay: point.minuteOfDay,
    label: formatMinuteOfDay(point.minuteOfDay),
    demand: point.demand,
    supply: period ? period.supply : null,
    margin: period ? period.margin : null,
    plannedRunningUnitIds: period?.runningUnitIds ?? [],
    planType: view.planType,
    planFeasible: feasible,
    planLabel: view.planLabel,
    planNote: view.planNote,
    units,
  }
}

export interface StagePlanSelection {
  plan: PlanResult
  planType: StagePlanKind
  feasible: boolean
}

/** 建议方案通过独立复验时展示建议；否则退回基线对照，明确标注未通过。 */
export function selectStagePlan(run: ScenarioRun): StagePlanSelection {
  const verified = verifyPlanConstraints(run.recommendation, run)
  if (run.recommendation.feasible && verified.passed) {
    return { plan: run.recommendation, planType: 'recommendation', feasible: true }
  }
  return { plan: run.baseline, planType: 'baseline', feasible: false }
}