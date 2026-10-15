import {
  FIXED_SEED,
  PRIORITY_ORDER,
  UNITS,
  minCapacity,
} from './units'
import { SCENARIO_FAULT_UNIT, buildSeries } from './demand'
import {
  DEFAULT_INITIAL_STATE,
  type ConstraintViolation,
  type DemandPoint,
  type EvaluationResult,
  type InfeasiblePeriod,
  type InitialUnitState,
  type PeriodPlan,
  type PlanResult,
  type PlanVariant,
  type ScenarioId,
  type SyntheticSeries,
  type Unit,
  type UnitEligibility,
} from './types'

export { DEFAULT_INITIAL_STATE }
export type { InitialUnitState }

export const SWITCH_PENALTY_KWH = 1.5

const EPS = 1e-6

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function initialLastChange(
  candidates: Unit[],
  initial: InitialUnitState,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const u of candidates) {
    const minutes = initial.minutesSinceChange[u.id]
    map.set(
      u.id,
      minutes === undefined ? Number.NEGATIVE_INFINITY : -minutes,
    )
  }
  return map
}

function initialRunningSet(candidates: Unit[], initial: InitialUnitState): Set<string> {
  const wanted = new Set(initial.runningUnitIds)
  return new Set(candidates.filter((u) => wanted.has(u.id)).map((u) => u.id))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function requiredParamFields(unit: Unit): Array<[string, number | undefined]> {
  return [
    ['供气能力 ratedCapacity', unit.ratedCapacity],
    ['最小稳定负载比 minLoadRatio', unit.minLoadRatio],
    ['额定功率 ratedPower', unit.ratedPower],
    ['卸载功率比 unloadPowerRatio', unit.unloadPowerRatio],
    ['最小启停间隔 minStartStopInterval', unit.minStartStopInterval],
  ]
}

export function checkUnitParams(unit: Unit): string[] {
  const missing: string[] = []
  for (const [field, value] of requiredParamFields(unit)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      missing.push(field)
    }
  }
  if (
    !missing.includes('最小稳定负载比 minLoadRatio') &&
    unit.minLoadRatio > 1
  ) {
    missing.push('最小稳定负载比 minLoadRatio（超出 0-1 范围）')
  }
  return missing
}

export function evaluateUnits(
  units: Unit[],
  scenario: ScenarioId,
): EvaluationResult {
  const faultUnit = SCENARIO_FAULT_UNIT[scenario]
  const eligibility: UnitEligibility[] = units.map((unit) => {
    const missingFields = checkUnitParams(unit)
    if (faultUnit === unit.id) {
      return {
        unitId: unit.id,
        eligible: false,
        missingFields,
        reason: '单机故障（合成场景），已退出自动调度候选。',
      }
    }
    if (unit.kind === 'centrifugal' && !unit.surgeBoundaryVerified) {
      return {
        unitId: unit.id,
        eligible: false,
        missingFields,
        reason:
          '离心机喘振边界未经核实，缺少经有效来源确认的安全曲线；第一轮禁止纳入自动调度候选（不编造安全边界）。',
      }
    }
    if (missingFields.length > 0) {
      return {
        unitId: unit.id,
        eligible: false,
        missingFields,
        reason: `关键参数缺失（${missingFields.join('、')}），无法安全参与自动调度，已排除。`,
      }
    }
    return { unitId: unit.id, eligible: true, missingFields: [], reason: null }
  })

  const byId = new Map(units.map((u) => [u.id, u]))
  const candidates = PRIORITY_ORDER.filter((id) => {
    const e = eligibility.find((x) => x.unitId === id)
    return e?.eligible
  }).map((id) => byId.get(id) as Unit)

  const excludedNotes = eligibility
    .filter((e) => !e.eligible)
    .map((e) => {
      const unit = byId.get(e.unitId) as Unit
      return `${unit.name}（${unit.id}）：${e.reason}`
    })

  return { candidates, eligibility, excludedNotes }
}

interface Allocation {
  loads: Record<string, number>
  ratios: Record<string, number>
  supply: number
}

export function allocateLoads(
  running: Unit[],
  demand: number,
  enforceMin: boolean,
): Allocation {
  const loads: Record<string, number> = {}
  const ratios: Record<string, number> = {}
  if (running.length === 0) {
    return { loads, ratios, supply: 0 }
  }
  const totalCap = running.reduce((s, u) => s + u.ratedCapacity, 0)
  const baseFor = (u: Unit): number => (enforceMin ? minCapacity(u) : 0)
  const baseSum = running.reduce((s, u) => s + baseFor(u), 0)

  let supply: number
  if (demand <= baseSum + EPS) {
    for (const u of running) loads[u.id] = baseFor(u)
    supply = baseSum
  } else if (demand >= totalCap - EPS) {
    for (const u of running) loads[u.id] = u.ratedCapacity
    supply = totalCap
  } else {
    const headroom = totalCap - baseSum
    const need = demand - baseSum
    for (const u of running) {
      const room = u.ratedCapacity - baseFor(u)
      loads[u.id] = baseFor(u) + need * (room / headroom)
    }
    supply = demand
  }
  for (const u of running) {
    ratios[u.id] = loads[u.id] / u.ratedCapacity
  }
  return { loads, ratios, supply }
}

export function unitPower(unit: Unit, load: number): number {
  if (load <= 0) return 0
  const ratio = Math.min(1, Math.max(0, load / unit.ratedCapacity))
  return (
    unit.unloadPowerRatio * unit.ratedPower +
    (unit.ratedPower - unit.unloadPowerRatio * unit.ratedPower) * ratio
  )
}

function diffCount(current: string[], previous: Set<string>): number {
  const cur = new Set(current)
  let count = 0
  for (const id of cur) if (!previous.has(id)) count += 1
  for (const id of previous) if (!cur.has(id)) count += 1
  return count
}

function buildPeriodPlan(
  point: DemandPoint,
  running: Unit[],
  enforceMin: boolean,
  prevRunning: Set<string>,
  planType: 'baseline' | 'recommendation',
  stepMinutes: number,
  variant: PlanVariant = planType === 'baseline' ? 'legacy' : 'recommendation',
): PeriodPlan {
  const alloc = allocateLoads(running, point.demand, enforceMin)
  const violations: ConstraintViolation[] = []
  if (alloc.supply + EPS < point.demand) {
    violations.push({
      type: 'supply_shortage',
      message: `需求 ${point.demand.toFixed(1)} m³/min 超出当前投运机组供气能力 ${round2(
        alloc.supply,
      ).toFixed(1)} m³/min（缺口 ${round2(point.demand - alloc.supply).toFixed(1)}）`,
    })
  }
  for (const u of running) {
    const ratio = alloc.ratios[u.id] ?? 0
    if (ratio + EPS < u.minLoadRatio) {
      violations.push({
        type: 'min_load',
        unitId: u.id,
        message: `${u.name} 负载率 ${(ratio * 100).toFixed(1)}% 低于最小稳定负载 ${(
          u.minLoadRatio * 100
        ).toFixed(0)}%`,
      })
    }
  }
  const powerKw = round2(
    running.reduce((s, u) => s + unitPower(u, alloc.loads[u.id] ?? 0), 0),
  )
  const energyKwh = round2(powerKw * (stepMinutes / 60))
  const runningUnitIds = running.map((u) => u.id)
  const switches = diffCount(runningUnitIds, prevRunning)

  const loadText =
    running.length === 0
      ? '全停'
      : running
          .map(
            (u) =>
              `${u.id} ${(alloc.loads[u.id] ?? 0).toFixed(1)} m³/min（${(
                (alloc.ratios[u.id] ?? 0) * 100
              ).toFixed(0)}%）`,
          )
          .join('，')

  const prefix =
    variant === 'legacy'
      ? '历史对照基线：按固定优先级即时投切，不校验最小稳定负载与启停间隔'
      : variant === 'conservative'
        ? '保守规则基线：固定优先序、优先维持当前开机集合，遵守最小负载与启停间隔，确定性供气'
        : '建议：满足最小稳定负载与启停间隔，以“估算耗电 + 切换等效代价”择优'

  let rationale = `${prefix}；需求 ${point.demand.toFixed(1)} m³/min；${loadText}；总供气 ${round2(
    alloc.supply,
  ).toFixed(1)}，余量 ${round2(alloc.supply - point.demand).toFixed(1)}`
  if (alloc.supply + EPS < point.demand) {
    rationale += '；供气不足，需外部补充或人工处置'
  }

  return {
    index: point.index,
    minuteOfDay: point.minuteOfDay,
    label: point.label,
    demand: point.demand,
    runningUnitIds,
    unitLoads: alloc.loads,
    unitLoadRatios: alloc.ratios,
    supply: round2(alloc.supply),
    margin: round2(alloc.supply - point.demand),
    powerKw,
    energyKwh,
    switches,
    violations,
    rationale,
  }
}

function applyIntervalAudit(periods: PeriodPlan[], units: Unit[]): void {
  const lastChange = new Map<string, number>()
  for (const u of units) lastChange.set(u.id, Number.NEGATIVE_INFINITY)
  let prev = new Set<string>()
  for (const p of periods) {
    const cur = new Set(p.runningUnitIds)
    for (const u of units) {
      const was = prev.has(u.id)
      const is = cur.has(u.id)
      if (was !== is) {
        const minute = p.minuteOfDay
        const last = lastChange.get(u.id) as number
        if (minute - last < u.minStartStopInterval) {
          p.violations.push({
            type: 'start_stop_interval',
            unitId: u.id,
            message: `${u.name} 在 ${p.label} ${
              is ? '启动' : '停机'
            }，距上次状态变更不足最小启停间隔 ${u.minStartStopInterval} 分钟`,
          })
        }
        lastChange.set(u.id, minute)
      }
    }
    prev = cur
  }
}

function finalize(
  planType: 'baseline' | 'recommendation',
  periods: PeriodPlan[],
  exclusionNotes: string[],
  variant: PlanVariant,
): PlanResult {
  return {
    planType,
    variant,
    feasible: true,
    infeasibleReasons: [],
    infeasiblePeriods: [],
    periods,
    totalEnergyKwh: round2(periods.reduce((s, p) => s + p.energyKwh, 0)),
    totalSwitches: periods.reduce((s, p) => s + p.switches, 0),
    violationCount: periods.reduce((s, p) => s + p.violations.length, 0),
    exclusionNotes,
  }
}

export function planBaseline(
  series: SyntheticSeries,
  candidates: Unit[],
  allUnits: Unit[],
  exclusionNotes: string[],
): PlanResult {
  const periods: PeriodPlan[] = []
  let prev = new Set<string>()
  for (const point of series.points) {
    const chosen: Unit[] = []
    let cap = 0
    for (const u of candidates) {
      if (cap + EPS >= point.demand) break
      chosen.push(u)
      cap += u.ratedCapacity
    }
    const plan = buildPeriodPlan(
      point,
      chosen,
      false,
      prev,
      'baseline',
      series.stepMinutes,
      'legacy',
    )
    periods.push(plan)
    prev = new Set(chosen.map((u) => u.id))
  }
  applyIntervalAudit(periods, allUnits)
  return finalize('baseline', periods, exclusionNotes, 'legacy')
}

/**
 * 保守规则基线：固定机组优先序、优先维持当前开机集合（只增不减），
 * 复用 allocateLoads 做确定性供气并强制最小稳定负载；遵守最小启停间隔
 * （最近变更未满间隔的机组锁定其当前状态）；不纳入故障或未核实安全边界的机组。
 * 若某时刻在锁定约束下无合法完整计划，如实返回 not_found 及首个原因，
 * 不宣称为全局无解，也不保证所有场景可行。
 */
export function planConservativeBaseline(
  series: SyntheticSeries,
  candidates: Unit[],
  allUnits: Unit[],
  exclusionNotes: string[],
  initial: InitialUnitState = DEFAULT_INITIAL_STATE,
): PlanResult {
  const periods: PeriodPlan[] = []
  const infeasiblePeriods: InfeasiblePeriod[] = []
  const lastChange = initialLastChange(candidates, initial)
  let prev = initialRunningSet(candidates, initial)

  const capacityOf = (ids: Set<string>): number =>
    candidates.reduce((s, u) => (ids.has(u.id) ? s + u.ratedCapacity : s), 0)
  const totalAllowedCapacity = capacityOf(new Set(candidates.map((u) => u.id)))

  for (const point of series.points) {
    const minute = point.minuteOfDay
    const lockedOff = new Set<string>()
    const chosen = new Set<string>()

    for (const u of candidates) {
      const running = prev.has(u.id)
      const since = minute - (lastChange.get(u.id) as number)
      if (running && since < u.minStartStopInterval) chosen.add(u.id)
      if (!running && since < u.minStartStopInterval) lockedOff.add(u.id)
    }

    // 优先维持当前开机集合（排除被间隔锁定的停机机组）。
    for (const u of candidates) {
      if (prev.has(u.id) && !lockedOff.has(u.id)) chosen.add(u.id)
    }

    // 固定优先序补足容量，跳过被锁定停机的机组。
    for (const u of candidates) {
      if (capacityOf(chosen) + EPS >= point.demand) break
      if (lockedOff.has(u.id)) continue
      chosen.add(u.id)
    }

    if (capacityOf(chosen) + EPS < point.demand) {
      infeasiblePeriods.push({
        index: point.index,
        label: point.label,
        demand: point.demand,
        availableCapacity: round2(totalAllowedCapacity),
        reason: `在 ${point.label} 未找到满足硬约束的合法完整计划：需求 ${point.demand.toFixed(
          1,
        )} m³/min，固定优先序下可用安全容量 ${round2(
          totalAllowedCapacity,
        ).toFixed(1)} m³/min，且部分机组受最小启停间隔锁定。`,
      })
      continue
    }

    const running = candidates.filter((u) => chosen.has(u.id))
    periods.push(
      buildPeriodPlan(
        point,
        running,
        true,
        prev,
        'baseline',
        series.stepMinutes,
        'conservative',
      ),
    )

    const ids = new Set(running.map((u) => u.id))
    for (const u of candidates) {
      const was = prev.has(u.id)
      const is = ids.has(u.id)
      if (was !== is) lastChange.set(u.id, minute)
    }
    prev = ids
  }

  if (infeasiblePeriods.length > 0) {
    return {
      planType: 'baseline',
      variant: 'conservative',
      feasible: false,
      infeasibleReasons: [
        `保守规则基线在 ${infeasiblePeriods.length} 个时段未找到合法完整计划（not_found），不输出自动启停计划。`,
        `首个原因：${infeasiblePeriods[0].reason}`,
      ],
      infeasiblePeriods,
      periods: [],
      totalEnergyKwh: 0,
      totalSwitches: 0,
      violationCount: 0,
      exclusionNotes,
    }
  }

  applyIntervalAudit(periods, allUnits)
  return finalize('baseline', periods, exclusionNotes, 'conservative')
}

function maskToList(mask: number, list: Unit[]): Unit[] {
  const out: Unit[] = []
  for (let i = 0; i < list.length; i += 1) {
    if (mask & (1 << i)) out.push(list[i])
  }
  return out
}

function hasBits(mask: number, bits: number): boolean {
  return (mask & bits) === bits
}

function intersects(mask: number, bits: number): boolean {
  return (mask & bits) !== 0
}

export function planRecommendation(
  series: SyntheticSeries,
  candidates: Unit[],
  allUnits: Unit[],
  exclusionNotes: string[],
  initial: InitialUnitState = DEFAULT_INITIAL_STATE,
): PlanResult {
  const periods: PeriodPlan[] = []
  const infeasiblePeriods: InfeasiblePeriod[] = []

  const totalCandidateCapacity = candidates.reduce(
    (s, u) => s + u.ratedCapacity,
    0,
  )

  const lastChange = initialLastChange(candidates, initial)
  let prev = initialRunningSet(candidates, initial)
  let prevUnits: Unit[] = candidates.filter((u) => prev.has(u.id))

  for (const point of series.points) {
    const minute = point.minuteOfDay
    let mustOnMask = 0
    let mustOffMask = 0
    candidates.forEach((u, i) => {
      const running = prev.has(u.id)
      const since = minute - (lastChange.get(u.id) as number)
      if (running && since < u.minStartStopInterval) mustOnMask |= 1 << i
      if (!running && since < u.minStartStopInterval) mustOffMask |= 1 << i
    })

    let bestMask = -1
    let bestCost: number[] | null = null
    const fullMask = (1 << candidates.length) - 1
    for (let mask = 0; mask <= fullMask; mask += 1) {
      if (!hasBits(mask, mustOnMask) || intersects(mask, mustOffMask)) continue
      const subset = maskToList(mask, candidates)
      const cap = subset.reduce((s, u) => s + u.ratedCapacity, 0)
      if (cap + EPS < point.demand) continue

      const changes = diffCount(
        subset.map((u) => u.id),
        new Set(prevUnits.map((u) => u.id)),
      )

      let safeToCommit = true
      for (const u of prevUnits) {
        if (subset.some((s) => s.id === u.id)) continue
        const capacityWithoutU = candidates
          .filter((c) => c.id !== u.id)
          .reduce((s, c) => s + c.ratedCapacity, 0)
        const until = minute + u.minStartStopInterval
        for (const future of series.points) {
          if (future.minuteOfDay < minute) continue
          if (future.minuteOfDay > until) break
          if (future.demand > capacityWithoutU + EPS) {
            safeToCommit = false
            break
          }
        }
        if (!safeToCommit) break
      }
      if (!safeToCommit) continue

      const alloc = allocateLoads(subset, point.demand, true)
      const power = subset.reduce((s, u) => s + unitPower(u, alloc.loads[u.id] ?? 0), 0)
      const energy = power * (series.stepMinutes / 60)
      const cost = [energy + changes * SWITCH_PENALTY_KWH, changes, subset.length, mask]
      if (bestCost === null || isLower(cost, bestCost)) {
        bestCost = cost
        bestMask = mask
      }
    }

    if (bestMask === -1) {
      infeasiblePeriods.push({
        index: point.index,
        label: point.label,
        demand: point.demand,
        availableCapacity: round2(totalCandidateCapacity),
        reason: `该时段需求 ${point.demand.toFixed(
          1,
        )} m³/min，自动调度候选的安全可用容量仅 ${round2(
          totalCandidateCapacity,
        ).toFixed(1)} m³/min，且受最小启停间隔锁定，无满足全部硬约束的启停方案。`,
      })
      continue
    }

    const chosen = maskToList(bestMask, candidates)
    const plan = buildPeriodPlan(
      point,
      chosen,
      true,
      prev,
      'recommendation',
      series.stepMinutes,
    )
    periods.push(plan)

    const chosenIds = new Set(chosen.map((u) => u.id))
    for (const u of candidates) {
      const was = prev.has(u.id)
      const is = chosenIds.has(u.id)
      if (was !== is) lastChange.set(u.id, minute)
    }
    prev = chosenIds
    prevUnits = chosen
  }

  if (infeasiblePeriods.length > 0) {
    const reasons = [
      `存在 ${infeasiblePeriods.length} 个时段无满足硬约束的可行方案，按要求不输出自动启停建议。`,
      ...infeasiblePeriods
        .slice(0, 3)
        .map((p) => `${p.label} 需求 ${p.demand.toFixed(1)} m³/min：${p.reason}`),
    ]
    if (infeasiblePeriods.length > 3) {
      reasons.push(`其余 ${infeasiblePeriods.length - 3} 个时段原因相同。`)
    }
    return {
      planType: 'recommendation',
      variant: 'recommendation',
      feasible: false,
      infeasibleReasons: reasons,
      infeasiblePeriods,
      periods: [],
      totalEnergyKwh: 0,
      totalSwitches: 0,
      violationCount: 0,
      exclusionNotes,
    }
  }

  applyIntervalAudit(periods, allUnits)
  return finalize('recommendation', periods, exclusionNotes, 'recommendation')
}

function isLower(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return true
    if (a[i] > b[i]) return false
  }
  return false
}

export interface ScenarioRunTimingsMs {
  baselineMs: number
  conservativeMs: number
  recommendationMs: number
}

export interface ScenarioRun {
  series: SyntheticSeries
  evaluation: EvaluationResult
  /** 历史对照基线：保留原规则与原审计口径，不参与合法配对收益。 */
  baseline: PlanResult
  /** 保守规则基线：固定优先序、优先维持当前开机集合，遵守硬约束。 */
  conservativeBaseline: PlanResult
  recommendation: PlanResult
  allUnits: Unit[]
  /**
   * 本场景使用的共享初态：保守基线与建议显式读取同一初态，
   * 供独立复验器按同一有效初态初始化 prev/lastChange。
   */
  initial: InitialUnitState
  /** 场景故障机（无故障为 null），供独立复验器判定故障/不合资格运行 ID。 */
  faultUnitId: string | null
  /** 单次本机耗时（performance.now），易变，不参与确定性相等断言。 */
  timingsMs: ScenarioRunTimingsMs
}

export function runScenario(
  scenario: ScenarioId,
  units: Unit[] = UNITS,
  seed: number = FIXED_SEED,
  initial: InitialUnitState = DEFAULT_INITIAL_STATE,
): ScenarioRun {
  const series = buildSeries(scenario, seed)
  const evaluation = evaluateUnits(units, scenario)
  const t0 = nowMs()
  const baseline = planBaseline(series, evaluation.candidates, units, evaluation.excludedNotes)
  const t1 = nowMs()
  const conservativeBaseline = planConservativeBaseline(
    series,
    evaluation.candidates,
    units,
    evaluation.excludedNotes,
    initial,
  )
  const t2 = nowMs()
  const recommendation = planRecommendation(
    series,
    evaluation.candidates,
    units,
    evaluation.excludedNotes,
    initial,
  )
  const t3 = nowMs()
  return {
    series,
    evaluation,
    baseline,
    conservativeBaseline,
    recommendation,
    allUnits: units,
    initial,
    faultUnitId: SCENARIO_FAULT_UNIT[scenario] ?? null,
    timingsMs: {
      baselineMs: round3(t1 - t0),
      conservativeMs: round3(t2 - t1),
      recommendationMs: round3(t3 - t2),
    },
  }
}