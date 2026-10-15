import loadHighs, { type Highs, type Model } from 'highs'
import { unitPower } from '../engine'
import { verifyPlanConstraints, type VerifyContext } from '../constraints'
import { verifyLabPlanMetrics } from '../lab'
import type {
  DemandPoint,
  InitialUnitState,
  PeriodPlan,
  PlanResult,
  Unit,
  UnitEligibility,
} from '../types'

/**
 * 第一模型：continuous-flow-milp-v1（开发算例，非旧 lab 字典序）。
 * 目标 weighted-demo-v1 = min Σ 模型能量 + 1.5 kWh/次 × 实际逐机开停翻转，过量供气惩罚 0。
 * 上游内核：HiGHS（via highs-js, MIT）；气衡贡献为建模/adapter，非自研 MILP。
 */

export const FLOW_MILP_MODEL_VERSION = 'continuous-flow-milp-v1'
export const FLOW_MILP_OBJECTIVE_VERSION = 'weighted-demo-v1'
export const FLOW_MILP_SWITCH_PENALTY_KWH = 1.5
export const FLOW_MILP_DEV_SEED = 20261003

export interface FlowMilpInput {
  fixtureId: string
  seed: number
  points: DemandPoint[]
  stepMinutes: number
  units: Unit[]
  candidates: Unit[]
  eligibility: UnitEligibility[]
  initial: InitialUnitState
  faultUnitId: string | null
  timeLimitSeconds?: number
}

export interface FlowMilpDiagnostics {
  modelVersion: string
  objectiveVersion: string
  switchPenaltyKwh: number
  overSupplyPenalty: number
  /** 调用层原生状态（model.run() 返回值），与 getModelStatus 分离。 */
  nativeCallStatus: number | null
  nativeWarnings: string[]
  /** getModelStatus 的名称与数值码。 */
  nativeStatus: string
  modelStatus: string
  modelStatusCode: number | null
  /** primal_solution_status 的名称与数值码。 */
  primalSolutionStatus: string | null
  primalSolutionStatusCode: number | null
  hasPrimal: boolean
  objectiveValue: number | null
  mipGap: number | null
  mipDualBound: number | null
  /** 被排除但初始已开的强制停机翻转（固定项）：翻转数与惩罚，及是否用包真实 offset 计入目标。 */
  fixedStopFlips: number
  fixedStopPenaltyKwh: number
  objectiveOffsetApplied: boolean
  /** 求解器原生目标（含 offset）与校正后的完整加权目标。 */
  nativeObjective: number | null
  totalWeightedObjective: number | null
  timedOut: boolean
  cancelled: boolean
  exactOptimal: boolean
  state: 'optimal' | 'feasible_not_optimal' | 'time_limit_with_incumbent' | 'no_primal' | 'infeasible' | 'invalid' | 'loading_failure' | 'canceled'
  timingsMs: {
    loading: number
    model: number
    solve: number
    verify: number
  }
  notes: string[]
}

export interface FlowMilpResult {
  plan: PlanResult | null
  verified: boolean
  metricsOk: boolean
  metrics: {
    energyKwh: number | null
    switches: number | null
    excessSupplyM3: number | null
  }
  diagnostics: FlowMilpDiagnostics
  reasons: string[]
}

let cachedHighs: Highs | null = null
export async function loadHighsOnce(): Promise<Highs> {
  if (!cachedHighs) cachedHighs = await loadHighs()
  return cachedHighs
}

interface Csc {
  numRows: number
  numCols: number
  starts: Int32Array
  indices: Int32Array
  values: Float64Array
}

function buildCsc(
  numRows: number,
  numCols: number,
  triplets: Array<[number, number, number]>,
): Csc {
  const byCol: Array<Array<[number, number]>> = Array.from(
    { length: numCols },
    () => [],
  )
  for (const [row, col, val] of triplets) {
    if (val !== 0) byCol[col].push([row, val])
  }
  const starts = new Int32Array(numCols + 1)
  const indices: number[] = []
  const values: number[] = []
  let k = 0
  for (let c = 0; c < numCols; c += 1) {
    starts[c] = k
    for (const [row, val] of byCol[c]) {
      indices.push(row)
      values.push(val)
      k += 1
    }
  }
  starts[numCols] = k
  return {
    numRows,
    numCols,
    starts,
    indices: Int32Array.from(indices),
    values: Float64Array.from(values),
  }
}

/**
 * 初态锁定：lastChange 以固定 firstMinute - elapsed 计算（不随当前 minute 漂移）。
 * 后续新翻转另行按各自真实 minute 处理（成对间隔约束）。
 */
function isLocked(
  unit: Unit,
  minute: number,
  firstMinute: number,
  initial: InitialUnitState,
): boolean {
  const elapsed = initial.minutesSinceChange[unit.id]
  if (elapsed === undefined) return false
  const lastChange = firstMinute - elapsed
  return minute - lastChange < unit.minStartStopInterval
}

export async function solveFlowMilp(
  input: FlowMilpInput,
  load: () => Promise<Highs> = loadHighsOnce,
): Promise<FlowMilpResult> {
  const t0 = now()
  const diag: FlowMilpDiagnostics = {
    modelVersion: FLOW_MILP_MODEL_VERSION,
    objectiveVersion: FLOW_MILP_OBJECTIVE_VERSION,
    switchPenaltyKwh: FLOW_MILP_SWITCH_PENALTY_KWH,
    overSupplyPenalty: 0,
    nativeCallStatus: null,
    nativeWarnings: [],
    nativeStatus: '',
    modelStatus: '',
    modelStatusCode: null,
    primalSolutionStatus: null,
    primalSolutionStatusCode: null,
    hasPrimal: false,
    objectiveValue: null,
    mipGap: null,
    mipDualBound: null,
    fixedStopFlips: 0,
    fixedStopPenaltyKwh: 0,
    objectiveOffsetApplied: false,
    nativeObjective: null,
    totalWeightedObjective: null,
    timedOut: false,
    cancelled: false,
    exactOptimal: false,
    state: 'loading_failure',
    timingsMs: { loading: 0, model: 0, solve: 0, verify: 0 },
    notes: [],
  }
  const reasons: string[] = []

  const units = input.candidates
  const T = input.points.length
  const U = units.length

  // 非候选但初始已开：首桶必须关并计翻转；锁定未满则无解。
  const candidateIds = new Set(units.map((u) => u.id))
  const forcedOff = input.units.filter(
    (u) => input.initial.runningUnitIds.includes(u.id) && !candidateIds.has(u.id),
  )
  for (const u of forcedOff) {
    const elapsed = input.initial.minutesSinceChange[u.id]
    if (elapsed !== undefined && elapsed < u.minStartStopInterval) {
      diag.state = 'infeasible'
      reasons.push(
        `初态锁定：${u.id} 初始已开机且不足最小启停间隔 ${u.minStartStopInterval} 分钟，无法首桶合法停机。`,
      )
      return { plan: null, verified: false, metricsOk: false, metrics: emptyMetrics(), diagnostics: diag, reasons }
    }
  }
  // 固定翻转项：被排除但初始已开的强制停机，计入目标常数项（包真实 offset）。
  diag.fixedStopFlips = forcedOff.length
  diag.fixedStopPenaltyKwh = FLOW_MILP_SWITCH_PENALTY_KWH * forcedOff.length
  const objectiveOffset = diag.fixedStopPenaltyKwh
  let highs: Highs
  try {
    highs = await load()
  } catch (error) {
    diag.timingsMs.loading = now() - t0
    diag.notes.push(error instanceof Error ? error.message : 'WASM 加载失败')
    reasons.push('HiGHS/WASM 加载失败，未求解；回退现有规则方案。')
    return { plan: null, verified: false, metricsOk: false, metrics: emptyMetrics(), diagnostics: diag, reasons }
  }
  diag.timingsMs.loading = now() - t0
  const t1 = now()

  const VAR = 4
  const idx = (u: number, t: number, k: number) => (u * T + t) * VAR + k
  const numCols = U * T * VAR
  const colCost = new Float64Array(numCols)
  const colLower = new Float64Array(numCols)
  const colUpper = new Float64Array(numCols)
  const integrality = new Int32Array(numCols)
  const triplets: Array<[number, number, number]> = []
  const rowLower: number[] = []
  const rowUpper: number[] = []
  const INF = 1e30
  const addRow = (lo: number, hi: number, entries: Array<[number, number]>) => {
    const r = rowLower.length
    rowLower.push(lo)
    rowUpper.push(hi)
    for (const [col, val] of entries) triplets.push([r, col, val])
    return r
  }

  for (let u = 0; u < U; u += 1) {
    const unit = units[u]
    const minCap = unit.minLoadRatio * unit.ratedCapacity
    for (let t = 0; t < T; t += 1) {
      const minute = input.points[t].minuteOfDay
      const x = idx(u, t, 0)
      const start = idx(u, t, 1)
      const stop = idx(u, t, 2)
      const q = idx(u, t, 3)
      // binary x/start/stop
      for (const c of [x, start, stop]) {
        colLower[c] = 0
        colUpper[c] = 1
        integrality[c] = 1
      }
      colLower[q] = 0
      colUpper[q] = unit.ratedCapacity
      // objective: energy coefficients + 1.5 flip penalty on start/stop
      colCost[x] =
        unit.ratedPower * unit.unloadPowerRatio * (input.stepMinutes / 60)
      colCost[q] =
        (unit.ratedPower * (1 - unit.unloadPowerRatio)) /
        unit.ratedCapacity *
        (input.stepMinutes / 60)
      colCost[start] = FLOW_MILP_SWITCH_PENALTY_KWH
      colCost[stop] = FLOW_MILP_SWITCH_PENALTY_KWH
      // q upper/lower
      addRow(-INF, 0, [
        [q, 1],
        [x, -unit.ratedCapacity],
      ])
      addRow(0, INF, [
        [q, 1],
        [x, -minCap],
      ])
      // balance: x - start + stop = xPrev (initial for t0)
      const xPrev =
        t === 0
          ? input.initial.runningUnitIds.includes(unit.id)
            ? 1
            : 0
          : 0
      if (t === 0) {
        addRow(xPrev, xPrev, [
          [x, 1],
          [start, -1],
          [stop, 1],
        ])
      } else {
        addRow(0, 0, [
          [x, 1],
          [start, -1],
          [stop, 1],
          [idx(u, t - 1, 0), -1],
        ])
      }
      // start + stop <= 1
      addRow(-INF, 1, [
        [start, 1],
        [stop, 1],
      ])
      // initial lock: locked periods force change=0（固定 firstMinute - elapsed）
      if (isLocked(unit, minute, input.points[0].minuteOfDay, input.initial)) {
        colUpper[start] = 0
        colUpper[stop] = 0
      }
    }
    // pairwise lock: minute diff < interval → change_k + change_t <= 1
    for (let k = 0; k < T; k += 1) {
      for (let t = k + 1; t < T; t += 1) {
        const dt = input.points[t].minuteOfDay - input.points[k].minuteOfDay
        if (dt < unit.minStartStopInterval) {
          addRow(-INF, 1, [
            [idx(u, k, 1), 1],
            [idx(u, k, 2), 1],
            [idx(u, t, 1), 1],
            [idx(u, t, 2), 1],
          ])
        }
      }
    }
  }
  // demand rows
  for (let t = 0; t < T; t += 1) {
    const entries: Array<[number, number]> = []
    for (let u = 0; u < U; u += 1) entries.push([idx(u, t, 3), 1])
    addRow(input.points[t].demand, INF, entries)
  }

  const matrix = buildCsc(rowLower.length, numCols, triplets)
  diag.timingsMs.model = now() - t1
  const t2 = now()

  let model: Model | null = null
  const infoGet = (key: string): number | null => {
    try {
      const v = model?.info.get(key as never)
      return typeof v === 'number' ? v : null
    } catch {
      return null
    }
  }
  try {
    model = highs.createModel({
      numCols,
      numRows: rowLower.length,
      colCost,
      colLower,
      colUpper,
      rowLower: Float64Array.from(rowLower),
      rowUpper: Float64Array.from(rowUpper),
      matrix: {
        format: 'csc',
        numRows: rowLower.length,
        numCols,
        starts: matrix.starts,
        indices: matrix.indices,
        values: matrix.values,
      },
      integrality,
      // 固定停机翻转作为真实目标常数项（不含在决策变量里，但必须与全部翻转口径一致）。
      offset: objectiveOffset,
    })
    diag.objectiveOffsetApplied = objectiveOffset !== 0
    model.options.set({ output_flag: false })
    model.options.set({ time_limit: input.timeLimitSeconds ?? 5 })
    model.options.set({ mip_rel_gap: 0 })
    model.options.set({ mip_abs_gap: 0 })
    const runResult = model.run()
    diag.timingsMs.solve = now() - t2
    diag.nativeCallStatus = runResult.status
    diag.nativeWarnings = [...runResult.warnings]
    // 调用层 status 与 getModelStatus 分离记录。
    const rawModelStatus = model.getModelStatus()
    const modelStatusName =
      nameOfCode(highs.constants.modelStatus, rawModelStatus) ?? String(rawModelStatus)
    diag.modelStatusCode = rawModelStatus
    diag.modelStatus = modelStatusName
    diag.nativeStatus = `call=${runResult.status};model=${modelStatusName}(${rawModelStatus});warnings=${runResult.warnings.length}`
    const rawPrimal = infoGet('primal_solution_status')
    const primalName =
      rawPrimal === null
        ? null
        : nameOfCode(highs.constants.solutionStatus, rawPrimal) ?? String(rawPrimal)
    diag.primalSolutionStatusCode = rawPrimal
    diag.primalSolutionStatus = primalName
    diag.objectiveValue = model.getObjectiveValue()
    diag.nativeObjective = diag.objectiveValue
    // offset 已作为真实模型常数项计入 native objective；总加权目标与其一致。
    diag.totalWeightedObjective = diag.objectiveValue
    diag.mipGap = infoGet('mip_gap')
    // 真实选项键为 mip_dual_bound（不存在 dual_bound）。
    diag.mipDualBound = infoGet('mip_dual_bound')

    const primalFeasible =
      primalName === 'feasible' || primalName === 'feasible_from_resolve'
    // getSolution 数组存在不代表有可行解：以 model/primal status + 有限目标值判断。
    diag.hasPrimal =
      (modelStatusName === 'optimal' || primalFeasible) &&
      diag.objectiveValue !== null &&
      Number.isFinite(diag.objectiveValue)
    diag.exactOptimal = modelStatusName === 'optimal'
    diag.timedOut =
      modelStatusName === 'time_limit' || modelStatusName === 'iteration_limit'
    if (!diag.hasPrimal) {
      diag.state = modelStatusName === 'infeasible' ? 'infeasible' : 'no_primal'
      reasons.push(`未获得可行解：modelStatus=${modelStatusName}（call=${runResult.status}）`)
      return { plan: null, verified: false, metricsOk: false, metrics: emptyMetrics(), diagnostics: diag, reasons }
    }
    // exactOptimal 只准 model optimal；其他有 primal 的可行解保留 feasible_not_optimal / 限时 incumbent。
    diag.state = diag.exactOptimal
      ? 'optimal'
      : diag.timedOut
        ? 'time_limit_with_incumbent'
        : 'feasible_not_optimal'

    const t3 = now()
    const plan = buildPlanFromSolution(input, units, model)
    const context: VerifyContext = {
      series: {
        seed: input.seed,
        scenario: 'normal',
        scenarioLabel: input.fixtureId,
        synthetic: true,
        stepMinutes: input.stepMinutes,
        points: input.points,
        note: 'flow-milp dev',
      },
      allUnits: input.units,
      evaluation: { candidates: units, eligibility: input.eligibility, excludedNotes: [] },
      initial: input.initial,
      faultUnitId: input.faultUnitId,
    }
    const verified = verifyPlanConstraints(plan, context).passed
    const metricCheck = verifyLabPlanMetrics(plan, input.units, input.initial, input.stepMinutes)
    diag.timingsMs.verify = now() - t3
    const metricsOk = metricCheck.ok
    if (!verified) reasons.push('独立硬约束复验未通过，方案不展示为有效。')
    if (!metricsOk) reasons.push('独立指标核对未通过，数值置 null。')
    return {
      plan: verified && metricsOk ? plan : null,
      verified,
      metricsOk,
      metrics: {
        energyKwh: verified && metricsOk ? metricCheck.recomputed.totalEnergyKwh : null,
        switches: verified && metricsOk ? metricCheck.recomputed.totalSwitches : null,
        excessSupplyM3: verified && metricsOk ? metricCheck.recomputed.excessSupplyM3 : null,
      },
      diagnostics: diag,
      reasons,
    }
  } catch (error) {
    diag.state = 'invalid'
    diag.notes.push(error instanceof Error ? error.message : '求解异常')
    reasons.push('MILP 求解异常，未展示方案。')
    return { plan: null, verified: false, metricsOk: false, metrics: emptyMetrics(), diagnostics: diag, reasons }
  } finally {
    try {
      model?.dispose()
    } catch {
      // dispose 幂等
    }
  }
}

function nameOfCode(
  table: Record<string, unknown>,
  code: number,
): string | null {
  for (const [name, value] of Object.entries(table)) {
    if (value === code) return name
  }
  return null
}

function emptyMetrics(): FlowMilpResult['metrics'] {
  return { energyKwh: null, switches: null, excessSupplyM3: null }
}

function buildPlanFromSolution(
  input: FlowMilpInput,
  units: Unit[],
  model: Model,
): PlanResult {
  const solution = model.getSolution()
  const values = solution.colValue
  const T = input.points.length
  const U = units.length
  const idx = (u: number, t: number, k: number) => (u * T + t) * 4 + k
  const periods: PeriodPlan[] = []
  let prev = new Set(
    input.initial.runningUnitIds.filter((id) => units.some((u) => u.id === id)),
  )
  let totalEnergy = 0
  let totalSwitches = 0
  for (let t = 0; t < T; t += 1) {
    const running: Unit[] = []
    const unitLoads: Record<string, number> = {}
    const unitLoadRatios: Record<string, number> = {}
    for (let u = 0; u < U; u += 1) {
      const x = values[idx(u, t, 0)] ?? 0
      const q = values[idx(u, t, 3)] ?? 0
      if (x > 0.5) {
        running.push(units[u])
        unitLoads[units[u].id] = q
        unitLoadRatios[units[u].id] = q / units[u].ratedCapacity
      }
    }
    const cur = new Set(running.map((u) => u.id))
    const candidateFlips = units.reduce(
      (s, u) => (prev.has(u.id) !== cur.has(u.id) ? s + 1 : s),
      0,
    )
    const switches = candidateFlips + (t === 0 ? forcedStopCount(input, units) : 0)
    const supply = running.reduce((s, u) => s + (unitLoads[u.id] ?? 0), 0)
    const powerKw = running.reduce((s, u) => s + unitPower(u, unitLoads[u.id] ?? 0), 0)
    const energyKwh = powerKw * (input.stepMinutes / 60)
    totalEnergy += energyKwh
    totalSwitches += switches
    periods.push({
      index: input.points[t].index,
      minuteOfDay: input.points[t].minuteOfDay,
      label: input.points[t].label,
      demand: input.points[t].demand,
      runningUnitIds: running.map((u) => u.id),
      unitLoads,
      unitLoadRatios,
      supply: round2(supply),
      margin: round2(supply - input.points[t].demand),
      powerKw: round2(powerKw),
      energyKwh: round2(energyKwh),
      switches,
      violations: [],
      rationale: `continuous-flow-milp-v1 primal：需求 ${input.points[t].demand.toFixed(1)} m³/min。`,
    })
    prev = cur
  }
  return {
    planType: 'recommendation',
    variant: 'recommendation',
    feasible: true,
    infeasibleReasons: [],
    infeasiblePeriods: [],
    periods,
    totalEnergyKwh: round2(totalEnergy),
    totalSwitches,
    violationCount: 0,
    exclusionNotes: [],
  }
}

function forcedStopCount(input: FlowMilpInput, units: Unit[]): number {
  const ids = new Set(units.map((u) => u.id))
  return input.units.filter(
    (u) => input.initial.runningUnitIds.includes(u.id) && !ids.has(u.id),
  ).length
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

// ---- 开发夹具（新 seed 20261003；非随机抽样）----

export interface FlowMilpFixture {
  fixtureId: string
  seed: number
  stepMinutes: number
  points: DemandPoint[]
  initial: InitialUnitState
}

export function buildFlowMilpDevFixture(): FlowMilpFixture {
  const demands = [11.4, 22, 11.4, 22]
  const minutes = [480, 495, 510, 525]
  const points: DemandPoint[] = minutes.map((minuteOfDay, index) => ({
    index,
    minuteOfDay,
    label: `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(
      minuteOfDay % 60,
    ).padStart(2, '0')}`,
    demand: demands[index],
  }))
  return {
    fixtureId: 'flow-milp-dev-4bucket',
    seed: FLOW_MILP_DEV_SEED,
    stepMinutes: 15,
    points,
    initial: {
      runningUnitIds: ['AC-01'],
      minutesSinceChange: { 'AC-01': 30, 'AC-02': 30, 'AC-03': 30 },
    },
  }
}
