import { formatMinuteOfDay } from './demand'
import {
  allocateLoads,
  evaluateUnits,
  planConservativeBaseline,
  unitPower,
  type ScenarioRun,
  type ScenarioRunTimingsMs,
} from './engine'
import { verifyPlanConstraints, type VerifyContext } from './constraints'
import { mulberry32 } from './prng'
import { UNITS } from './units'
import type {
  DemandPoint,
  EvaluationResult,
  InitialUnitState,
  PeriodPlan,
  PlanResult,
  ScenarioId,
  SyntheticSeries,
  Unit,
  UnitEligibility,
} from './types'

/**
 * 第二片：可恢复扰动与真实方案取舍（lab-v1）。
 *
 * 冻结约束：不修改 engine/demand/constraints/evaluation/units 的字节与语义，
 * 不更改全局 RULE_VERSION。本模块复用旧公开函数（evaluateUnits / allocateLoads /
 * unitPower / planConservativeBaseline）与独立 verifyPlanConstraints，只用平台自有
 * 合成数据，仅做“全窗口已知合成负荷的有界方案比较”，不是现场最优、非在线预测，
 * 无设备执行、无在线 LLM。
 */

export const LAB_STEP_MINUTES = 15
export const LAB_PERIODS = 96
export const LAB_DEV_SEED = 20261002
export const LAB_GENERATOR_VERSION = 'lab-fixtures-v1'
export const LAB_STRATEGY_VERSION = 'lab-bounded-fs-v1'
export const LAB_MANIFEST_VERSION = 'qiheng-lab-manifest-v1'
/** 有限状态预算：超过即 fail-closed，不静默降级。 */
export const LAB_STATE_BUDGET = 4096
/** 有界求解器明确支持的候选数上限（超出 fail-closed）。 */
export const LAB_MAX_CANDIDATES = 3

const EPS = 1e-6

export type LabPreference = 'energy_first' | 'switch_first'
export type LabFixtureId =
  | 'capacity_rise'
  | 'capacity_oscillate'
  | 'standby_takeover'

export interface LabFixtureMeta {
  id: LabFixtureId
  label: string
  description: string
}

export const LAB_FIXTURES: LabFixtureMeta[] = [
  {
    id: 'capacity_rise',
    label: '夹具 L1｜容量内短时抬升',
    description:
      '常规低中负荷，某短窗口抬升至约 24–29 m³/min 再回落；全窗口需求不超过安全可用容量 32 m³/min。',
  },
  {
    id: 'capacity_oscillate',
    label: '夹具 L2｜容量内往复波动',
    description:
      '间歇在单机可供范围与需要两机之间交替，变化窗口清晰；全窗口需求不超过 32 m³/min。',
  },
  {
    id: 'standby_takeover',
    label: '夹具 L3｜备用承接低负荷',
    description:
      'AC-01 全窗口退出（非故障、非维修、未执行），需求 6–11.5 m³/min 由 AC-02 承担，峰值不超过 12 m³/min。',
  },
]

export interface LabFixtureProfile {
  id: LabFixtureId
  base: number
  amplitude: number
  /** 需要额外排除出候选的机组及原因（如 L3 的 AC-01 全窗口退出）。 */
  extraExcluded: Record<string, string>
  initial: InitialUnitState
}

const LAB_PROFILES: Record<LabFixtureId, Omit<LabFixtureProfile, 'id'>> = {
  capacity_rise: {
    base: 15,
    amplitude: 3,
    extraExcluded: {},
    initial: { runningUnitIds: ['AC-01'], minutesSinceChange: { 'AC-01': 5 } },
  },
  capacity_oscillate: {
    base: 17,
    amplitude: 4,
    extraExcluded: {},
    initial: { runningUnitIds: ['AC-01'], minutesSinceChange: { 'AC-01': 5 } },
  },
  standby_takeover: {
    base: 8.8,
    amplitude: 2.7,
    extraExcluded: {
      'AC-01':
        '本夹具 AC-01 全窗口退出（备用机承接，非故障 / 非维修，未执行）。',
    },
    initial: { runningUnitIds: ['AC-02'], minutesSinceChange: { 'AC-02': 0 } },
  },
}

function hashString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
function round2(value: number): number {
  return Math.round(value * 100) / 100
}
function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** 夹具需求形状：确定性、可复现的轻微扰动，全部不超过安全可用容量 32。 */
function demandAt(profile: LabFixtureProfile, i: number, noise: number): number {
  const wave = Math.sin((i / LAB_PERIODS) * Math.PI * 2)
  if (profile.id === 'capacity_rise') {
    // 低中负荷，短窗口（第 40–47 桶，10:00–12:00）抬升后回落。
    if (i >= 40 && i <= 47) {
      const ramp = Math.sin(((i - 40) / 7) * Math.PI)
      return round1(Math.min(29, 24 + ramp * 5 + noise))
    }
    return round1(profile.base + profile.amplitude * wave + noise)
  }
  if (profile.id === 'capacity_oscillate') {
    const block = Math.floor(i / 8)
    const high = block % 2 === 1
    const local = high ? 26 : 16
    const ramp = 1 - Math.abs(1 - (i % 8) / 4)
    return round1(local + (high ? 1 : -1) * ramp + noise)
  }
  // standby_takeover：6–11.5 缓慢波动
  const t = i / (LAB_PERIODS - 1)
  return round1(6 + 5.5 * (0.5 + 0.5 * Math.sin(t * Math.PI * 3)) + noise)
}

export function labFixtureProfile(fixtureId: LabFixtureId): LabFixtureProfile {
  const meta = LAB_PROFILES[fixtureId]
  return { id: fixtureId, ...meta }
}

export function buildLabSeries(
  fixtureId: LabFixtureId,
  seed: number = LAB_DEV_SEED,
): SyntheticSeries {
  const profile = labFixtureProfile(fixtureId)
  const rng = mulberry32(seed + hashString(`lab:${fixtureId}`))
  const points: DemandPoint[] = []
  for (let i = 0; i < LAB_PERIODS; i += 1) {
    const minuteOfDay = i * LAB_STEP_MINUTES
    const noise = (rng() * 2 - 1) * 0.25
    const demand = Math.min(32, Math.max(0, demandAt(profile, i, noise)))
    points.push({
      index: i,
      minuteOfDay,
      label: formatMinuteOfDay(minuteOfDay),
      demand: round1(demand),
    })
  }
  const meta = LAB_FIXTURES.find((f) => f.id === fixtureId)
  return {
    seed,
    scenario: 'normal',
    scenarioLabel: meta ? meta.label : fixtureId,
    synthetic: true,
    stepMinutes: LAB_STEP_MINUTES,
    points,
    note: `${LAB_GENERATOR_VERSION}：固定种子 ${seed}，96×15 分钟，首桶 00:00；合成演示数据，非现场实测。`,
  }
}

function labEvaluation(
  fixture: LabFixtureProfile,
  scenario: ScenarioId = 'normal',
): EvaluationResult {
  const base = evaluateUnits(UNITS, scenario)
  const eligibility: UnitEligibility[] = base.eligibility.map((e) => {
    const reason = fixture.extraExcluded[e.unitId]
    if (reason && e.eligible) {
      return { ...e, eligible: false, reason }
    }
    return e
  })
  const candidateIds = new Set(
    eligibility.filter((e) => e.eligible).map((e) => e.unitId),
  )
  const candidates = base.candidates.filter((u) => candidateIds.has(u.id))
  const excludedNotes = eligibility
    .filter((e) => !e.eligible)
    .map((e) => {
      const unit = UNITS.find((u) => u.id === e.unitId) as Unit
      return `${unit.name}（${unit.id}）：${e.reason}`
    })
  return { candidates, eligibility, excludedNotes }
}

/** 某夹具的安全候选机组 ID（AC-03 始终排除）。 */
export function labEvaluationCandidateIds(fixtureId: LabFixtureId): string[] {
  return labEvaluation(labFixtureProfile(fixtureId)).candidates.map((u) => u.id)
}

// ---- 有界有限状态全窗口求解 ----

interface BoundedInput {
  series: SyntheticSeries
  candidates: Unit[]
  allUnits: Unit[]
  initial: InitialUnitState
  preference: LabPreference
  stateBudget?: number
  /** 可选：同初态完整独立复验上下文；提供时返回 planned 前必须通过。 */
  context?: VerifyContext
}

export interface BoundedResult {
  status: 'planned' | 'infeasible' | 'budget_exceeded'
  preference: LabPreference
  plan: PlanResult | null
  reasons: string[]
  stateBudget: number
  maxStatesSeen: number
}

function better(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i]
    if (Math.abs(d) > 1e-9) return d < 0
  }
  return false
}

function initialCooldown(
  unit: Unit,
  initial: InitialUnitState,
  stepMinutes: number,
): number {
  const m = initial.minutesSinceChange[unit.id]
  if (m === undefined) return 0
  const remain = unit.minStartStopInterval - m
  if (remain <= 0) return 0
  return Math.ceil(remain / stepMinutes)
}

/**
 * 有界有限状态全窗口求解：状态 = 开机集合 + 每机满足最小启停间隔所需的冷却步数。
 * 每步用既有 allocateLoads(..., true) 分配并以同一 unitPower 计能；
 * 违反资格 / 供需 / 最小负载 / 启停间隔的转移直接排除。超候选上限或状态预算 fail-closed。
 */
export function solveLabPreference(input: BoundedInput): BoundedResult {
  const { series, candidates, allUnits, initial, preference } = input
  const step = series.stepMinutes
  const budget = input.stateBudget ?? LAB_STATE_BUDGET
  const n = candidates.length

  if (n === 0) {
    return {
      status: 'infeasible',
      preference,
      plan: null,
      reasons: ['没有可用的安全候选机组。'],
      stateBudget: budget,
      maxStatesSeen: 0,
    }
  }
  if (n > LAB_MAX_CANDIDATES) {
    return {
      status: 'budget_exceeded',
      preference,
      plan: null,
      reasons: [
        `候选数 ${n} 超过有界求解上限 ${LAB_MAX_CANDIDATES}，fail-closed 不求解。`,
      ],
      stateBudget: budget,
      maxStatesSeen: 0,
    }
  }

  // 全部已知机组的初态都要处理：不在候选内的初始开机机组必须首桶停机，
  // 不能因“不在候选”而被过滤掉。停机受最小启停间隔约束，违反则 fail-closed。
  const candidateIdSet = new Set(candidates.map((u) => u.id))
  const forcedOffInitial = allUnits.filter(
    (u) => initial.runningUnitIds.includes(u.id) && !candidateIdSet.has(u.id),
  )
  for (const u of forcedOffInitial) {
    if (initialCooldown(u, initial, step) > 0) {
      return {
        status: 'infeasible',
        preference,
        plan: null,
        reasons: [
          `初态锁定：${u.name}（${u.id}）初始已开机且不足最小启停间隔 ${u.minStartStopInterval} 分钟，首桶无法合法停机（非容量不足），fail-closed。`,
        ],
        stateBudget: budget,
        maxStatesSeen: 0,
      }
    }
  }
  const forcedStopFlips = forcedOffInitial.length

  const fullMask = (1 << n) - 1
  // 变更后需锁定的后续步数 = 满足 k*step < interval 的 k 个数 = ceil(interval/step) - 1。
  const coolCap = candidates.map(
    (u) => Math.max(0, Math.ceil(u.minStartStopInterval / step) - 1),
  )
  const popcount = (mask: number): number => {
    let c = 0
    let m = mask
    while (m) {
      c += m & 1
      m >>= 1
    }
    return c
  }
  const maskToList = (mask: number): Unit[] =>
    candidates.filter((_, i) => (mask & (1 << i)) !== 0)
  const encode = (mask: number, cool: number[]): string => `${mask}|${cool.join(',')}`

  const initialMask = candidates.reduce(
    (acc, u, i) => (initial.runningUnitIds.includes(u.id) ? acc | (1 << i) : acc),
    0,
  )
  const initialCool = candidates.map((u) => initialCooldown(u, initial, step))
  const startKey = encode(initialMask, initialCool)

  interface Cell {
    cost: number[]
    prevKey: string
    mask: number
  }
  const layers: Array<Map<string, Cell>> = []
  let layer = new Map<string, Cell>()
  layer.set(startKey, { cost: [0, 0, 0, 0], prevKey: '', mask: initialMask })
  let maxStatesSeen = layer.size

  for (let p = 0; p < series.points.length; p += 1) {
    const point = series.points[p]
    const next = new Map<string, Cell>()
    let anyFeasible = false
    for (const [key, cell] of layer) {
      const prevMask = cell.mask
      const cool = key.split('|')[1].split(',').map(Number)
      for (let mask = 0; mask <= fullMask; mask += 1) {
        const changed = mask ^ prevMask
        let illegal = false
        for (let i = 0; i < n; i += 1) {
          if ((changed & (1 << i)) !== 0 && cool[i] > 0) {
            illegal = true
            break
          }
        }
        if (illegal) continue
        const running = maskToList(mask)
        const alloc = allocateLoads(running, point.demand, true)
        if (alloc.supply + EPS < point.demand) continue

        anyFeasible = true
        const energy =
          running.reduce((s, u) => s + unitPower(u, alloc.loads[u.id] ?? 0), 0) *
          (step / 60)
        const flips = popcount(changed)
        const nextCool = candidates.map((_candidate, i) =>
          (changed & (1 << i)) !== 0
            ? coolCap[i]
            : Math.max(0, cool[i] - 1),
        )
        const newKey = encode(mask, nextCool)
        const base = preference === 'energy_first' ? [energy, flips] : [flips, energy]
        const cost = [
          cell.cost[0] + base[0],
          cell.cost[1] + base[1],
          cell.cost[2] + mask,
          cell.cost[3] + popcount(mask),
        ]
        const existing = next.get(newKey)
        if (!existing || better(cost, existing.cost)) {
          next.set(newKey, { cost, prevKey: key, mask })
        }
      }
    }
    if (!anyFeasible) {
      return {
        status: 'infeasible',
        preference,
        plan: null,
        reasons: [
          `第 ${p + 1} 个时段（${point.label}，需求 ${point.demand.toFixed(1)} m³/min）在所有可达状态下均无合法转移：需求超安全可用容量或受最小启停间隔锁定。`,
        ],
        stateBudget: budget,
        maxStatesSeen,
      }
    }
    if (next.size > budget) {
      return {
        status: 'budget_exceeded',
        preference,
        plan: null,
        reasons: [
          `第 ${p + 1} 个时段状态数 ${next.size} 超过预算 ${budget}，fail-closed 不求解。`,
        ],
        stateBudget: budget,
        maxStatesSeen: Math.max(maxStatesSeen, next.size),
      }
    }
    maxStatesSeen = Math.max(maxStatesSeen, next.size)
    layers.push(next)
    layer = next
  }

  // 选最优终态并回溯
  let bestKey: string | null = null
  let bestCell: Cell | null = null
  for (const [key, cell] of layer) {
    if (!bestCell || better(cell.cost, bestCell.cost)) {
      bestCell = cell
      bestKey = key
    }
  }
  if (!bestKey || !bestCell) {
    return {
      status: 'infeasible',
      preference,
      plan: null,
      reasons: ['未找到完整全窗口方案。'],
      stateBudget: budget,
      maxStatesSeen,
    }
  }

  const masks: number[] = []
  let cursor = bestKey
  for (let p = series.points.length - 1; p >= 0; p -= 1) {
    const cell = layers[p].get(cursor) as Cell
    masks[p] = cell.mask
    cursor = cell.prevKey
  }

  const periods: PeriodPlan[] = []
  let totalEnergyUnrounded = 0
  let prevRunning = new Set(
    initial.runningUnitIds.filter((id) => candidates.some((u) => u.id === id)),
  )
  for (let p = 0; p < series.points.length; p += 1) {
    const point = series.points[p]
    const running = maskToList(masks[p])
    const cur = new Set(running.map((u) => u.id))
    const alloc = allocateLoads(running, point.demand, true)
    const powerKw = running.reduce(
      (s, u) => s + unitPower(u, alloc.loads[u.id] ?? 0),
      0,
    )
    const energyKwh = powerKw * (step / 60)
    totalEnergyUnrounded += energyKwh
    // 首桶还要计入“非候选但初始开机机组”的停机翻转（常数成本，两偏好声明都含）。
    const switches =
      candidates.reduce(
        (s, u) => (prevRunning.has(u.id) !== cur.has(u.id) ? s + 1 : s),
        0,
      ) + (p === 0 ? forcedStopFlips : 0)
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
    periods.push({
      index: point.index,
      minuteOfDay: point.minuteOfDay,
      label: point.label,
      demand: point.demand,
      runningUnitIds: running.map((u) => u.id),
      unitLoads: alloc.loads,
      unitLoadRatios: alloc.ratios,
      supply: round2(alloc.supply),
      margin: round2(alloc.supply - point.demand),
      powerKw: round2(powerKw),
      energyKwh: round2(energyKwh),
      switches,
      violations: [],
      rationale: `有界全窗口方案（偏好 ${preference}）：需求 ${point.demand.toFixed(
        1,
      )} m³/min；${loadText}；总供气 ${round2(alloc.supply).toFixed(1)}；模型能量 ${round2(
        energyKwh,
      ).toFixed(2)} kWh/时段。`,
    })
    prevRunning = cur
  }

  const plan: PlanResult = {
    planType: 'recommendation',
    variant: 'recommendation',
    feasible: true,
    infeasibleReasons: [],
    infeasiblePeriods: [],
    periods,
    totalEnergyKwh: round2(totalEnergyUnrounded),
    totalSwitches: periods.reduce((s, x) => s + x.switches, 0),
    violationCount: 0,
    exclusionNotes: [],
  }
  // 返回 planned 前，以同初态的旧完整独立复验再核对；不得返回已知非法方案。
  if (input.context) {
    const verification = verifyPlanConstraints(plan, input.context)
    if (!verification.passed) {
      return {
        status: 'infeasible',
        preference,
        plan: null,
        reasons: [
          `有界方案未通过同初态完整独立复验（${verification.violationCount} 项，完整性=${verification.complete}），fail-closed 不返回该方案。`,
        ],
        stateBudget: budget,
        maxStatesSeen,
      }
    }
  }

  return {
    status: 'planned',
    preference,
    plan,
    reasons: [],
    stateBudget: budget,
    maxStatesSeen,
  }
}

// ---- 独立指标核对 ----

export interface LabMetricMismatch {
  field: string
  periodIndex?: number
  declared: number
  recomputed: number
}

export interface LabMetricCheck {
  ok: boolean
  mismatches: LabMetricMismatch[]
  recomputed: {
    totalEnergyKwh: number
    totalSwitches: number
    excessSupplyM3: number
  }
}

/**
 * 独立核对：从逐桶 unitLoads、机组参数与步长重算能量；从共享 initial 重算逐机翻转；
 * 重算过量供气 Σmax(供气−需求,0)×分钟。不直接信任 totalEnergyKwh / totalSwitches。
 */
function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 独立核对：从逐桶 unitLoads、机组参数与步长重算 powerKw / energyKwh / 总能量；
 * 从共享 initial 重算全部已知机组翻转；从复算供气（Σ 负载）与需求重算过量供气。
 * 对声明与复算的所有参与指标及步长做 finite / 合法值检查：非法 / 缺失 / NaN / Infinity
 * 一律 metricsOk=false，不以放宽容差掩盖偏差。
 */
export function verifyLabPlanMetrics(
  plan: PlanResult,
  allUnits: Unit[],
  initial: InitialUnitState,
  stepMinutes: number,
): LabMetricCheck {
  const mismatches: LabMetricMismatch[] = []
  const push = (field: string, declared: number, recomputed: number, periodIndex?: number) => {
    mismatches.push({ field, declared, recomputed, periodIndex })
  }

  if (!finiteNumber(stepMinutes) || stepMinutes <= 0) {
    push('stepMinutes', stepMinutes, 0)
    return {
      ok: false,
      mismatches,
      recomputed: { totalEnergyKwh: 0, totalSwitches: 0, excessSupplyM3: 0 },
    }
  }
  if (!plan.feasible || plan.periods.length === 0) {
    push('planFeasible', plan.periods.length, 0)
    return {
      ok: false,
      mismatches,
      recomputed: { totalEnergyKwh: 0, totalSwitches: 0, excessSupplyM3: 0 },
    }
  }

  const byId = new Map(allUnits.map((u) => [u.id, u]))
  let totalEnergy = 0
  let totalFlips = 0
  let excess = 0
  let prev = new Set(initial.runningUnitIds.filter((id) => byId.has(id)))

  for (const p of plan.periods) {
    // 逐桶声明字段有限性
    for (const [field, value] of [
      ['demand', p.demand],
      ['supply', p.supply],
      ['powerKw', p.powerKw],
      ['energyKwh', p.energyKwh],
    ] as const) {
      if (!finiteNumber(value)) {
        push(field, value as number, 0, p.index)
      }
    }

    // 从负载独立重算供气与功率
    let supply = 0
    let powerKw = 0
    let loadValid = true
    for (const id of p.runningUnitIds) {
      const unit = byId.get(id)
      const load = p.unitLoads[id]
      if (!unit || !finiteNumber(load) || load < 0) {
        loadValid = false
        continue
      }
      supply += load
      powerKw += unitPower(unit, load)
    }
    if (!loadValid) {
      push('periodLoads', 0, 0, p.index)
    }
    const energy = powerKw * (stepMinutes / 60)
    totalEnergy += energy

    if (finiteNumber(p.powerKw) && Math.abs(powerKw - p.powerKw) > 0.01) {
      push('periodPowerKw', p.powerKw, round2(powerKw), p.index)
    }
    if (finiteNumber(p.energyKwh) && Math.abs(energy - p.energyKwh) > 0.01) {
      push('periodEnergyKwh', p.energyKwh, round2(energy), p.index)
    }
    if (finiteNumber(p.supply) && Math.abs(supply - p.supply) > 0.02) {
      push('periodSupply', p.supply, round2(supply), p.index)
    }

    const cur = new Set(p.runningUnitIds)
    let flips = 0
    for (const u of allUnits) {
      if (prev.has(u.id) !== cur.has(u.id)) flips += 1
    }
    if (flips !== p.switches) {
      push('periodSwitches', p.switches, flips, p.index)
    }
    totalFlips += flips

    if (finiteNumber(p.demand) && supply > p.demand) {
      excess += (supply - p.demand) * stepMinutes
    }
    prev = cur
  }

  if (!finiteNumber(plan.totalEnergyKwh) || Math.abs(round2(totalEnergy) - plan.totalEnergyKwh) > 0.01) {
    push('totalEnergyKwh', plan.totalEnergyKwh, round2(totalEnergy))
  }
  if (!finiteNumber(plan.totalSwitches) || totalFlips !== plan.totalSwitches) {
    push('totalSwitches', plan.totalSwitches, totalFlips)
  }

  const recomputed = {
    totalEnergyKwh: round2(totalEnergy),
    totalSwitches: totalFlips,
    excessSupplyM3: round2(excess),
  }
  return { ok: mismatches.length === 0, mismatches, recomputed }
}

// ---- 夹具求解与取舍 ----

export interface LabPlanView {
  preference: LabPreference
  plan: PlanResult
  verified: boolean
  metricsOk: boolean
  energyKwh: number | null
  switches: number | null
  excessSupplyM3: number | null
  notes: string[]
}

export interface LabComparison {
  energyFirst: LabPlanView
  switchFirst: LabPlanView
  equivalent: boolean
  deltas: {
    energyKwh: number | null
    switches: number | null
    excessSupplyM3: number | null
  }
}

function buildView(
  preference: LabPreference,
  result: BoundedResult,
  allUnits: Unit[],
  initial: InitialUnitState,
  step: number,
  context: VerifyContext,
): LabPlanView {
  if (!result.plan) {
    return {
      preference,
      plan: {
        planType: 'recommendation',
        variant: 'recommendation',
        feasible: false,
        infeasibleReasons: result.reasons,
        infeasiblePeriods: [],
        periods: [],
        totalEnergyKwh: 0,
        totalSwitches: 0,
        violationCount: 0,
        exclusionNotes: [],
      },
      verified: false,
      metricsOk: false,
      energyKwh: null,
      switches: null,
      excessSupplyM3: null,
      notes: [`${preference}：${result.status}，${result.reasons[0] ?? '无方案'}`],
    }
  }
  const verified = verifyPlanConstraints(result.plan, context).passed
  const metrics = verifyLabPlanMetrics(result.plan, allUnits, initial, step)
  // 硬约束复验与指标核对都通过才有可比较数值；任一失败全部记 null，避免展示伪优势。
  const ok = verified && metrics.ok
  return {
    preference,
    plan: result.plan,
    verified,
    metricsOk: metrics.ok,
    energyKwh: ok ? metrics.recomputed.totalEnergyKwh : null,
    switches: ok ? metrics.recomputed.totalSwitches : null,
    excessSupplyM3: ok ? metrics.recomputed.excessSupplyM3 : null,
    notes: [
      ...(verified ? [] : ['独立硬约束复验未通过']),
      ...(metrics.ok ? [] : ['独立指标核对发现声明与复算不一致（含有限性/功率核对）']),
    ],
  }
}

function plansEquivalent(a: PlanResult, b: PlanResult): boolean {
  if (a.periods.length !== b.periods.length) return false
  for (let i = 0; i < a.periods.length; i += 1) {
    const pa = a.periods[i]
    const pb = b.periods[i]
    if (pa.index !== pb.index || pa.demand !== pb.demand) return false
    if (pa.runningUnitIds.slice().sort().join('+') !== pb.runningUnitIds.slice().sort().join('+')) {
      return false
    }
    const keys = new Set([...Object.keys(pa.unitLoads), ...Object.keys(pb.unitLoads)])
    for (const k of keys) {
      if ((pa.unitLoads[k] ?? 0) !== (pb.unitLoads[k] ?? 0)) return false
    }
  }
  return true
}

// ---- 适配为既有 ScenarioRun ----

export interface LabMetadata {
  mode: 'lab'
  fixtureId: LabFixtureId
  fixtureLabel: string
  generatorVersion: string
  strategyVersion: string
  preference: LabPreference
  seed: number
  initial: InitialUnitState
  identity: string
  fingerprint: string
}

export type LabRun = ScenarioRun & { lab: LabMetadata }

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function fingerprint(text: string): string {
  return hashString(text).toString(16).padStart(8, '0')
}

/** 稳定规范身份串：夹具 / 生成器 / 策略 / 种子 / 初态 / 步长与完整序列 / 机组参数 / 完整计划。 */
export function labIdentity(series: SyntheticSeries, initial: InitialUnitState, plan: PlanResult, preference: LabPreference): string {
  const points = series.points
    .map((p) => `${p.index}:${p.minuteOfDay}:${p.demand.toFixed(4)}`)
    .join('|')
  const units = UNITS.map(
    (u) =>
      `${u.id}:${u.kind}:${u.ratedCapacity}:${u.minLoadRatio}:${u.ratedPower}:${u.unloadPowerRatio}:${u.minStartStopInterval}:${u.surgeBoundaryVerified}`,
  ).join('|')
  const initialText = `run=${[...initial.runningUnitIds].sort().join(',')};age=${Object.keys(
    initial.minutesSinceChange,
  )
    .sort()
    .map((k) => `${k}=${initial.minutesSinceChange[k]}`)
    .join(',')}`
  const planText = plan.periods
    .map(
      (p) =>
        `${p.index}:${p.demand.toFixed(4)}:${[...p.runningUnitIds].sort().join('+')}:${Object.keys(
          p.unitLoads,
        )
          .sort()
          .map((k) => `${k}=${(p.unitLoads[k] ?? 0).toFixed(4)}`)
          .join(',')}:${p.supply.toFixed(4)}`,
    )
    .join(';')
  return [
    `mode=lab`,
    `manifest=${LAB_MANIFEST_VERSION}`,
    `fixture=${series.scenarioLabel}`,
    `generator=${LAB_GENERATOR_VERSION}`,
    `strategy=${LAB_STRATEGY_VERSION}`,
    `preference=${preference}`,
    `seed=${series.seed}`,
    `step=${series.stepMinutes}`,
    `initial=${initialText}`,
    `points=${points}`,
    `units=${units}`,
    `plan=${planText}`,
  ].join('\n')
}

export function buildLabRun(
  fixtureId: LabFixtureId,
  preference: LabPreference,
  seed: number = LAB_DEV_SEED,
): LabRun {
  const t0 = nowMs()
  const profile = labFixtureProfile(fixtureId)
  const series = buildLabSeries(fixtureId, seed)
  const evaluation = labEvaluation(profile)
  const initial = profile.initial
  // 供独立复验用的上下文字段（与 ScenarioRun 同形）。
  const contextBase = {
    series,
    allUnits: UNITS,
    evaluation,
    initial,
    faultUnitId: null,
  }
  const t1 = nowMs()
  const energyResult = solveLabPreference({
    series,
    candidates: evaluation.candidates,
    allUnits: UNITS,
    initial,
    preference: 'energy_first',
    context: contextBase,
  })
  const t2 = nowMs()
  const switchResult = solveLabPreference({
    series,
    candidates: evaluation.candidates,
    allUnits: UNITS,
    initial,
    preference: 'switch_first',
    context: contextBase,
  })
  const t3 = nowMs()
  const baselinePlan = planConservativeBaseline(
    series,
    evaluation.candidates,
    UNITS,
    evaluation.excludedNotes,
    initial,
  )
  const t4 = nowMs()

  const energyView = buildView(
    'energy_first',
    energyResult,
    UNITS,
    initial,
    series.stepMinutes,
    contextBase,
  )
  const switchView = buildView(
    'switch_first',
    switchResult,
    UNITS,
    initial,
    series.stepMinutes,
    contextBase,
  )
  const selected = preference === 'energy_first' ? energyView : switchView
  const other = preference === 'energy_first' ? switchView : energyView

  const recommendation: PlanResult = selected.verified && selected.metricsOk
    ? selected.plan
    : {
        planType: 'recommendation',
        variant: 'recommendation',
        feasible: false,
        infeasibleReasons:
          selected.notes.length > 0
            ? selected.notes
            : ['所选方案未通过完整独立复验 / 指标核对，不输出为当前方案。'],
        infeasiblePeriods: [],
        periods: [],
        totalEnergyKwh: 0,
        totalSwitches: 0,
        violationCount: 0,
        exclusionNotes: evaluation.excludedNotes,
      }

  const conservativeBaseline: PlanResult = other.verified && other.metricsOk
    ? other.plan
    : {
        planType: 'baseline',
        variant: 'conservative',
        feasible: false,
        infeasibleReasons: other.notes.length ? other.notes : ['对照方案不可用。'],
        infeasiblePeriods: [],
        periods: [],
        totalEnergyKwh: 0,
        totalSwitches: 0,
        violationCount: 0,
        exclusionNotes: evaluation.excludedNotes,
      }

  const timingsMs: ScenarioRunTimingsMs = {
    baselineMs: round3(t1 - t0),
    conservativeMs: round3(t2 - t1),
    recommendationMs: round3(t3 - t2),
  }

  const meta = LAB_FIXTURES.find((f) => f.id === fixtureId)
  const planForIdentity = selected.plan.feasible ? selected.plan : recommendation
  const identity = labIdentity(series, initial, planForIdentity, preference)

  const run: LabRun = {
    series: { ...series, scenarioLabel: meta?.label ?? series.scenarioLabel },
    evaluation,
    baseline: baselinePlan,
    conservativeBaseline,
    recommendation,
    allUnits: UNITS,
    initial,
    faultUnitId: null,
    timingsMs: { ...timingsMs, recommendationMs: round3(t3 - t2 + (t4 - t3)) },
    lab: {
      mode: 'lab',
      fixtureId,
      fixtureLabel: meta?.label ?? fixtureId,
      generatorVersion: LAB_GENERATOR_VERSION,
      strategyVersion: LAB_STRATEGY_VERSION,
      preference,
      seed,
      initial,
      identity,
      fingerprint: fingerprint(identity),
    },
  }
  return run
}

export interface LabComparisonResult {
  run: LabRun
  comparison: LabComparison
}

/** 构建两偏好对照（供 UI 展示差额与等价标记）。 */
export function buildLabComparison(
  fixtureId: LabFixtureId,
  preference: LabPreference,
  seed: number = LAB_DEV_SEED,
): LabComparisonResult {
  const run = buildLabRun(fixtureId, preference, seed)
  const profile = labFixtureProfile(fixtureId)
  const series = buildLabSeries(fixtureId, seed)
  const evaluation = labEvaluation(profile)
  const contextBase = {
    series,
    allUnits: UNITS,
    evaluation,
    initial: profile.initial,
    faultUnitId: null,
  }
  const energyView = buildView(
    'energy_first',
    solveLabPreference({
      series,
      candidates: evaluation.candidates,
      allUnits: UNITS,
      initial: profile.initial,
      preference: 'energy_first',
      context: contextBase,
    }),
    UNITS,
    profile.initial,
    series.stepMinutes,
    contextBase,
  )
  const switchView = buildView(
    'switch_first',
    solveLabPreference({
      series,
      candidates: evaluation.candidates,
      allUnits: UNITS,
      initial: profile.initial,
      preference: 'switch_first',
      context: contextBase,
    }),
    UNITS,
    profile.initial,
    series.stepMinutes,
    contextBase,
  )
  const equivalent =
    energyView.plan.feasible &&
    switchView.plan.feasible &&
    plansEquivalent(energyView.plan, switchView.plan)
  const delta = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? null : round3(a - b)
  return {
    run,
    comparison: {
      energyFirst: energyView,
      switchFirst: switchView,
      equivalent,
      deltas: {
        energyKwh: delta(energyView.energyKwh, switchView.energyKwh),
        switches: delta(energyView.switches, switchView.switches),
        excessSupplyM3: delta(energyView.excessSupplyM3, switchView.excessSupplyM3),
      },
    },
  }
}

export const LAB_DECLARATIONS = [
  'lab-v1 为“全窗口已知合成负荷的有界方案比较”，不是现场最优、非在线预测，也不代表压力或磨损。',
  '每桶供气由既有 allocateLoads(..., true) 分配，能量由同一 unitPower 线性模型推算；过量供气不代表现场放空或压力波动。',
  'AC-03 离心机喘振边界未核实，始终排除；无设备执行、无在线 LLM。',
  '失败计划不输出部分窗口，比较指标为 null 并给原因；不退回旧建议充当当前方案。',
  '本次仅 development（固定种子），未建立或使用任何 holdout。',
]
