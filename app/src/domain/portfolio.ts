import { evaluateUnits, planConservativeBaseline, unitPower } from './engine'
import { verifyPlanConstraints, type VerifyContext, VERIFIER_VERSION } from './constraints'
import { solveLabPreference, verifyLabPlanMetrics } from './lab'
import { RULE_VERSION } from './audit'
import { UNITS } from './units'
import type {
  DemandPoint,
  EvaluationResult,
  InitialUnitState,
  PlanResult,
  Unit,
  UnitEligibility,
} from './types'
import {
  solveFlowMilp,
  FLOW_MILP_MODEL_VERSION,
  FLOW_MILP_OBJECTIVE_VERSION,
  type FlowMilpDiagnostics,
  type FlowMilpResult,
} from './optimizer/flowMilp'

/**
 * portfolio-dev-v1：96 桶 development 组合比较（隔离模块）。
 * 复用既有 HiGHS solver/controller 与冻结公开函数；不改 7 冻结文件/旧留出。
 * 全部 development，不称 holdout/预测。
 *
 * b01 收尾：新增独立完整 canonical 身份（有限原值、全桶、规范排序、不四舍五入），
 * 候选携带 inputIdentity 绑定；Pareto/选择/导出核同输入同域；合法门要求 finite/完整窗口/schema。
 */

export const PORTFOLIO_VERSION = 'portfolio-dev-v1'
export const PORTFOLIO_SEED = 20261003
export const PORTFOLIO_STEP_MINUTES = 15
export const PORTFOLIO_PERIODS = 96
export const PORTFOLIO_CANONICAL_VERSION = 'portfolio-candidate-canonical-v1'
export const PORTFOLIO_GENERATOR_VERSION = 'portfolio-fixture-generator-v1'
export const PORTFOLIO_INPUT_SOURCE = 'synthetic-development'

export type PortfolioFixtureId =
  | 'p_capacity_rise'
  | 'p_oscillate'
  | 'p_standby_takeover'
  | 'p_over_capacity'

export interface PortfolioFixtureMeta {
  id: PortfolioFixtureId
  label: string
  description: string
}

export const PORTFOLIO_FIXTURES: PortfolioFixtureMeta[] = [
  { id: 'p_capacity_rise', label: 'P1｜容量内分段抬升', description: '常规低中负荷，短窗口抬升至 26–29 m³/min 后回落，≤32。' },
  { id: 'p_oscillate', label: 'P2｜容量内往复需求', description: '单机与两机需求间歇往复，≤32。' },
  { id: 'p_standby_takeover', label: 'P3｜AC-01 全窗口退出备用承接', description: 'AC-01 全窗口退出（非故障/非维修/未执行），需求 6–11.5 由 AC-02 承担。' },
  { id: 'p_over_capacity', label: 'P4｜明确超容量 32.5', description: '某段需求 32.5 > 安全可用 32，应无合法方案。' },
]

export type PortfolioStrategy =
  | 'milp_weighted'
  | 'lab_energy_first'
  | 'lab_switch_first'
  | 'conservative_rule'

export const PORTFOLIO_STRATEGIES: PortfolioStrategy[] = [
  'milp_weighted',
  'lab_energy_first',
  'lab_switch_first',
  'conservative_rule',
]

export type FeasibleDomain = 'flow-milp' | 'dp-lookahead' | 'conservative-rule'

function domainOf(strategy: PortfolioStrategy): FeasibleDomain {
  if (strategy === 'milp_weighted') return 'flow-milp'
  if (strategy === 'conservative_rule') return 'conservative-rule'
  return 'dp-lookahead'
}

function objectiveOf(strategy: PortfolioStrategy): string {
  return strategy === 'milp_weighted' ? FLOW_MILP_OBJECTIVE_VERSION : strategy
}

const EXCLUDED_AC01 =
  '本场景 AC-01 全窗口退出（备用机承接，非故障 / 非维修，未执行）。'

export interface PortfolioFixture {
  id: PortfolioFixtureId
  seed: number
  stepMinutes: number
  points: DemandPoint[]
  initial: InitialUnitState
  units: Unit[]
  evaluation: EvaluationResult
  faultUnitId: string | null
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function demandAt(id: PortfolioFixtureId, i: number): number {
  const wave = Math.sin((i / PORTFOLIO_PERIODS) * Math.PI * 2)
  if (id === 'p_capacity_rise') {
    if (i >= 40 && i <= 55) {
      const ramp = Math.sin(((i - 40) / 15) * Math.PI)
      return round1(Math.min(29, 26 + ramp * 3))
    }
    return round1(17 + 3 * wave)
  }
  if (id === 'p_oscillate') {
    const block = Math.floor(i / 8)
    const high = block % 2 === 1
    return round1((high ? 26 : 16) + (high ? 1 : -1) * (1 - Math.abs(1 - (i % 8) / 4)))
  }
  if (id === 'p_standby_takeover') {
    const t = i / (PORTFOLIO_PERIODS - 1)
    return round1(6 + 5.5 * (0.5 + 0.5 * Math.sin(t * Math.PI * 3)))
  }
  // p_over_capacity
  if (i >= 48 && i <= 63) return 32.5
  return round1(16 + 3 * wave)
}

export function buildPortfolioFixture(id: PortfolioFixtureId): PortfolioFixture {
  const points: DemandPoint[] = []
  for (let i = 0; i < PORTFOLIO_PERIODS; i += 1) {
    const minuteOfDay = i * PORTFOLIO_STEP_MINUTES
    points.push({
      index: i,
      minuteOfDay,
      label: `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(
        minuteOfDay % 60,
      ).padStart(2, '0')}`,
      demand: demandAt(id, i),
    })
  }
  const base = evaluateUnits(UNITS, 'normal')
  const excludeAc01 = id === 'p_standby_takeover'
  const eligibility: UnitEligibility[] = base.eligibility.map((e) =>
    excludeAc01 && e.unitId === 'AC-01' && e.eligible
      ? { ...e, eligible: false, reason: EXCLUDED_AC01 }
      : e,
  )
  const candidateIds = new Set(eligibility.filter((e) => e.eligible).map((e) => e.unitId))
  const candidates = base.candidates.filter((u) => candidateIds.has(u.id))
  const excludedNotes = eligibility
    .filter((e) => !e.eligible)
    .map((e) => `${e.unitId}:${e.reason}`)
  return {
    id,
    seed: PORTFOLIO_SEED,
    stepMinutes: PORTFOLIO_STEP_MINUTES,
    points,
    initial: {
      runningUnitIds: ['AC-01'],
      minutesSinceChange: { 'AC-01': 30, 'AC-02': 30, 'AC-03': 30 },
    },
    units: UNITS,
    evaluation: { candidates, eligibility, excludedNotes },
    faultUnitId: null,
  }
}

/**
 * 生成时捕获的不可变输入快照（深复制）。后续一切身份/合法/选择/导出均以本快照为准，
 * 不借当前 buildPortfolioFixture() 替换，避免“当前 fixture 覆盖历史候选”的错配。
 */
export interface PortfolioInputSnapshot {
  canonicalVersion: string
  source: string
  generator: string
  id: PortfolioFixtureId
  seed: number
  stepMinutes: number
  periods: number
  points: DemandPoint[]
  units: Unit[]
  eligibility: UnitEligibility[]
  candidates: Unit[]
  excludedNotes: string[]
  initial: InitialUnitState
  faultUnitId: string | null
}

export function deepClone<T>(value: T): T {
  const sc = (globalThis as { structuredClone?: <U>(v: U) => U }).structuredClone
  if (typeof sc === 'function') return sc(value)
  return JSON.parse(JSON.stringify(value)) as T
}

/** 生成时深复制捕获完整输入快照。 */
export function capturePortfolioSnapshot(fixture: PortfolioFixture): PortfolioInputSnapshot {
  return {
    canonicalVersion: PORTFOLIO_CANONICAL_VERSION,
    source: PORTFOLIO_INPUT_SOURCE,
    generator: PORTFOLIO_GENERATOR_VERSION,
    id: fixture.id,
    seed: fixture.seed,
    stepMinutes: fixture.stepMinutes,
    periods: fixture.points.length,
    points: deepClone(fixture.points),
    units: deepClone(fixture.units),
    eligibility: deepClone(fixture.evaluation.eligibility),
    candidates: deepClone(fixture.evaluation.candidates),
    excludedNotes: [...fixture.evaluation.excludedNotes],
    initial: deepClone(fixture.initial),
    faultUnitId: fixture.faultUnitId,
  }
}

/** 由快照重建 fixture（共享已深复制数组，不再克隆）。 */
export function snapshotToFixture(s: PortfolioInputSnapshot): PortfolioFixture {
  return {
    id: s.id,
    seed: s.seed,
    stepMinutes: s.stepMinutes,
    points: s.points,
    units: s.units,
    evaluation: { candidates: s.candidates, eligibility: s.eligibility, excludedNotes: s.excludedNotes },
    initial: s.initial,
    faultUnitId: s.faultUnitId,
  }
}

/** 旧式可读数字（允许 NaN/±Infinity 文本），仅用于展示标签，不用于权威绑定。 */
function num(v: number): string {
  if (Number.isNaN(v)) return 'NaN'
  if (v === Infinity) return 'Infinity'
  if (v === -Infinity) return '-Infinity'
  return Object.is(v, -0) ? '0' : String(v)
}

/** 权威精确数字：拒绝非有限值。 */
function exact(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`non-finite:${String(v)}`)
  return Object.is(v, -0) ? '0' : String(v)
}

export interface CanonicalIdentity {
  ok: boolean
  id: string
  reason: string | null
}

/**
 * 权威输入身份：有限原值、全部原始 index/minute/demand、机组/资格/初态/故障/来源/generator/规则/verifier。
 * 严格拒绝：缺桶/重复/错序/非有限。规范排序，不舍入。
 */
export function canonicalPortfolioInput(fixture: PortfolioFixture): CanonicalIdentity {
  try {
    if (fixture.stepMinutes !== PORTFOLIO_STEP_MINUTES)
      throw new Error(`step:${fixture.stepMinutes}!=${PORTFOLIO_STEP_MINUTES}`)
    if (fixture.points.length !== PORTFOLIO_PERIODS)
      throw new Error(`count:${fixture.points.length}!=${PORTFOLIO_PERIODS}`)
    const seen = new Set<number>()
    for (let i = 0; i < fixture.points.length; i += 1) {
      const p = fixture.points[i]
      if (p.index !== i) throw new Error(`point-index-order:${i}:${p.index}`)
      if (p.minuteOfDay !== i * fixture.stepMinutes)
        throw new Error(`point-minute:${i}:${p.minuteOfDay}`)
      if (seen.has(p.index)) throw new Error(`point-dup:${p.index}`)
      seen.add(p.index)
      exact(p.demand)
    }
    const last = fixture.points[fixture.points.length - 1]
    if (last.minuteOfDay !== (PORTFOLIO_PERIODS - 1) * PORTFOLIO_STEP_MINUTES)
      throw new Error(`last-minute:${last.minuteOfDay}`)
    const knownUnits = new Set<string>()
    for (const u of fixture.units) {
      if (knownUnits.has(u.id)) throw new Error(`unit-dup:${u.id}`)
      knownUnits.add(u.id)
      exact(u.ratedCapacity)
      exact(u.minLoadRatio)
      exact(u.ratedPower)
      exact(u.unloadPowerRatio)
      if (!Number.isFinite(u.minStartStopInterval)) throw new Error(`unit-interval:${u.id}`)
    }
    const seenElig = new Set<string>()
    for (const e of fixture.evaluation.eligibility) {
      if (seenElig.has(e.unitId)) throw new Error(`elig-dup:${e.unitId}`)
      seenElig.add(e.unitId)
      if (!knownUnits.has(e.unitId)) throw new Error(`elig-unknown:${e.unitId}`)
    }
    const points = fixture.points
      .map((p) => `${p.index}#${p.minuteOfDay}#${exact(p.demand)}`)
      .join(';')
    const units = fixture.units
      .map(
        (u) =>
          `${u.id}:${u.kind}:${exact(u.ratedCapacity)}:${exact(u.minLoadRatio)}:${exact(
            u.ratedPower,
          )}:${exact(u.unloadPowerRatio)}:${exact(u.minStartStopInterval)}:${
            u.surgeBoundaryVerified ? 1 : 0
          }`,
      )
      .join(';')
    const elig = fixture.evaluation.eligibility
      .map((e) => `${e.unitId}:${e.eligible ? 1 : 0}:${e.reason ?? ''}`)
      .join(';')
    const init = `run=${[...fixture.initial.runningUnitIds].sort().join(',')};age=${Object.keys(
      fixture.initial.minutesSinceChange,
    )
      .sort()
      .map((k) => `${k}=${exact(fixture.initial.minutesSinceChange[k])}`)
      .join(',')}`
    const id = [
      PORTFOLIO_CANONICAL_VERSION,
      `generator=${PORTFOLIO_GENERATOR_VERSION}`,
      `source=${PORTFOLIO_INPUT_SOURCE}`,
      `fixture=${fixture.id}`,
      `seed=${exact(fixture.seed)}`,
      `step=${exact(fixture.stepMinutes)}`,
      `count=${fixture.points.length}`,
      `rule=${RULE_VERSION}`,
      `verifier=${VERIFIER_VERSION}`,
      `fault=${fixture.faultUnitId ?? 'none'}`,
      `initial=${init}`,
      `points=${points}`,
      `units=${units}`,
      `eligibility=${elig}`,
    ].join('|')
    return { ok: true, id, reason: null }
  } catch (e) {
    return { ok: false, id: '', reason: (e as Error).message }
  }
}

/** 兼容旧调用的输入身份（非权威）；无有效输入时返回空串。 */
export function computePortfolioInputIdentity(fixture: PortfolioFixture): string {
  return canonicalPortfolioInput(fixture).id
}

/**
 * 权威计划身份：完整窗口、顺序对齐、有限原值、运行集合与负载/供气完整。
 * 拒绝：缺桶/重复/错序/未知机组/重复运行 ID/缺失或多余负载键/非有限。
 */
function canonicalPlanSegment(plan: PlanResult | null, fixture: PortfolioFixture): string {
  if (!plan) return 'plan=NONE'
  if (!plan.feasible) return `plan=INFEASIBLE:${plan.infeasibleReasons.join('+')}`
  if (plan.periods.length !== fixture.points.length)
    throw new Error(`plan-window:${plan.periods.length}/${fixture.points.length}`)
  const known = new Set(fixture.units.map((u) => u.id))
  const segs = plan.periods.map((p, i) => {
    if (p.index !== i) throw new Error(`plan-index-order:${i}:${p.index}`)
    if (p.minuteOfDay !== i * fixture.stepMinutes)
      throw new Error(`plan-minute:${i}:${p.minuteOfDay}`)
    exact(p.demand)
    const ids = [...p.runningUnitIds]
    if (new Set(ids).size !== ids.length) throw new Error(`plan-dup-unit:${i}`)
    for (const id of ids) if (!known.has(id)) throw new Error(`plan-unknown-unit:${i}:${id}`)
    const sorted = [...ids].sort()
    for (const id of sorted) {
      const load = p.unitLoads[id]
      if (load === undefined) throw new Error(`plan-missing-load:${i}:${id}`)
      exact(load)
    }
    const extra = Object.keys(p.unitLoads).filter((k) => !ids.includes(k))
    if (extra.length) throw new Error(`plan-load-key:${i}:${extra.join('+')}`)
    exact(p.supply)
    exact(p.powerKw)
    exact(p.energyKwh)
    if (!Number.isFinite(p.switches)) throw new Error(`plan-switches:${i}`)
    const loads = sorted.map((id) => `${id}=${exact(p.unitLoads[id])}`).join(',')
    return `${p.index}#${p.minuteOfDay}#${exact(p.demand)}#${sorted.join('+')}#${loads}#${exact(
      p.supply,
    )}#${exact(p.powerKw)}#${exact(p.energyKwh)}#${p.switches}`
  })
  exact(plan.totalEnergyKwh)
  exact(plan.totalSwitches)
  return `plan=F|${plan.periods.length}|${segs.join(';')}`
}

export interface CandidateCanonical extends CanonicalIdentity {
  inputIdentity: string
}

/** 权威候选身份：input canonical || strategy/objective/domain/model || 完整计划 segment。 */
export function canonicalCandidate(
  fixture: PortfolioFixture,
  strategy: PortfolioStrategy,
  plan: PlanResult | null,
): CandidateCanonical {
  const input = canonicalPortfolioInput(fixture)
  if (!input.ok) {
    return { ok: false, id: '', reason: `input:${input.reason}`, inputIdentity: '' }
  }
  try {
    const id = [
      input.id,
      `strategy=${strategy}`,
      `objective=${objectiveOf(strategy)}`,
      `domain=${domainOf(strategy)}`,
      `model=${strategy === 'milp_weighted' ? FLOW_MILP_MODEL_VERSION : 'n/a'}`,
      canonicalPlanSegment(plan, fixture),
    ].join('||')
    return { ok: true, id, reason: null, inputIdentity: input.id }
  } catch (e) {
    return {
      ok: false,
      id: '',
      reason: `plan:${(e as Error).message}`,
      inputIdentity: input.id,
    }
  }
}

/** FNV-1a 32 位短哈希，仅用于展示键；权威绑定使用 canonicalId。 */
export function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `pc-${(h >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * 兼容旧调用的候选短 ID（仅展示）。不做四舍五入；无 fixture 校验能力时以精确计划文本参与。
 * 权威绑定请使用 canonicalCandidate().id。
 */
export function computeCandidateIdentity(
  inputIdentity: string,
  strategy: PortfolioStrategy,
  plan: PlanResult | null,
): string {
  let planText = 'plan=NONE'
  if (plan) {
    planText = plan.periods
      .map((p) => {
        const ids = [...p.runningUnitIds].sort()
        const loads = ids.map((id) => `${id}=${num(p.unitLoads[id] ?? 0)}`).join(',')
        return `${p.index}#${num(p.demand)}#${ids.join('+')}#${loads}#${num(p.supply)}`
      })
      .join(';')
  }
  return [
    inputIdentity,
    `strategy=${strategy}`,
    `objective=${objectiveOf(strategy)}`,
    `domain=${domainOf(strategy)}`,
    planText,
  ].join('||')
}

export interface PortfolioMetrics {
  energyKwh: number | null
  switches: number | null
  excessSupplyM3: number | null
}

export interface PortfolioCandidate {
  /** 短展示键（非权威，只用于展示/React key；不用于授权或精确匹配）。 */
  candidateId: string
  /** 权威完整 canonical 身份。 */
  canonicalId: string
  canonicalOk: boolean
  canonicalReason: string | null
  /** 权威输入身份（生成时绑定）。 */
  inputIdentity: string
  /** 生成时捕获的不可变输入快照（权威复算来源）。 */
  inputSnapshot: PortfolioInputSnapshot
  /** 生成批次（与异步代次一致）。 */
  batchId: number
  strategy: PortfolioStrategy
  objectiveVersion: string
  domain: FeasibleDomain
  plan: PlanResult | null
  verified: boolean
  metricsOk: boolean
  metrics: PortfolioMetrics
  status: string
  reasons: string[]
  diagnostics: FlowMilpDiagnostics | null
}

function verifyContext(fixture: PortfolioFixture): VerifyContext {
  return {
    series: {
      seed: fixture.seed,
      scenario: 'normal',
      scenarioLabel: fixture.id,
      synthetic: true,
      stepMinutes: fixture.stepMinutes,
      points: fixture.points,
      note: PORTFOLIO_VERSION,
    },
    allUnits: fixture.units,
    evaluation: fixture.evaluation,
    initial: fixture.initial,
    faultUnitId: fixture.faultUnitId,
  }
}

function verifyContextFromSnapshot(s: PortfolioInputSnapshot): VerifyContext {
  return verifyContext(snapshotToFixture(s))
}

const METRIC_EPS = 1e-9

/**
 * 把“非候选但初始已开”的强制停机翻转计入计划声明（首桶），与独立指标核对的全机组口径一致。
 * 不改动实际投运/负载，只修正翻转声明；锁定未满时由调用方判定无解。
 */
function withForcedStopFlips(plan: PlanResult, fixture: PortfolioFixture): PlanResult {
  const byId = new Map(fixture.units.map((u) => [u.id, u]))
  let prev = new Set(fixture.initial.runningUnitIds.filter((id) => byId.has(id)))
  let totalEnergyUnrounded = 0
  const periods = plan.periods.map((p) => {
    let power = 0
    for (const id of p.runningUnitIds) {
      const unit = byId.get(id)
      const load = p.unitLoads[id]
      if (unit && typeof load === 'number' && Number.isFinite(load)) {
        power += unitPower(unit, load)
      }
    }
    const energy = power * (fixture.stepMinutes / 60)
    totalEnergyUnrounded += energy
    const cur = new Set(p.runningUnitIds)
    let switches = 0
    for (const u of fixture.units) if (prev.has(u.id) !== cur.has(u.id)) switches += 1
    prev = cur
    return { ...p, powerKw: round2(power), energyKwh: round2(energy), switches }
  })
  return {
    ...plan,
    periods,
    totalEnergyKwh: round2(totalEnergyUnrounded),
    totalSwitches: periods.reduce((s, p) => s + p.switches, 0),
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function metricsOf(plan: PlanResult, fixture: PortfolioFixture) {
  return verifyLabPlanMetrics(plan, fixture.units, fixture.initial, fixture.stepMinutes)
}

function finiteMetrics(m: PortfolioMetrics): boolean {
  return (
    Number.isFinite(m.energyKwh) &&
    Number.isFinite(m.switches) &&
    Number.isFinite(m.excessSupplyM3) &&
    (m.switches as number) >= 0 &&
    Number.isInteger(m.switches)
  )
}

/** 由快照 + MILP 结果构造候选（浏览器 Worker 与 Node 直调共用）。 */
export function portfolioMilpCandidate(
  snapshot: PortfolioInputSnapshot,
  r: FlowMilpResult,
  batchId = 0,
): PortfolioCandidate {
  const fixture = snapshotToFixture(snapshot)
  const strategy: PortfolioStrategy = 'milp_weighted'
  const canonical = canonicalCandidate(fixture, strategy, r.plan)
  const legal = Boolean(r.plan && r.verified && r.metricsOk && canonical.ok)
  const reasons = [...r.reasons]
  if (r.plan && !canonical.ok) reasons.push(`身份复验未通过：${canonical.reason}`)
  return {
    candidateId: shortHash(canonical.ok ? canonical.id : `${canonical.inputIdentity}|milp|invalid`),
    canonicalId: canonical.id,
    canonicalOk: canonical.ok,
    canonicalReason: canonical.reason,
    inputIdentity: canonical.inputIdentity,
    inputSnapshot: snapshot,
    batchId,
    strategy,
    objectiveVersion: objectiveOf(strategy),
    domain: domainOf(strategy),
    plan: legal ? r.plan : null,
    verified: r.verified,
    metricsOk: r.metricsOk,
    metrics: legal ? r.metrics : { energyKwh: null, switches: null, excessSupplyM3: null },
    status: r.diagnostics.state,
    reasons,
    diagnostics: r.diagnostics,
  }
}

/** 单候选求解 + 双门独立复验。失败/超时/身份无效保留原因，不涂绿。快照生成时捕获。 */
export async function runPortfolioCandidate(
  fixture: PortfolioFixture,
  strategy: PortfolioStrategy,
  batchId = 0,
): Promise<PortfolioCandidate> {
  const snapshot = capturePortfolioSnapshot(fixture)
  const snap = snapshotToFixture(snapshot)
  const context = verifyContext(snap)
  const base = {
    strategy,
    domain: domainOf(strategy),
    objectiveVersion: objectiveOf(strategy),
    inputSnapshot: snapshot,
    batchId,
  }

  if (strategy === 'milp_weighted') {
    const r = await solveFlowMilp({
      fixtureId: snap.id,
      seed: snap.seed,
      points: snap.points,
      stepMinutes: snap.stepMinutes,
      units: snap.units,
      candidates: snap.evaluation.candidates,
      eligibility: snap.evaluation.eligibility,
      initial: snap.initial,
      faultUnitId: snap.faultUnitId,
      timeLimitSeconds: 5,
    })
    return portfolioMilpCandidate(snapshot, r, batchId)
  }

  let plan: PlanResult | null = null
  let status = 'infeasible'
  if (strategy === 'conservative_rule') {
    const conservative = planConservativeBaseline(
      context.series,
      snap.evaluation.candidates,
      snap.units,
      snap.evaluation.excludedNotes,
      snap.initial,
    )
    // 旧公开函数只统计候选内翻转；非候选但初始已开的强制停机须计入全部翻转口径。
    plan = conservative.feasible ? withForcedStopFlips(conservative, snap) : conservative
    status = plan.feasible ? 'planned' : 'infeasible'
  } else {
    const pref = strategy === 'lab_energy_first' ? 'energy_first' : 'switch_first'
    const solved = solveLabPreference({
      series: context.series,
      candidates: snap.evaluation.candidates,
      allUnits: snap.units,
      initial: snap.initial,
      preference: pref,
      context,
    })
    plan = solved.plan
    status = solved.status
  }
  const verified = plan ? verifyPlanConstraints(plan, context).passed : false
  const metric = plan ? metricsOf(plan, snap) : null
  const metricsOk = metric?.ok ?? false
  const canonical = canonicalCandidate(snap, strategy, plan)
  const legal = Boolean(plan && verified && metricsOk && canonical.ok)
  const reasons: string[] = []
  if (!plan) reasons.push(`无方案（${status}）`)
  else if (!verified) reasons.push('独立硬约束复验未通过')
  else if (!metricsOk) reasons.push('独立指标核对未通过')
  if (plan && !canonical.ok) reasons.push(`身份复验未通过：${canonical.reason}`)
  return {
    ...base,
    candidateId: shortHash(
      canonical.ok ? canonical.id : `${canonical.inputIdentity}|${strategy}|invalid`,
    ),
    canonicalId: canonical.id,
    canonicalOk: canonical.ok,
    canonicalReason: canonical.reason,
    inputIdentity: canonical.inputIdentity,
    plan: legal ? plan : null,
    verified,
    metricsOk,
    metrics: {
      energyKwh: legal ? (metric?.recomputed.totalEnergyKwh ?? null) : null,
      switches: legal ? (metric?.recomputed.totalSwitches ?? null) : null,
      excessSupplyM3: legal ? (metric?.recomputed.excessSupplyM3 ?? null) : null,
    },
    status,
    reasons,
    diagnostics: null,
  }
}

export interface CandidateVerdict {
  ok: boolean
  reasons: string[]
}

/**
 * 权威合法复算：不信任候选自带的 canonicalOk/verified/metricsOk/指标，一律用生成时快照
 * 重新生成完整 canonical、调用现有独立 constraints/metrics 复算，并对原计划、总/逐桶声明
 * 与三指标逐项核对。篡改/缺桶/不同策略 objective/domain/不同输入/资格不一致均拒绝并保留原因。
 */
export function verifyCandidate(c: PortfolioCandidate): CandidateVerdict {
  const reasons: string[] = []
  const s = c.inputSnapshot
  if (!s) return { ok: false, reasons: ['missing-input-snapshot'] }
  const fixture = snapshotToFixture(s)

  if (s.canonicalVersion !== PORTFOLIO_CANONICAL_VERSION)
    reasons.push(`snapshot-version:${s.canonicalVersion}`)
  if (s.source !== PORTFOLIO_INPUT_SOURCE) reasons.push(`snapshot-source:${s.source}`)
  if (s.generator !== PORTFOLIO_GENERATOR_VERSION) reasons.push(`snapshot-generator:${s.generator}`)

  const input = canonicalPortfolioInput(fixture)
  if (!input.ok) reasons.push(`snapshot-input:${input.reason}`)
  else if (input.id !== c.inputIdentity) reasons.push('input-identity-mismatch')

  if (objectiveOf(c.strategy) !== c.objectiveVersion)
    reasons.push(`objective-mismatch:${c.objectiveVersion}`)
  if (domainOf(c.strategy) !== c.domain) reasons.push(`domain-mismatch:${c.domain}`)

  if (!c.plan) {
    reasons.push('no-plan')
    return { ok: false, reasons }
  }

  const canonical = canonicalCandidate(fixture, c.strategy, c.plan)
  if (!canonical.ok) {
    reasons.push(`plan-canonical:${canonical.reason}`)
  } else {
    if (canonical.id !== c.canonicalId) reasons.push('canonical-id-mismatch')
    if (canonical.inputIdentity !== c.inputIdentity) reasons.push('canonical-input-mismatch')
  }

  const context = verifyContextFromSnapshot(s)
  const vc = verifyPlanConstraints(c.plan, context)
  if (!vc.passed) reasons.push('constraints-failed')
  if (c.verified !== vc.passed) reasons.push('verified-flag-mismatch')

  const metric = verifyLabPlanMetrics(c.plan, s.units, s.initial, s.stepMinutes)
  if (!metric.ok) reasons.push('metrics-recompute-failed')
  if (c.metricsOk !== metric.ok) reasons.push('metrics-flag-mismatch')

  if (!finiteMetrics(c.metrics)) {
    reasons.push('metrics-non-finite')
  } else {
    if (Math.abs((c.metrics.energyKwh as number) - metric.recomputed.totalEnergyKwh) > METRIC_EPS)
      reasons.push('metrics-energy-mismatch')
    if (c.metrics.switches !== metric.recomputed.totalSwitches)
      reasons.push('metrics-switches-mismatch')
    if (
      Math.abs((c.metrics.excessSupplyM3 as number) - metric.recomputed.excessSupplyM3) > METRIC_EPS
    )
      reasons.push('metrics-excess-mismatch')
  }

  if (c.batchId !== undefined && !Number.isFinite(c.batchId)) reasons.push('batch-invalid')

  return { ok: reasons.length === 0, reasons }
}

export function isLegalCandidate(c: PortfolioCandidate): boolean {
  return verifyCandidate(c).ok
}

export const PARETO_TOLERANCE = 1e-6

export interface ParetoGroup {
  inputIdentity: string
  domain: FeasibleDomain
  frontiers: PortfolioCandidate[]
  dominated: Array<{ candidateId: string; dominatedBy: string }>
  equivalents: Array<{ candidateId: string; equivalentTo: string }>
}

export interface ParetoRejection {
  candidateId: string
  strategy: PortfolioStrategy
  inputIdentity: string
  reason: string
}

export interface ParetoAudit {
  inputIdentity: string
  groups: ParetoGroup[]
  rejected: ParetoRejection[]
}

function dominates(a: PortfolioMetrics, b: PortfolioMetrics): boolean {
  const ax = [a.energyKwh!, a.switches!, a.excessSupplyM3!]
  const bx = [b.energyKwh!, b.switches!, b.excessSupplyM3!]
  let strictlyLess = false
  for (let i = 0; i < 3; i += 1) {
    if (ax[i] > bx[i] + PARETO_TOLERANCE) return false
    if (ax[i] < bx[i] - PARETO_TOLERANCE) strictlyLess = true
  }
  return strictlyLess
}

function equiv(a: PortfolioMetrics, b: PortfolioMetrics): boolean {
  return (
    Math.abs(a.energyKwh! - b.energyKwh!) <= PARETO_TOLERANCE &&
    a.switches === b.switches &&
    Math.abs(a.excessSupplyM3! - b.excessSupplyM3!) <= PARETO_TOLERANCE
  )
}

/**
 * 仅在同 inputIdentity、同可行域、双门通过的合法候选集内计算 Pareto/等价。
 * 混合输入/非法候选保留在 rejected（含原因），不进入集合，也不静默删行。
 */
export function computeParetoAudited(
  currentInputIdentity: string,
  candidates: PortfolioCandidate[],
): ParetoAudit {
  const rejected: ParetoRejection[] = []
  const legal: PortfolioCandidate[] = []
  for (const c of candidates) {
    const verdict = verifyCandidate(c)
    if (!verdict.ok) {
      rejected.push({
        candidateId: c.candidateId,
        strategy: c.strategy,
        inputIdentity: c.inputIdentity,
        reason: `illegal:${verdict.reasons.join(';') || c.status}`,
      })
      continue
    }
    if (c.inputIdentity !== currentInputIdentity) {
      rejected.push({
        candidateId: c.candidateId,
        strategy: c.strategy,
        inputIdentity: c.inputIdentity,
        reason: 'input_mismatch',
      })
      continue
    }
    legal.push(c)
  }
  const byDomain = new Map<FeasibleDomain, PortfolioCandidate[]>()
  for (const c of legal) {
    const list = byDomain.get(c.domain) ?? []
    list.push(c)
    byDomain.set(c.domain, list)
  }
  const groups: ParetoGroup[] = []
  for (const [domain, list] of byDomain) {
    const frontiers: PortfolioCandidate[] = []
    const dominated: Array<{ candidateId: string; dominatedBy: string }> = []
    const equivalents: Array<{ candidateId: string; equivalentTo: string }> = []
    for (const c of list) {
      const dominator = list.find(
        (o) => o.candidateId !== c.candidateId && dominates(o.metrics, c.metrics),
      )
      if (dominator) {
        dominated.push({ candidateId: c.candidateId, dominatedBy: dominator.candidateId })
        continue
      }
      const eq = frontiers.find((f) => equiv(f.metrics, c.metrics))
      if (eq) {
        equivalents.push({ candidateId: c.candidateId, equivalentTo: eq.candidateId })
      } else {
        frontiers.push(c)
      }
    }
    groups.push({ inputIdentity: currentInputIdentity, domain, frontiers, dominated, equivalents })
  }
  return { inputIdentity: currentInputIdentity, groups, rejected }
}

/** 兼容旧调用：仅返回分组。 */
export function computePareto(
  inputIdentity: string,
  candidates: PortfolioCandidate[],
): ParetoGroup[] {
  return computeParetoAudited(inputIdentity, candidates).groups
}

export interface PortfolioHistoryEntry {
  candidate: PortfolioCandidate
  batchId: number
  reason: string
}

/** 取消/换输入/离页：当前批次活动结果退休为只读历史（不可再选为当前）。 */
export function retireBatch(
  active: PortfolioCandidate[],
  batchId: number,
  reason = 'canceled',
): PortfolioHistoryEntry[] {
  return active.map((candidate) => ({ candidate, batchId, reason }))
}

/**
 * 选择权威门：必须属于当前活动批次、当前输入，且通过完整复算。
 * 短 candidateId 只作展示键，不作授权/精确匹配依据。
 */
export function canSelectCandidate(
  active: PortfolioCandidate[],
  candidate: PortfolioCandidate | null,
  currentInputIdentity: string,
  currentBatchId: number,
): CandidateVerdict {
  const reasons: string[] = []
  if (!candidate) return { ok: false, reasons: ['no-selection'] }
  if (!active.includes(candidate)) reasons.push('not-in-active-batch')
  if (candidate.batchId !== currentBatchId) reasons.push('batch-mismatch')
  if (candidate.inputIdentity !== currentInputIdentity) reasons.push('input-mismatch')
  const verdict = verifyCandidate(candidate)
  if (!verdict.ok) reasons.push(...verdict.reasons)
  return { ok: reasons.length === 0, reasons }
}

/**
 * 异步代次守卫（纯函数）：取消/换输入/离页时 retire，迟到回调以 isCurrent 判定后丢弃。
 */
export interface GenerationGate {
  current(): number
  retire(): number
  isCurrent(epoch: number): boolean
}

export function createGenerationGate(): GenerationGate {
  let value = 0
  return {
    current: () => value,
    retire: () => {
      value += 1
      return value
    },
    isCurrent: (epoch: number) => epoch === value,
  }
}
