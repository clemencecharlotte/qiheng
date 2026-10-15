import { unitPower } from './engine'
import { verifyPlanConstraints, VERIFIER_VERSION, type VerifyContext } from './constraints'
import { verifyLabPlanMetrics } from './lab'
import { RULE_VERSION } from './audit'
import { canonicalPortfolioInput, shortHash, snapshotToFixture } from './portfolio'
import type { PortfolioInputSnapshot } from './portfolio'
import {
  EXECUTION_STORE_KEY,
  EXECUTION_VERSION,
  bindingEquals,
  executionController,
  loadExecutionStore as loadExecutionStoreRaw,
  protectedEqual,
  retireExecution,
  type ExecutionBinding,
  type ExecutionEnvelope,
  type ExecutionLedgerEntry,
  type StorageLike,
} from './execution'
import {
  solveFlowMilp,
  FLOW_MILP_MODEL_VERSION,
  FLOW_MILP_OBJECTIVE_VERSION,
  type FlowMilpInput,
  type FlowMilpResult,
} from './optimizer/flowMilp'
import type { InitialUnitState, PlanResult, UnitEligibility } from './types'

/**
 * B04b suffix 重规划（候选 4174，隔离）。
 * 故障→退休→prefix 重放→suffix→新复验/新人审/新 Start。仅合成模拟；不接 PLC/账号/外部 DSH。
 */

export const REPLAN_ENVELOPE_VERSION = 1
export const REPLAN_SCHEMA = 'qiheng-replan-envelope-v1'
export const REPLAN_STORE_KEY = 'qiheng.replan.store.v1'
export const REPLAN_VERSION = 'replan-b04b-v1'
export const REPLAN_CAPACITY_BYTES = 6_000_000
export const REPLAN_TOLERANCE = 1e-6

export type SuffixState =
  | 'pending' | 'ok' | 'infeasible' | 'timeout' | 'no_primal' | 'invalid' | 'worker_error' | 'canceled' | 'no_remaining'

export interface Incident {
  incidentId: string
  executionId: string
  executionEpoch: number
  revision: number
  atIndex: number
  reason: string
  faultSet: string[]
  capturedAt: string
  identity: string
}

export interface PrefixReplay {
  ok: boolean
  reason: string | null
  cursor: number
  windowStartIndex: number
  endMinute: number
  nextMinute: number | null
  cumulativeEnergyKwh: number
  runningUnitIds: string[]
  lastChange: Record<string, number>
  initial: InitialUnitState | null
}

export interface SuffixRequest {
  requestId: string
  epoch: number
  parentPassportId: string
  parentCandidateId: string
  parentExecutionId: string
  parentVerificationId: string
  parentRevision: number
  businessKey: string
  cursor: number
  faultSet: string[]
  ruleVersion: string
  verifierVersion: string
  inputCanonical: string
  capturedAt: string
}

export interface SuffixAttempt {
  requestId: string
  state: SuffixState
  nativeState: string | null
  reasons: string[]
  result: FlowMilpResult | null
  timedOut: boolean
  cancelled: boolean
  error: string | null
}

export interface SuffixLedgerRow {
  index: number
  originalIndex: number
  minuteOfDay: number
  demand: number
  supply: number
  powerKw: number
  energyKwh: number
  cumulativeEnergyKwh: number
  runningUnitIds: string[]
  unitLoads: Record<string, number>
  segmentExecutionId: string
  verificationId: string
  decisionId: string
  auditId: string
  variantId: string
  receiptHash: string
}

export interface SuffixBinding {
  segmentExecutionId: string
  verificationId: string
  decisionId: string
  auditId: string
  variantId: string
}

export interface SuffixExecutionRecord {
  suffixId: string
  schema: typeof REPLAN_SCHEMA
  envelopeVersion: number
  parentPassportId: string
  parentCandidateId: string
  parentExecutionId: string
  parentRevision: number
  parentVerificationId: string
  requestId: string
  variantId: string
  verificationId: string
  binding: SuffixBinding
  faultSet: string[]
  windowStartIndex: number
  cursor: number
  plan: PlanResult
  /** 原 parent 证据（输入/计划/已提交 prefix/强身份/规则版本），用于独立复算。 */
  parentEvidence: {
    snapshot: PortfolioInputSnapshot
    plan: PlanResult
    ledgerPrefix: ExecutionLedgerEntry[]
    executionId: string
    verificationId: string
    passportId: string
    candidateId: string
    canonicalId: string
    businessKey: string
    ruleVersion: string
    verifierVersion: string
  }
  /** 原请求/真实 epoch/canonical/复验回执。 */
  attemptRecord: {
    requestId: string
    state: SuffixState
    canonical: string
    epoch: number
    nativeState: string | null
    hasSolution: boolean
    complete: boolean
    passed: boolean
    verifierVersion: string
    ruleVersion: string
    planNull: boolean
  }
  plannedRows: SuffixLedgerRow[]
  ledger: SuffixLedgerRow[]
  prefixCumulativeEnergyKwh: number
  cumulativeEnergyKwh: number
  status: 'verified' | 'approved' | 'rejected' | 'executing' | 'completed' | 'terminated'
  consumed: boolean
  decisionId: string | null
  auditId: string | null
  approvedBy: string | null
  approvedAt: string | null
  revision: number
  lineage: { parentExecutionId: string; prefixCursor: number; segmentCursor: number }
  dataQuality: { status: 'not_evaluated'; note: string }
}

function exact(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`non-finite:${String(v)}`)
  return Object.is(v, -0) ? '0' : String(v)
}

export function assertFiniteDeep(value: unknown, path = '$'): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path}=${String(value)}`
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const bad = assertFiniteDeep(value[i], `${path}[${i}]`)
      if (bad) return bad
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const bad = assertFiniteDeep(v, `${path}.${k}`)
      if (bad) return bad
    }
  }
  return null
}

// ---- Incident ----

export function captureIncident(
  envelope: ExecutionEnvelope,
  atIndex: number,
  reason: string,
  capturedAt: string,
  faultSet: string[] = [],
): Incident {
  return {
    incidentId: `qi-${shortHash(`${envelope.executionId}|${atIndex}|${reason}|${faultSet.join(',')}|${capturedAt}`)}`,
    executionId: envelope.executionId,
    executionEpoch: envelope.executionEpoch,
    revision: envelope.revision,
    atIndex,
    reason,
    faultSet: [...faultSet],
    capturedAt,
    identity: shortHash(
      JSON.stringify({
        passportId: envelope.binding.passportId,
        candidateId: envelope.binding.candidateId,
        inputCanonical: envelope.binding.inputCanonical,
        canonicalId: envelope.binding.canonicalId,
        verificationId: envelope.binding.verificationId,
      }),
    ),
  }
}

export function retireForIncident(
  envelope: ExecutionEnvelope,
  incident: Incident,
): { ok: boolean; envelope: ExecutionEnvelope | null; reason: string | null } {
  return retireExecution(envelope, `故障退休：${incident.reason} @index ${incident.atIndex}`)
}

// ---- prefix 重放：严格（cursor===ledger.length、有限、原 index、逐行积分、初态 age 完整）----

export function replayPrefix(
  snapshot: PortfolioInputSnapshot,
  plan: PlanResult,
  ledger: ExecutionLedgerEntry[],
  cursor: number,
  expectedBinding?: { executionId: string; verificationId: string },
): PrefixReplay {
  const bad = (reason: string): PrefixReplay => ({
    ok: false, reason, cursor, windowStartIndex: cursor, endMinute: 0, nextMinute: null,
    cumulativeEnergyKwh: 0, runningUnitIds: [], lastChange: {}, initial: null,
  })
  if (!Number.isInteger(cursor) || cursor < 0) return bad('cursor-invalid')
  if (cursor !== ledger.length) return bad(`cursor-not-equal-ledger:${cursor}/${ledger.length}`)
  if (cursor > plan.periods.length) return bad('cursor-out-of-range')
  if (!snapshot || !Array.isArray(snapshot.points) || snapshot.points.length !== 96) return bad('snapshot-window')
  if (!plan || !Array.isArray(plan.periods) || plan.periods.length !== 96) return bad('plan-window')
  const pts = snapshot.points
  const byId = new Map(snapshot.units.map((u) => [u.id, u]))
  // 初态 age 必须完整且有限（缺全部 minutesSinceChange 拒绝）
  const ages = snapshot.initial.minutesSinceChange
  if (!ages || Object.keys(ages).length === 0) return bad('initial-age-incomplete')
  // 所有可启停（合格）机组 + 初始运行机组都必须有完整、有限、非负 age；缺停机 age 拒绝，不补 0。
  const switchable = snapshot.eligibility.filter((e) => e.eligible).map((e) => e.unitId)
  const required = new Set<string>([...switchable, ...snapshot.initial.runningUnitIds])
  for (const id of required) {
    const age = ages[id]
    if (age === undefined || !Number.isFinite(age) || age < 0) return bad(`initial-age-missing:${id}`)
  }
  const lastChange: Record<string, number> = {}
  const firstMinute = pts[0].minuteOfDay
  for (const [id, age] of Object.entries(ages)) {
    if (!Number.isFinite(age)) return bad(`initial-age-nonfinite:${id}`)
    lastChange[id] = firstMinute - age
  }
  let prev = new Set(snapshot.initial.runningUnitIds)
  let cumulative = 0
  for (let i = 0; i < cursor; i += 1) {
    const row = ledger[i]
    const p = plan.periods[i]
    if (!row) return bad(`prefix-missing:${i}`)
    if (row.index !== i || row.index !== pts[i].index) return bad(`prefix-index:${i}`)
    if (row.minuteOfDay !== p.minuteOfDay || row.minuteOfDay !== pts[i].minuteOfDay) return bad(`prefix-minute:${i}`)
    if (expectedBinding && (row.executionId !== expectedBinding.executionId || row.verificationId !== expectedBinding.verificationId))
      return bad(`prefix-binding:${i}`)
    for (const n of [row.powerKw, row.energyKwh, row.cumulativeEnergyKwh, row.demand, row.supply]) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return bad(`prefix-nonfinite:${i}`)
    }
    const rs = [...row.runningUnitIds].sort().join(',')
    const ps = [...p.runningUnitIds].sort().join(',')
    if (rs !== ps) return bad(`prefix-running:${i}`)
    let power = 0
    for (const id of p.runningUnitIds) {
      const u = byId.get(id)
      const load = row.unitLoads?.[id]
      if (!u || typeof load !== 'number' || !Number.isFinite(load)) return bad(`prefix-load:${i}:${id}`)
      if (Math.abs(load - (p.unitLoads[id] ?? NaN)) > REPLAN_TOLERANCE) return bad(`prefix-load-value:${i}:${id}`)
      power += unitPower(u, load)
    }
    const energy = power * (snapshot.stepMinutes / 60)
    cumulative += energy
    if (Math.abs(row.powerKw - power) > REPLAN_TOLERANCE) return bad(`prefix-power:${i}`)
    if (Math.abs(row.energyKwh - energy) > REPLAN_TOLERANCE) return bad(`prefix-energy:${i}`)
    if (Math.abs(row.cumulativeEnergyKwh - cumulative) > REPLAN_TOLERANCE) return bad(`prefix-cumulative:${i}`)
    const cur = new Set(p.runningUnitIds)
    for (const u of snapshot.units) if (prev.has(u.id) !== cur.has(u.id)) lastChange[u.id] = p.minuteOfDay
    prev = cur
  }
  const endMinute = cursor > 0 ? pts[cursor - 1].minuteOfDay : firstMinute
  const nextMinute = cursor < pts.length ? pts[cursor].minuteOfDay : null
  const running = cursor > 0 ? [...plan.periods[cursor - 1].runningUnitIds] : [...snapshot.initial.runningUnitIds]
  const initial: InitialUnitState = {
    runningUnitIds: running,
    minutesSinceChange: Object.fromEntries(
      Object.entries(lastChange).map(([id, lc]) => [id, nextMinute === null ? 0 : nextMinute - lc]),
    ),
  }
  return { ok: true, reason: null, cursor, windowStartIndex: cursor, endMinute, nextMinute, cumulativeEnergyKwh: cumulative, runningUnitIds: running, lastChange, initial }
}

// ---- faultSet 资格 ----

export function applyFaultSet(eligibility: UnitEligibility[], faultSet: string[]): UnitEligibility[] {
  const faults = new Set(faultSet)
  return eligibility.map((e) =>
    faults.has(e.unitId) && e.eligible ? { ...e, eligible: false, reason: `故障（重规划）：${e.unitId}` } : e,
  )
}

export function buildSuffixInput(
  snapshot: PortfolioInputSnapshot,
  replay: PrefixReplay,
  faultSet: string[],
): { ok: boolean; reason: string | null; input: FlowMilpInput | null } {
  if (!replay.ok || !replay.initial) return { ok: false, reason: replay.reason ?? 'prefix-invalid', input: null }
  if (faultSet.length === 0) return { ok: false, reason: 'faultset-empty', input: null }
  const cursor = replay.cursor
  const points = snapshot.points.slice(cursor).map((p) => ({ ...p }))
  if (points.length === 0) return { ok: false, reason: 'no-remaining', input: null }
  if (points[0].index !== replay.windowStartIndex) return { ok: false, reason: 'window-start-mismatch', input: null }
  const eligibility = applyFaultSet(snapshot.eligibility, faultSet)
  const eligible = new Set(eligibility.filter((e) => e.eligible).map((e) => e.unitId))
  const candidates = snapshot.candidates.filter((u) => eligible.has(u.id) && u.id !== 'AC-03')
  return {
    ok: true, reason: null,
    input: {
      fixtureId: `${snapshot.id}:suffix@${cursor}`,
      seed: snapshot.seed, points, stepMinutes: snapshot.stepMinutes, units: snapshot.units,
      candidates, eligibility, initial: replay.initial,
      faultUnitId: faultSet.length === 1 ? faultSet[0] : null, timeLimitSeconds: 5,
    },
  }
}

function suffixSeries(snapshot: PortfolioInputSnapshot, replay: PrefixReplay) {
  return {
    seed: snapshot.seed, scenario: 'normal' as const, scenarioLabel: snapshot.id, synthetic: true as const,
    stepMinutes: snapshot.stepMinutes, points: snapshot.points.slice(replay.cursor).map((p) => ({ ...p })), note: REPLAN_VERSION,
  }
}

export function suffixCanonical(
  snapshot: PortfolioInputSnapshot,
  replay: PrefixReplay,
  faultSet: string[],
  epoch: number,
): string {
  const input = canonicalPortfolioInput(snapshotToFixture(snapshot)).id
  return [
    REPLAN_VERSION, input,
    `windowStart=${replay.windowStartIndex}`, `segmentCursor=${replay.cursor}`, `endMinute=${replay.endMinute}`,
    `prefixCumulative=${exact(replay.cumulativeEnergyKwh)}`,
    `running=${[...replay.runningUnitIds].sort().join(',')}`,
    `initial=${Object.keys(replay.initial?.minutesSinceChange ?? {}).sort().map((k) => `${k}=${exact(replay.initial!.minutesSinceChange[k])}`).join(',')}`,
    `faultSet=${[...faultSet].sort().join(',')}`,
    `rule=${RULE_VERSION}`, `verifier=${VERIFIER_VERSION}`, `model=${FLOW_MILP_MODEL_VERSION}`,
    `objective=${FLOW_MILP_OBJECTIVE_VERSION}`, `executionVersion=${EXECUTION_VERSION}`, `epoch=${exact(epoch)}`,
  ].join('|')
}

export function classifySuffixOutcome(
  workerState: 'ok' | 'worker_error' | 'watchdog_terminated' | 'canceled',
  result: FlowMilpResult | null,
  error: string | null,
): SuffixState {
  if (workerState === 'canceled') return 'canceled'
  if (workerState === 'watchdog_terminated') return 'timeout'
  if (workerState === 'worker_error') return 'worker_error'
  if (!result) return 'invalid'
  const d = result.diagnostics
  if (d.timedOut) return 'timeout'
  if (d.state === 'infeasible') return 'infeasible'
  if (d.state === 'canceled') return 'canceled'
  if (d.state === 'invalid' || d.state === 'loading_failure') return 'invalid'
  if (d.state === 'no_primal') return 'no_primal'
  if (d.state === 'time_limit_with_incumbent') return 'timeout'
  void error
  return 'ok'
}

export interface SuffixAttemptResult {
  ok: boolean
  attempt: SuffixAttempt | null
  reason: string | null
}

export async function runSuffixReplan(
  request: SuffixRequest,
  input: FlowMilpInput | null,
  solve: (input: FlowMilpInput, requestId: string) => Promise<{ workerState: 'ok' | 'worker_error' | 'watchdog_terminated' | 'canceled'; result: FlowMilpResult | null; error: string | null }>,
): Promise<SuffixAttemptResult> {
  if (!input) {
    return { ok: true, attempt: { requestId: request.requestId, state: 'no_remaining', nativeState: null, reasons: ['无剩余桶，不求解'], result: null, timedOut: false, cancelled: false, error: null }, reason: null }
  }
  const out = await solve(input, request.requestId)
  const state = classifySuffixOutcome(out.workerState, out.result, out.error)
  const attempt: SuffixAttempt = {
    requestId: request.requestId, state,
    nativeState: out.result?.diagnostics.state ?? null,
    reasons: out.result?.reasons ?? (out.error ? [out.error] : []),
    result: out.result,
    timedOut: out.result?.diagnostics.timedOut ?? out.workerState === 'watchdog_terminated',
    cancelled: out.workerState === 'canceled', error: out.error,
  }
  return { ok: true, attempt, reason: null }
}

// ---- suffix 计划行（未执行估计；严格复验）----

export interface SuffixPlanResult {
  ok: boolean
  reason: string | null
  rows: SuffixLedgerRow[]
  cursor: number
  cumulativeEnergyKwh: number
}

/** 从真实 suffix series/重放初态/完整 faultSet 资格独立复算计划行（含硬约束+指标复验）。 */
export function computePlanRows(
  snapshot: PortfolioInputSnapshot,
  replay: PrefixReplay,
  plan: PlanResult,
  faultSet: string[],
  binding: SuffixBinding,
): SuffixPlanResult {
  const bad = (reason: string): SuffixPlanResult => ({ ok: false, reason, rows: [], cursor: 0, cumulativeEnergyKwh: replay.cumulativeEnergyKwh })
  if (!replay.ok || !replay.initial) return bad(replay.reason ?? 'prefix-invalid')
  if (faultSet.length === 0) return bad('faultset-empty')
  if (!plan.feasible) return bad('plan-infeasible')
  const known = new Set(snapshot.units.map((u) => u.id))
  for (const f of faultSet) if (!known.has(f) || f === 'AC-03') return bad(`faultset-unknown:${f}`)
  const suffixPoints = snapshot.points.slice(replay.cursor)
  const expectedLen = suffixPoints.length
  if (plan.periods.length !== expectedLen) return bad(`segment-window:${plan.periods.length}/${expectedLen}`)
  const baseElig = applyFaultSet(snapshot.eligibility, faultSet)
  const byId = new Map(snapshot.units.map((u) => [u.id, u]))
  const eligible = new Set(baseElig.filter((e) => e.eligible).map((e) => e.unitId))
  const candidates = snapshot.candidates.filter((u) => eligible.has(u.id) && u.id !== 'AC-03')
  const context: VerifyContext = {
    series: suffixSeries(snapshot, replay),
    allUnits: snapshot.units,
    evaluation: { candidates, eligibility: baseElig, excludedNotes: snapshot.excludedNotes },
    initial: replay.initial,
    faultUnitId: faultSet.length === 1 ? faultSet[0] : null,
  }
  const cv = verifyPlanConstraints(plan, context)
  if (!cv.hasSolution || !cv.complete || !cv.passed)
    return bad(`constraints:${cv.complete ? 'incomplete' : 'no-solution'}:${cv.violations.slice(0, 3).map((v) => v.type).join(',')}`)
  const mv = verifyLabPlanMetrics(plan, snapshot.units, replay.initial, snapshot.stepMinutes)
  if (!mv.ok) return bad('metrics-mismatch')
  const rows: SuffixLedgerRow[] = []
  let cumulative = replay.cumulativeEnergyKwh
  for (let i = 0; i < plan.periods.length; i += 1) {
    const p = plan.periods[i]
    const originalIndex = replay.windowStartIndex + i
    if (originalIndex !== snapshot.points[replay.cursor + i].index) return bad(`original-index:${i}`)
    if (p.minuteOfDay !== suffixPoints[i].minuteOfDay || p.demand !== suffixPoints[i].demand) return bad(`original-demand:${i}`)
    let power = 0
    for (const id of p.runningUnitIds) {
      const u = byId.get(id)
      const load = p.unitLoads[id]
      if (!u || typeof load !== 'number' || !Number.isFinite(load)) return bad(`load:${i}`)
      power += unitPower(u, load)
    }
    const energy = power * (snapshot.stepMinutes / 60)
    cumulative += energy
    rows.push({
      index: i, originalIndex, minuteOfDay: p.minuteOfDay, demand: p.demand, supply: p.supply,
      powerKw: power, energyKwh: energy, cumulativeEnergyKwh: cumulative,
      runningUnitIds: [...p.runningUnitIds], unitLoads: { ...p.unitLoads },
      segmentExecutionId: binding.segmentExecutionId, verificationId: binding.verificationId,
      decisionId: binding.decisionId, auditId: binding.auditId, variantId: binding.variantId,
      receiptHash: shortHash(`${binding.segmentExecutionId}|${originalIndex}|${power}|${cumulative}|${binding.verificationId}`),
    })
  }
  return { ok: true, reason: null, rows, cursor: rows.length, cumulativeEnergyKwh: cumulative }
}

export function commitSuffixLedger(
  snapshot: PortfolioInputSnapshot,
  replay: PrefixReplay,
  plan: PlanResult,
  attempt: SuffixAttempt,
  faultSet: string[],
  binding: SuffixBinding,
): SuffixPlanResult {
  if (attempt.state !== 'ok' || !attempt.result || !attempt.result.plan) return { ok: false, reason: `attempt-not-ok:${attempt.state}`, rows: [], cursor: 0, cumulativeEnergyKwh: replay.cumulativeEnergyKwh }
  if (!protectedEqual(plan, attempt.result.plan)) return { ok: false, reason: 'plan-not-attempt-result', rows: [], cursor: 0, cumulativeEnergyKwh: replay.cumulativeEnergyKwh }
  return computePlanRows(snapshot, replay, plan, faultSet, binding)
}

// ---- 子段执行：verified/approved/Start 无账本；advance 依实际审批五项 ID 追加 1 行 ----

export function createSuffixExecution(
  request: SuffixRequest,
  attempt: SuffixAttempt,
  planned: SuffixPlanResult,
  prefixReplay: PrefixReplay,
  parent: ExecutionEnvelope,
): { ok: boolean; record: SuffixExecutionRecord | null; reason: string | null } {
  if (!planned.ok || planned.rows.length === 0) return { ok: false, record: null, reason: planned.reason ?? 'no-plan' }
  if (attempt.state !== 'ok' || !attempt.result?.plan) return { ok: false, record: null, reason: `attempt ${attempt.state}` }
  const suffixId = `qs-${shortHash(`${request.parentExecutionId}|${request.requestId}|${request.epoch}`)}`
  const variantId = `qv-${shortHash(`${suffixId}|variant`)}`
  const verificationId = `qver-${shortHash(`${suffixId}|verify`)}`
  const binding: SuffixBinding = { segmentExecutionId: suffixId, verificationId, decisionId: '', auditId: '', variantId }
  return {
    ok: true, reason: null,
    record: {
      suffixId, schema: REPLAN_SCHEMA, envelopeVersion: REPLAN_ENVELOPE_VERSION,
      parentPassportId: request.parentPassportId, parentCandidateId: request.parentCandidateId,
      parentExecutionId: request.parentExecutionId, parentRevision: request.parentRevision,
      parentVerificationId: request.parentVerificationId, requestId: request.requestId,
      variantId, verificationId, binding, faultSet: [...request.faultSet],
      windowStartIndex: prefixReplay.windowStartIndex, cursor: 0,
      plan: attempt.result.plan, plannedRows: planned.rows, ledger: [],
      parentEvidence: {
        snapshot: parent.inputSnapshot,
        plan: parent.plan,
        ledgerPrefix: parent.ledger,
        executionId: parent.executionId,
        verificationId: parent.binding.verificationId,
        passportId: parent.binding.passportId,
        candidateId: parent.binding.candidateId,
        canonicalId: parent.binding.canonicalId,
        businessKey: parent.businessKey,
        ruleVersion: request.ruleVersion,
        verifierVersion: request.verifierVersion,
      },
      attemptRecord: {
        requestId: request.requestId,
        state: attempt.state,
        canonical: request.inputCanonical,
        epoch: request.epoch,
        nativeState: attempt.nativeState,
        hasSolution: true,
        complete: true,
        passed: planned.ok,
        verifierVersion: request.verifierVersion,
        ruleVersion: request.ruleVersion,
        planNull: !attempt.result?.plan,
      },
      prefixCumulativeEnergyKwh: prefixReplay.cumulativeEnergyKwh,
      cumulativeEnergyKwh: prefixReplay.cumulativeEnergyKwh,
      status: 'verified', consumed: false, decisionId: null, auditId: null,
      approvedBy: null, approvedAt: null, revision: 0,
      lineage: { parentExecutionId: request.parentExecutionId, prefixCursor: prefixReplay.cursor, segmentCursor: 0 },
      dataQuality: { status: 'not_evaluated', note: '合成模拟；suffix 子段，未接设备。候选估计见 plannedRows，未执行。' },
    },
  }
}

export function approveSuffix(
  record: SuffixExecutionRecord,
  opts: { operator: string; at: string; decisionId?: string; auditId?: string },
): { ok: boolean; record: SuffixExecutionRecord | null; reason: string | null } {
  if (record.status !== 'verified') return { ok: false, record: null, reason: `状态 ${record.status} 不可批准` }
  if (!opts.operator) return { ok: false, record: null, reason: '缺少人工操作者' }
  if (record.decisionId || record.auditId) return { ok: false, record: null, reason: '已有审批关联，拒绝覆盖' }
  const decisionId = opts.decisionId ?? `qd-${shortHash(`${record.suffixId}|decision`)}`
  const auditId = opts.auditId ?? `qa-${shortHash(`${record.suffixId}|audit`)}`
  if (!decisionId || !auditId) return { ok: false, record: null, reason: '空 decision/audit ID' }
  return {
    ok: true, reason: null,
    record: {
      ...record, status: 'approved', consumed: false, decisionId, auditId,
      approvedBy: opts.operator, approvedAt: opts.at,
      binding: { ...record.binding, decisionId, auditId }, revision: record.revision + 1,
    },
  }
}

export function startSuffix(
  record: SuffixExecutionRecord,
  commandId: string,
): { ok: boolean; record: SuffixExecutionRecord | null; reason: string | null; duplicate: boolean } {
  if (record.consumed) return { ok: false, record: null, reason: '批准已消费', duplicate: true }
  if (record.status !== 'approved') return { ok: false, record: null, reason: `状态 ${record.status} 不可 Start`, duplicate: false }
  if (!record.decisionId || !record.auditId || record.binding.decisionId !== record.decisionId || record.binding.auditId !== record.auditId)
    return { ok: false, record: null, reason: '审批关联/binding 不匹配', duplicate: false }
  if (record.ledger.length !== 0) return { ok: false, record: null, reason: 'Start 前账本必须为空', duplicate: false }
  void commandId
  return { ok: true, reason: null, duplicate: false, record: { ...record, status: 'executing', consumed: true, revision: record.revision + 1 } }
}

export function advanceSuffix(
  record: SuffixExecutionRecord,
  opts: { expectedCursor: number; expectedSegmentExecutionId: string; expectedVerificationId: string },
): { ok: boolean; record: SuffixExecutionRecord | null; reason: string | null; completed: boolean } {
  if (record.status !== 'executing') return { ok: false, record: null, reason: `状态 ${record.status} 不可 advance`, completed: false }
  if (opts.expectedCursor !== record.cursor) return { ok: false, record: null, reason: `expectedCursor ${opts.expectedCursor} ≠ ${record.cursor}`, completed: false }
  if (opts.expectedSegmentExecutionId !== record.binding.segmentExecutionId || opts.expectedVerificationId !== record.binding.verificationId)
    return { ok: false, record: null, reason: '段身份不符', completed: false }
  if (!record.decisionId || !record.auditId) return { ok: false, record: null, reason: '缺少审批关联', completed: false }
  if (record.cursor >= record.plannedRows.length) return { ok: false, record: null, reason: '段窗口结束', completed: true }
  const planned = record.plannedRows[record.cursor]
  const expectedLen = 96 - record.lineage.prefixCursor
  if (record.plan.periods.length !== expectedLen) return { ok: false, record: null, reason: 'plan-window-mismatch', completed: false }
  const p = record.plan.periods[record.cursor]
  const originalIndex = record.windowStartIndex + record.cursor
  if (planned.originalIndex !== originalIndex) return { ok: false, record: null, reason: 'original-index-mismatch', completed: false }
  const binding = { ...record.binding, segmentExecutionId: record.binding.segmentExecutionId, verificationId: record.binding.verificationId }
  const cumulative = (record.ledger.length ? record.ledger[record.ledger.length - 1].cumulativeEnergyKwh : record.prefixCumulativeEnergyKwh) + planned.energyKwh
  const row: SuffixLedgerRow = {
    ...planned, index: record.cursor, originalIndex, minuteOfDay: p.minuteOfDay, demand: p.demand, supply: p.supply,
    cumulativeEnergyKwh: cumulative,
    segmentExecutionId: binding.segmentExecutionId, verificationId: binding.verificationId,
    decisionId: record.decisionId, auditId: record.auditId, variantId: record.variantId,
    receiptHash: shortHash(`${binding.segmentExecutionId}|${originalIndex}|${planned.powerKw}|${cumulative}|${binding.verificationId}`),
  }
  const completed = record.cursor + 1 >= record.plannedRows.length
  const nextCursor = record.cursor + 1
  return {
    ok: true, reason: null, completed,
    record: {
      ...record, ledger: [...record.ledger, row], cursor: nextCursor, cumulativeEnergyKwh: cumulative,
      status: completed ? 'completed' : 'executing', revision: record.revision + 1,
      lineage: { ...record.lineage, segmentCursor: nextCursor },
    },
  }
}

export function suffixCumulativeOk(record: SuffixExecutionRecord): boolean {
  if (record.ledger.length === 0) return record.cumulativeEnergyKwh === record.prefixCumulativeEnergyKwh
  const last = record.ledger[record.ledger.length - 1]
  return (
    Math.abs(record.cumulativeEnergyKwh - last.cumulativeEnergyKwh) <= REPLAN_TOLERANCE &&
    record.cursor === record.ledger.length &&
    record.lineage.segmentCursor === record.cursor
  )
}

export function suffixBindingOk(record: SuffixExecutionRecord): boolean {
  const b = record.binding
  if (b.segmentExecutionId !== record.suffixId || b.verificationId !== record.verificationId || b.variantId !== record.variantId) return false
  const approvalIdsEmpty = b.decisionId === '' && b.auditId === '' && record.decisionId === null && record.auditId === null
  // 从未批准的终止/只读证据：审批 ID 全空、无 Start、无已执行账本 → 允许只读，不伪造批准。
  const neverApproved = approvalIdsEmpty && record.consumed === false && record.ledger.length === 0
  if (neverApproved) return true
  // 已批准/已执行：严格原五绑定。
  if (!b.decisionId || !b.auditId || !record.decisionId || !record.auditId) return false
  if (b.decisionId !== record.decisionId || b.auditId !== record.auditId) return false
  return record.ledger.every(
    (r) => r.segmentExecutionId === b.segmentExecutionId && r.verificationId === b.verificationId && r.decisionId === b.decisionId && r.auditId === b.auditId && r.variantId === b.variantId,
  )
}

// ---- 请求 runner ----

export interface SuffixGuard {
  epoch: number
  parentRevision: number
  prefixCursor: number
  cursor: number
  faultSet: string[]
  requestId: string
}

export class SuffixRunner {
  private current: { request: SuffixRequest; guard: SuffixGuard } | null = null
  private lastAccepted: SuffixAttempt | null = null
  private terminated = false

  begin(request: SuffixRequest, guard: SuffixGuard): { ok: boolean; reason: string | null } {
    if (this.terminated) return { ok: false, reason: 'runner 已终止，需新 epoch/新人审' }
    this.current = { request, guard }
    this.lastAccepted = null
    return { ok: true, reason: null }
  }
  terminate(reason: string): { ok: boolean; reason: string | null } {
    this.terminated = true
    this.lastAccepted = null
    return { ok: false, reason }
  }
  isTerminated(): boolean {
    return this.terminated
  }
  accept(requestId: string, guard: SuffixGuard, attempt: SuffixAttempt): { ok: boolean; reason: string | null } {
    if (this.terminated) return { ok: false, reason: 'runner 已终止' }
    if (!this.current || this.current.request.requestId !== requestId) return { ok: false, reason: '迟到/旧 requestId，丢弃' }
    const g = this.current.guard
    if (
      g.epoch !== guard.epoch || g.parentRevision !== guard.parentRevision || g.prefixCursor !== guard.prefixCursor ||
      g.cursor !== guard.cursor || g.requestId !== guard.requestId || g.faultSet.slice().sort().join(',') !== guard.faultSet.slice().sort().join(',')
    )
      return { ok: false, reason: 'guard 不匹配，丢弃' }
    this.lastAccepted = attempt
    return { ok: true, reason: null }
  }
  getLastAccepted(): SuffixAttempt | null {
    return this.lastAccepted
  }
}

// ---- 父契约 ----

export function suffixParentOk(parent: ExecutionEnvelope, expected: ExecutionEnvelope): boolean {
  return protectedEqual(parent, expected) && bindingEquals(parent.binding, expected.binding)
}

// ---- versioned 子段存储 + 模块级 controller ----

export interface SuffixAttemptRecord {
  requestId: string
  parentExecutionId: string
  state: SuffixState
  planNull: boolean
  reasons: string[]
  at: string
}

interface ReplanStoreData {
  schemaVersion: number
  savedAt: string
  activeParentId?: string | null
  latestByParent: Record<string, { suffixId: string; revision: number }>
  incidents: Incident[]
  attempts: SuffixAttemptRecord[]
  records: SuffixExecutionRecord[]
}

export interface ReplanStoreSnapshot {
  ok: boolean
  data: ReplanStoreData | null
  raw: string | null
  writable: boolean
  corrupted: boolean
  warnings: string[]
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch {
    return null
  }
  return null
}

function emptyData(): ReplanStoreData {
  return { schemaVersion: REPLAN_ENVELOPE_VERSION, savedAt: '', activeParentId: null, latestByParent: {}, incidents: [], attempts: [], records: [] }
}

export function validateSuffixRecord(raw: unknown): { ok: boolean; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not-object' }
  const r = raw as SuffixExecutionRecord
  if (r.schema !== REPLAN_SCHEMA || r.envelopeVersion !== REPLAN_ENVELOPE_VERSION) return { ok: false, reason: 'schema' }
  if (typeof r.suffixId !== 'string' || !r.suffixId) return { ok: false, reason: 'suffixId' }
  if (typeof r.windowStartIndex !== 'number' || typeof r.cursor !== 'number') return { ok: false, reason: 'window' }
  if (!Array.isArray(r.ledger) || !Array.isArray(r.plannedRows)) return { ok: false, reason: 'ledger' }
  if (r.cursor !== r.ledger.length) return { ok: false, reason: 'cursor-ledger' }
  if (r.lineage.segmentCursor !== r.cursor) return { ok: false, reason: 'lineage-cursor' }
  if (!Array.isArray(r.faultSet) || r.faultSet.length === 0) return { ok: false, reason: 'faultset-empty' }
  const ev = r.parentEvidence
  if (!ev || !ev.snapshot || !ev.plan || !Array.isArray(ev.ledgerPrefix)) return { ok: false, reason: 'parent-evidence' }
  const ar = r.attemptRecord
  if (!ar || typeof ar.canonical !== 'string' || !ar.canonical || typeof ar.epoch !== 'number') return { ok: false, reason: 'attempt-record' }
  if (ar.verifierVersion !== VERIFIER_VERSION || ar.ruleVersion !== RULE_VERSION) return { ok: false, reason: 'attempt-versions' }
  if (ev.verifierVersion !== VERIFIER_VERSION || ev.ruleVersion !== RULE_VERSION) return { ok: false, reason: 'parent-versions' }
  if (!suffixBindingOk(r)) return { ok: false, reason: 'binding' }
  // 原 parent prefix 独立重放
  const replay = replayPrefix(ev.snapshot, ev.plan, ev.ledgerPrefix, r.windowStartIndex, { executionId: ev.executionId, verificationId: ev.verificationId })
  if (!replay.ok) return { ok: false, reason: `parent-replay:${replay.reason}` }
  if (Math.abs(replay.cumulativeEnergyKwh - r.prefixCumulativeEnergyKwh) > REPLAN_TOLERANCE) return { ok: false, reason: 'prefix-cumulative' }
  // suffix 计划独立复算
  const planned = computePlanRows(ev.snapshot, replay, r.plan, r.faultSet, r.binding)
  if (!planned.ok) return { ok: false, reason: `planned:${planned.reason}` }
  if (planned.rows.length !== r.plannedRows.length) return { ok: false, reason: 'planned-length' }
  for (let i = 0; i < planned.rows.length; i += 1) {
    const a = planned.rows[i]
    const b = r.plannedRows[i]
    if (
      a.originalIndex !== b.originalIndex || a.minuteOfDay !== b.minuteOfDay || a.demand !== b.demand ||
      Math.abs(a.powerKw - b.powerKw) > REPLAN_TOLERANCE || Math.abs(a.energyKwh - b.energyKwh) > REPLAN_TOLERANCE ||
      Math.abs(a.cumulativeEnergyKwh - b.cumulativeEnergyKwh) > REPLAN_TOLERANCE
    )
      return { ok: false, reason: `planned-mismatch:${i}` }
  }
  // 已提交 ledger 独立复算（含 decision/audit binding）
  const committed = planned.rows.slice(0, r.cursor)
  for (let i = 0; i < committed.length; i += 1) {
    const a = committed[i]
    const b = r.ledger[i]
    if (
      b.index !== i || b.originalIndex !== a.originalIndex || b.minuteOfDay !== a.minuteOfDay ||
      b.demand !== a.demand || Math.abs(b.powerKw - a.powerKw) > REPLAN_TOLERANCE ||
      Math.abs(b.energyKwh - a.energyKwh) > REPLAN_TOLERANCE ||
      Math.abs(b.cumulativeEnergyKwh - a.cumulativeEnergyKwh) > REPLAN_TOLERANCE ||
      b.segmentExecutionId !== r.binding.segmentExecutionId || b.verificationId !== r.binding.verificationId ||
      b.decisionId !== r.binding.decisionId || b.auditId !== r.binding.auditId || b.variantId !== r.binding.variantId
    )
      return { ok: false, reason: `ledger-mismatch:${i}` }
  }
  const cum = r.ledger.length > 0 ? r.ledger[r.ledger.length - 1].cumulativeEnergyKwh : r.prefixCumulativeEnergyKwh
  if (Math.abs(r.cumulativeEnergyKwh - cum) > REPLAN_TOLERANCE) return { ok: false, reason: 'cumulative' }
  const finite = assertFiniteDeep(r)
  if (finite) return { ok: false, reason: `non-finite:${finite}` }
  return { ok: true, reason: 'ok' }
}

export function loadReplanStore(storage?: StorageLike | null): ReplanStoreSnapshot {
  const store = resolveStorage(storage)
  const snap: ReplanStoreSnapshot = { ok: false, data: null, raw: null, writable: true, corrupted: false, warnings: [] }
  if (!store) {
    snap.writable = false
    snap.warnings.push('当前环境没有可用的本地存储；suffix 只读展示，未持久化。')
    return { ...snap, data: emptyData() }
  }
  let raw: string | null = null
  try {
    raw = store.getItem(REPLAN_STORE_KEY)
  } catch {
    snap.writable = false
    snap.warnings.push('读取 suffix 存储被拒绝；只读，未持久化。')
    return { ...snap, data: emptyData() }
  }
  snap.raw = raw
  if (raw === null) return { ...snap, ok: true, data: emptyData() }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...snap, corrupted: true, writable: false, warnings: ['suffix 存储 JSON 损坏：保留原文、不覆盖。'] }
  }
  const env = parsed as Record<string, unknown>
  if (!env || env.schemaVersion !== REPLAN_ENVELOPE_VERSION) {
    return { ...snap, corrupted: true, writable: false, warnings: ['suffix 存储 schemaVersion 未知：保留原文、不覆盖。'] }
  }
  const data = emptyData()
  data.activeParentId = typeof env.activeParentId === 'string' ? env.activeParentId : null
  data.latestByParent = (env.latestByParent as Record<string, { suffixId: string; revision: number }>) ?? {}
  data.incidents = Array.isArray(env.incidents) ? (env.incidents as Incident[]) : []
  data.attempts = Array.isArray(env.attempts) ? (env.attempts as SuffixAttemptRecord[]) : []
  const records = Array.isArray(env.records) ? (env.records as unknown[]) : []
  for (const item of records) {
    const check = validateSuffixRecord(item)
    if (!check.ok) {
      return { ...snap, corrupted: true, writable: false, warnings: [`suffix 记录校验失败（${check.reason}）：保留原文、不覆盖。`] }
    }
    data.records.push(item as SuffixExecutionRecord)
  }
  return { ...snap, ok: true, data }
}

export function saveReplanStore(
  data: ReplanStoreData,
  storage?: StorageLike | null,
  opts?: { expectedRaw?: string | null },
): { ok: boolean; bytes: number; error?: string } {
  const store = resolveStorage(storage)
  if (!store) return { ok: false, bytes: 0, error: '当前环境没有可用的本地存储' }
  const current = loadReplanStore(store)
  if (current.corrupted || !current.writable) return { ok: false, bytes: 0, error: 'suffix 存储已损坏或被拒，拒绝覆盖' }
  if (opts?.expectedRaw !== undefined && current.raw !== opts.expectedRaw)
    return { ok: false, bytes: 0, error: 'replan raw 已变化，拒绝写入' }
  const text = JSON.stringify({ ...data, savedAt: new Date().toISOString() })
  const bytes = new TextEncoder().encode(text).length
  if (bytes > REPLAN_CAPACITY_BYTES) return { ok: false, bytes, error: '超出 suffix 存储容量上限，请先导出' }
  try {
    store.setItem(REPLAN_STORE_KEY, text)
    return { ok: true, bytes }
  } catch (error) {
    return { ok: false, bytes, error: error instanceof Error ? error.message : 'suffix 写入失败（无部分提交）' }
  }
}

function deepFreezeLocal<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as Record<string, unknown>)) deepFreezeLocal(v)
  }
  return value
}

interface ReplanData {
  schemaVersion: number
  savedAt: string
  activeParentId: string | null
  latestByParent: Record<string, { suffixId: string; revision: number }>
  incidents: Incident[]
  attempts: SuffixAttemptRecord[]
  records: SuffixExecutionRecord[]
}

/** 父授权 gate：浏览器单例查真实 executionController；纯测试可注入。 */
export interface ParentGate {
  getLatest(): ExecutionEnvelope | null
  getPendingSaveReason(): string | null
  loadPersisted(executionId: string): ExecutionEnvelope | null
}
export const defaultParentGate: ParentGate = {
  getLatest: () => executionController.getLatest(),
  getPendingSaveReason: () => executionController.getPendingSaveReason(),
  loadPersisted: (id) => loadExecutionStoreRaw().envelopes.find((e) => e.executionId === id) ?? null,
}

export class ReplanController {
  private data: ReplanData
  private latest: SuffixExecutionRecord | null = null
  private listeners = new Set<() => void>()
  private warnings: string[] = []
  private pendingSaveReason: string | null = null
  private safetyTerminated = false
  private context: { businessKey: string; invalid: boolean; faultSet: string[] } = { businessKey: '', invalid: false, faultSet: [] }

  constructor(private storage?: StorageLike | null, private parentGate: ParentGate = defaultParentGate) {
    const snap = loadReplanStore(this.storage)
    this.warnings.push(...snap.warnings)
    const d = snap.data ?? { schemaVersion: REPLAN_ENVELOPE_VERSION, savedAt: '', activeParentId: null, latestByParent: {}, incidents: [], attempts: [], records: [] }
    this.data = { activeParentId: (d as unknown as ReplanData).activeParentId ?? null, ...d } as ReplanData
    // 刷新恢复：活动段只读并永久退休，prefix/子 ledger 同值保留；同步 ptr.revision。
    let mutated = false
    const records = this.data.records.map((r) => {
      if (['verified', 'approved', 'executing'].includes(r.status)) {
        mutated = true
        return { ...r, status: 'terminated' as const, revision: r.revision + 1 }
      }
      return r
    })
    if (mutated) {
      const pointers = { ...this.data.latestByParent }
      for (const r of records) if (pointers[r.parentExecutionId]?.suffixId === r.suffixId) pointers[r.parentExecutionId] = { suffixId: r.suffixId, revision: r.revision }
      this.data = { ...this.data, records, latestByParent: pointers }
      this.safetyTerminated = true
      const saved = saveReplanStore(this.data, this.storage)
      if (!saved.ok) {
        this.pendingSaveReason = `刷新退休写失败（内存已退休，保留 prefix）：${saved.error}`
        this.warnings.push(this.pendingSaveReason)
      }
    }
    const pid = this.data.activeParentId
    if (pid) {
      const ptr = this.data.latestByParent[pid]
      this.latest = (ptr && this.data.records.find((r) => r.suffixId === ptr.suffixId)) || null
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key === REPLAN_STORE_KEY || e.key === EXECUTION_STORE_KEY || e.key === null) this.onExternalWrite()
      })
    }
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const fn of this.listeners) fn()
  }
  getLatest(): SuffixExecutionRecord | null {
    return this.latest ? (deepFreezeLocal(JSON.parse(JSON.stringify(this.latest))) as SuffixExecutionRecord) : null
  }
  getWarnings(): string[] {
    return [...this.warnings]
  }
  getPendingSaveReason(): string | null {
    return this.pendingSaveReason
  }
  isSafetyTerminated(): boolean {
    return this.safetyTerminated
  }
  getIncidents(): Incident[] {
    return deepFreezeLocal(JSON.parse(JSON.stringify(this.data.incidents)))
  }
  getAttempts(): SuffixAttemptRecord[] {
    return deepFreezeLocal(JSON.parse(JSON.stringify(this.data.attempts)))
  }
  private freshData(): ReplanData {
    const snap = loadReplanStore(this.storage)
    const d = snap.data ?? this.data
    return { activeParentId: (d as unknown as ReplanData).activeParentId ?? null, ...d } as ReplanData
  }
  private persistMutate(action: string, fn: (fresh: ReplanData) => ReplanData): boolean {
    const snap = loadReplanStore(this.storage)
    if (snap.corrupted || !snap.writable) {
      this.pendingSaveReason = `${action} 未保存：store 损坏/只读`
      this.warnings.push(this.pendingSaveReason)
      return false
    }
    const next = fn(this.freshData())
    const saved = saveReplanStore(next, this.storage)
    if (!saved.ok) {
      this.pendingSaveReason = `${action} 未保存：${saved.error}`
      this.warnings.push(this.pendingSaveReason)
      return false
    }
    this.data = next
    this.pendingSaveReason = null
    return true
  }
  /** 父保存屏障：查真实父（退休/持久一致/pending null/prefix+绑定+业务键一致）才准子授权。 */
  private authorizeGuard(rec: SuffixExecutionRecord): string | null {
    const parent = this.parentGate.getLatest()
    if (!parent) return '无父执行，拒绝子授权'
    if (parent.status !== 'retired') return '父未退休，拒绝子授权'
    if (parent.executionId !== rec.parentExecutionId) return '父身份不符'
    if (this.parentGate.getPendingSaveReason() !== null) return '父退休未保存，禁止子授权'
    const persisted = this.parentGate.loadPersisted(rec.parentExecutionId)
    if (!persisted) return '持久层无父执行，拒绝子授权'
    if (!protectedEqual(persisted, parent) || persisted.status !== 'retired') return '父持久内容不一致/未退休，拒绝子授权'
    const ev = rec.parentEvidence
    if (ev.executionId !== parent.executionId || ev.verificationId !== parent.binding.verificationId) return '父绑定不符'
    if (ev.businessKey !== parent.businessKey) return '父业务键不符'
    if (!protectedEqual(ev.ledgerPrefix, parent.ledger)) return '父已提交 prefix 不符'
    if (!protectedEqual(ev.plan, parent.plan)) return '父计划不符'
    if (!protectedEqual(ev.snapshot, parent.inputSnapshot)) return '父输入快照不符'
    return null
  }
  private expectedGate(): { ok: true; expected: SuffixExecutionRecord } | { ok: false; reason: string } {
    if (!this.latest) return { ok: false, reason: '无子段' }
    if (this.latest.status === 'terminated') return { ok: false, reason: '子段已永久终止，拒绝命令' }
    const fresh = this.freshData()
    if (fresh.activeParentId !== this.latest.parentExecutionId)
      return this.conflict('活动父指针不符，拒绝命令')
    const ptr = fresh.latestByParent[this.latest.parentExecutionId]
    if (!ptr || ptr.suffixId !== this.latest.suffixId || ptr.revision !== this.latest.revision)
      return this.conflict('活动父/指针不符，拒绝命令')
    const persisted = fresh.records.find((r) => r.suffixId === this.latest!.suffixId)
    if (!persisted) return this.conflict('持久无同 ID 子段，拒绝命令')
    if (persisted.revision !== this.latest.revision || !protectedEqual(persisted, this.latest))
      return this.conflict('持久同 ID 完整内容已变化，拒绝旧命令')
    return { ok: true, expected: persisted }
  }
  private conflict(reason: string): { ok: false; reason: string } {
    if (this.latest) {
      const base = this.latest
      this.latest = deepFreezeLocal({ ...base, status: 'terminated', revision: base.revision + 1 }) as SuffixExecutionRecord
    }
    this.safetyTerminated = true
    this.pendingSaveReason = `冲突：${reason}，未覆盖 raw，内存已永久终止`
    this.warnings.push(this.pendingSaveReason)
    this.emit()
    return { ok: false, reason }
  }
  private update(next: SuffixExecutionRecord, action: string): boolean {
    const p = this.authorizeGuard(next)
    if (p) {
      this.conflict(`父授权屏障：${p}`)
      return false
    }
    const gate = this.expectedGate()
    if (!gate.ok) return false
    if (next.revision !== gate.expected.revision + 1) {
      this.warnings.push(`${action}：revision 非旧+1，拒绝`)
      return false
    }
    const ok = this.persistMutate(action, (fresh) => {
      const records = fresh.records.map((r) => (r.suffixId === next.suffixId ? next : r))
      return { ...fresh, records, activeParentId: next.parentExecutionId, latestByParent: { ...fresh.latestByParent, [next.parentExecutionId]: { suffixId: next.suffixId, revision: next.revision } } }
    })
    if (!ok) return false
    this.latest = next
    this.emit()
    return true
  }
  /** 同父是否已有已提交子桶（含 terminated/completed/刷新恢复）→ 禁止从父 prefix 重新生成。 */
  hasCommittedChild(parentExecutionId: string): boolean {
    return this.freshData().records.some((r) => r.parentExecutionId === parentExecutionId && (r.cursor > 0 || r.ledger.length > 0))
  }
  createSuffix(record: SuffixExecutionRecord, incident: Incident | null): { ok: boolean; reason: string | null } {
    const p = this.authorizeGuard(record)
    if (p) {
      this.conflict(`父授权屏障：${p}`)
      return { ok: false, reason: p }
    }
    const fresh = this.freshData()
    const existing = fresh.records.find((r) => r.parentExecutionId === record.parentExecutionId && !['terminated', 'completed', 'rejected'].includes(r.status))
    if (existing) return { ok: false, reason: '父已有活动子段，需先终止/完成' }
    if (fresh.records.some((r) => r.parentExecutionId === record.parentExecutionId && (r.cursor > 0 || r.ledger.length > 0)))
      return { ok: false, reason: '同父已有已提交子桶，组合 prefix 续算尚不支持，禁止从父 prefix 重新生成/授权' }
    const ok = this.persistMutate('createSuffix', (fresh) => ({
      ...fresh,
      activeParentId: record.parentExecutionId,
      incidents: incident ? [...fresh.incidents, incident] : fresh.incidents,
      records: [...fresh.records, record],
      latestByParent: { ...fresh.latestByParent, [record.parentExecutionId]: { suffixId: record.suffixId, revision: record.revision } },
    }))
    if (!ok) return { ok: false, reason: 'create 写失败' }
    this.latest = record
    this.safetyTerminated = false
    this.emit()
    return { ok: true, reason: null }
  }
  recordAttempt(rec: SuffixAttemptRecord): void {
    if (this.persistMutate('attempt', (fresh) => ({ ...fresh, attempts: [...fresh.attempts, rec] }))) this.emit()
  }
  approve(opts: { operator: string; at: string }): { ok: boolean; reason: string | null } {
    if (!this.latest) return { ok: false, reason: '无子段' }
    const r = approveSuffix(this.latest, opts)
    if (!r.ok || !r.record) return { ok: false, reason: r.reason }
    return this.update(r.record, 'approve') ? { ok: true, reason: null } : { ok: false, reason: 'approve 写失败或被屏障拒绝' }
  }
  start(commandId: string): { ok: boolean; reason: string | null } {
    if (!this.latest) return { ok: false, reason: '无子段' }
    const r = startSuffix(this.latest, commandId)
    if (!r.ok || !r.record) return { ok: false, reason: r.reason }
    return this.update(r.record, 'start') ? { ok: true, reason: null } : { ok: false, reason: 'start 写失败或被屏障拒绝' }
  }
  advance(opts: { expectedCursor: number }): { ok: boolean; reason: string | null; completed: boolean } {
    if (!this.latest) return { ok: false, reason: '无子段', completed: false }
    const r = advanceSuffix(this.latest, { expectedCursor: opts.expectedCursor, expectedSegmentExecutionId: this.latest.binding.segmentExecutionId, expectedVerificationId: this.latest.binding.verificationId })
    if (!r.ok || !r.record) return { ok: false, reason: r.reason, completed: false }
    return this.update(r.record, 'advance') ? { ok: true, reason: null, completed: r.completed } : { ok: false, reason: 'advance 写失败或被屏障拒绝', completed: false }
  }
  /** 必须终止：读真实持久 record 与捕获比较；异内容保 raw 不覆盖；写失败留 pending 不复活。 */
  terminate(reason: string): { ok: boolean; reason: string | null } {
    if (!this.latest) return { ok: false, reason: '无子段' }
    if (this.latest.status === 'terminated') {
      this.safetyTerminated = true
      return { ok: true, reason: null }
    }
    const base = this.latest
    this.latest = deepFreezeLocal({ ...base, status: 'terminated', revision: base.revision + 1 }) as SuffixExecutionRecord
    this.safetyTerminated = true
    this.pendingSaveReason = reason
    this.emit()
    const fresh = this.freshData()
    const persisted = fresh.records.find((r) => r.suffixId === base.suffixId)
    if (persisted && !protectedEqual(persisted, base)) {
      this.pendingSaveReason = '冲突：持久内容已变化，未覆盖 raw，内存已永久终止'
      this.warnings.push(this.pendingSaveReason)
      return { ok: true, reason: null }
    }
    const ok = this.persistMutate('terminate', (f) => {
      const records = f.records.map((r) => (r.suffixId === base.suffixId ? this.latest! : r))
      return { ...f, records, latestByParent: { ...f.latestByParent, [base.parentExecutionId]: { suffixId: base.suffixId, revision: this.latest!.revision } } }
    })
    if (!ok) {
      this.pendingSaveReason = `终止未保存（内存已永久终止，保留 prefix）：${this.pendingSaveReason}`
      this.warnings.push(this.pendingSaveReason)
    }
    return { ok: true, reason: null }
  }
  onExternalWrite(): void {
    if (this.latest && ['verified', 'approved', 'executing'].includes(this.latest.status)) this.terminate('storage 事件：外部写入，fail-closed 永久终止')
  }
  setBusinessContext(ctx: { businessKey?: string; invalid?: boolean; faultSet?: string[] }): void {
    const join = (a: string[]) => a.slice().sort().join(',')
    const prev = this.context
    const nextKey = ctx.businessKey ?? prev.businessKey
    const nextFaults = ctx.faultSet ?? prev.faultSet
    const changed =
      (ctx.businessKey !== undefined && ctx.businessKey !== prev.businessKey) ||
      (ctx.invalid === true && !prev.invalid) ||
      (ctx.faultSet !== undefined && join(ctx.faultSet) !== join(prev.faultSet))
    this.context = { businessKey: nextKey, invalid: ctx.invalid ?? prev.invalid, faultSet: nextFaults }
    if (changed && this.latest && ['verified', 'approved', 'executing'].includes(this.latest.status))
      this.terminate('业务身份/资格/规则/故障集变化，终止活动子段')
  }
  getContext(): { businessKey: string; invalid: boolean; faultSet: string[] } {
    return { businessKey: this.context.businessKey, invalid: this.context.invalid, faultSet: [...this.context.faultSet] }
  }
}

export const replanController = new ReplanController()

export { solveFlowMilp, retireExecution }
export type { ExecutionEnvelope, ExecutionBinding, FlowMilpInput, FlowMilpResult, StorageLike }

/** 父退休保存屏障：父退休 pendingSaveReason 非空或父未退休时，禁止新子授权。 */
export function canAuthorizeChild(parentRetired: boolean, pendingSaveReason: string | null): boolean {
  return parentRetired && pendingSaveReason === null
}
