import { unitPower } from './engine'
import { verifyPlanConstraints, VERIFIER_VERSION, type VerifyContext } from './constraints'
import { verifyLabPlanMetrics } from './lab'
import { RULE_VERSION } from './audit'
import {
  canonicalCandidate,
  canonicalPortfolioInput,
  deepClone,
  shortHash,
  snapshotToFixture,
  type PortfolioInputSnapshot,
  type PortfolioStrategy,
} from './portfolio'
import {
  PASSPORT_SCHEMA,
  PASSPORT_ENVELOPE_VERSION,
  PASSPORT_VERSION,
  validateStoredPassport,
  type DecisionPassport,
} from './passport'
import { FLOW_MILP_MODEL_VERSION } from './optimizer/flowMilp'
import type { PlanResult } from './types'

/**
 * B03b 合成执行链（候选 4174，隔离）。
 * 严格 admission（validateStoredPassport 结构门 + 受支持版本 + 复验）→ 人工批准/驳回 → Start 消费
 * → 人工逐桶 advance（严格 ledger 重放/身份绑定）→ 退休。仅合成模拟；不接 PLC/账号/外部 DSH。
 */

export const EXECUTION_ENVELOPE_VERSION = 1
export const EXECUTION_SCHEMA = 'qiheng-execution-envelope-v1'
export const EXECUTION_STORE_KEY = 'qiheng.execution.store.v1'
export const EXECUTION_VERSION = 'execution-b03b-v1'
export const EXECUTION_AUTHORIZATION = '仅合成模拟；尚未接入执行/PLC，不构成执行授权'
export const EXECUTION_CAPACITY_BYTES = 6_000_000
export const EXEC_TOLERANCE = 1e-6

export const SUPPORTED_SOURCES = ['synthetic-development'] as const
export const SUPPORTED_GENERATORS = ['portfolio-fixture-generator-v1'] as const
export const SUPPORTED_CANONICAL_VERSIONS = ['portfolio-candidate-canonical-v1'] as const
export const SUPPORTED_PASSPORT_VERSIONS = [PASSPORT_VERSION] as const

export type ExecutionStatus = 'verified' | 'approved' | 'rejected' | 'executing' | 'paused' | 'completed' | 'retired'

export interface ExecutionBinding {
  passportId: string
  candidateId: string
  batchId: number
  epoch: number
  inputCanonical: string
  canonicalId: string
  executionEpoch: number
  verificationId: string
}

export interface ExecutionReceipt {
  strategy: PortfolioStrategy
  verifierVersion: string
  ruleVersion: string
  modelVersion: string
  objectiveVersion: string
  evaluated: boolean
  constraints: {
    hasSolution: boolean
    passed: boolean
    complete: boolean
    violationCount: number
    byType: Record<string, number>
    violations: Array<{ periodIndex: number; periodLabel: string; type: string; unitId?: string; message: string }>
    verifierVersion: string
    ruleVersion: string
  }
  metrics: {
    ok: boolean
    mismatchCount: number
    mismatches: Array<{ field: string; periodIndex?: number; declared: number; recomputed: number }>
    recomputed: { totalEnergyKwh: number; totalSwitches: number; excessSupplyM3: number }
  }
  declaredMetrics: { energyKwh: number | null; switches: number | null; excessSupplyM3: number | null }
  recomputedMetrics: { totalEnergyKwh: number; totalSwitches: number; excessSupplyM3: number }
  declaredMatchesRecomputed: boolean
}

export interface ExecutionLedgerEntry {
  index: number
  minuteOfDay: number
  demand: number
  supply: number
  powerKw: number
  energyKwh: number
  cumulativeEnergyKwh: number
  runningUnitIds: string[]
  unitLoads: Record<string, number>
  switches: number
  receiptHash: string
  executionId: string
  verificationId: string
  decisionId: string
  auditId: string
}

export interface DecisionAuditLink {
  decisionId: string
  auditId: string
  action: 'approve' | 'reject'
  operator: string
  at: string
  binding: ExecutionBinding
  syntheticOnly: true
}

export interface ExecutionEnvelope {
  schema: typeof EXECUTION_SCHEMA
  envelopeVersion: number
  executionVersion: string
  executionId: string
  revision: number
  passportId: string
  candidateId: string
  strategy: PortfolioStrategy
  batchId: number
  epoch: number
  inputCanonical: string
  canonicalId: string
  source: string
  generator: string
  passportVersion: string
  scenarioId: string
  scenarioLabel: string
  capturedAt: string
  binding: ExecutionBinding
  receipt: ExecutionReceipt
  inputSnapshot: PortfolioInputSnapshot
  plan: PlanResult
  executionEpoch: number
  status: ExecutionStatus
  disposition: 'none' | 'approved' | 'rejected'
  commandLog: string[]
  decisionAuditLink: DecisionAuditLink | null
  approvedAt: string | null
  approvedBy: string | null
  startCommandId: string | null
  startedAt: string | null
  consumed: boolean
  retiredReason: string | null
  rejectedReason: string | null
  ledger: ExecutionLedgerEntry[]
  cursor: number
  modelEnergyKwh: number
  lastChange: Record<string, number>
  fingerprint: string
  businessKey: string
  dataQuality: { status: 'not_evaluated'; note: string }
  authorization: string
  notes: string[]
}

export interface ExecutionStoreSnapshot {
  envelopes: ExecutionEnvelope[]
  raw: string | null
  writable: boolean
  corrupted: boolean
  warnings: string[]
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

export function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length
  let bytes = 0
  for (let i = 0; i < text.length; i += 1) bytes += text.charCodeAt(i) < 0x80 ? 1 : 2
  return bytes
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  }
  return value
}

function contextOf(s: PortfolioInputSnapshot): VerifyContext {
  return {
    series: {
      seed: s.seed,
      scenario: 'normal',
      scenarioLabel: s.id,
      synthetic: true,
      stepMinutes: s.stepMinutes,
      points: s.points,
      note: EXECUTION_VERSION,
    },
    allUnits: s.units,
    evaluation: { candidates: s.candidates, eligibility: s.eligibility, excludedNotes: s.excludedNotes },
    initial: s.initial,
    faultUnitId: s.faultUnitId,
  }
}

export function executionFingerprint(args: {
  source: string
  generator: string
  ruleVersion: string
  inputCanonical: string
  canonicalId: string
}): string {
  return shortHash(
    [args.source, args.generator, args.ruleVersion, args.inputCanonical, args.canonicalId].join('||'),
  )
}

// ---- binding 完整性 ----

export function bindingShapeOk(b: unknown): b is ExecutionBinding {
  if (!b || typeof b !== 'object') return false
  const x = b as Record<string, unknown>
  return (
    typeof x.passportId === 'string' && x.passportId !== '' &&
    typeof x.candidateId === 'string' && x.candidateId !== '' &&
    typeof x.batchId === 'number' && Number.isFinite(x.batchId) &&
    typeof x.epoch === 'number' && Number.isFinite(x.epoch) &&
    typeof x.inputCanonical === 'string' && x.inputCanonical !== '' &&
    typeof x.canonicalId === 'string' && x.canonicalId !== '' &&
    typeof x.executionEpoch === 'number' && Number.isFinite(x.executionEpoch) &&
    typeof x.verificationId === 'string' && x.verificationId !== ''
  )
}

export function bindingEquals(a: ExecutionBinding, b: ExecutionBinding): boolean {
  return (
    a.passportId === b.passportId &&
    a.candidateId === b.candidateId &&
    a.batchId === b.batchId &&
    a.epoch === b.epoch &&
    a.inputCanonical === b.inputCanonical &&
    a.canonicalId === b.canonicalId &&
    a.executionEpoch === b.executionEpoch &&
    a.verificationId === b.verificationId
  )
}

/** 顶层身份与 binding、link 必须逐项一致；短 ID/hash 不是权限。 */
export function envelopeIdentityOk(env: ExecutionEnvelope): boolean {
  const b = env.binding
  if (!bindingShapeOk(b)) return false
  if (env.passportId !== b.passportId || env.candidateId !== b.candidateId) return false
  if (env.batchId !== b.batchId || env.epoch !== b.epoch) return false
  if (env.inputCanonical !== b.inputCanonical || env.canonicalId !== b.canonicalId) return false
  if (env.executionEpoch !== b.executionEpoch) return false
  if (env.disposition !== 'none') {
    const l = env.decisionAuditLink
    if (!l || !l.decisionId || !l.auditId) return false
    if (!bindingEquals(l.binding, b)) return false
  }
  return true
}

// ---- lastChange 语义：初态窗口首 minute − age；翻转记该桶原 minute ----

function replayLastChange(snap: PortfolioInputSnapshot, plan: PlanResult, upTo: number): Record<string, number> {
  const map: Record<string, number> = {}
  const first = plan.periods[0]?.minuteOfDay ?? 0
  for (const [id, age] of Object.entries(snap.initial.minutesSinceChange)) {
    map[id] = first - (Number.isFinite(age) ? age : 0)
  }
  let prev = new Set(snap.initial.runningUnitIds)
  for (let i = 0; i < upTo; i += 1) {
    const p = plan.periods[i]
    const cur = new Set(p.runningUnitIds)
    for (const u of snap.units) {
      if (prev.has(u.id) !== cur.has(u.id)) map[u.id] = p.minuteOfDay
    }
    prev = cur
  }
  return map
}

function lastChangeEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k])
}

function newExecutionId(): string {
  const rnd =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10)
  return `qx-${Date.now().toString(36)}-${rnd}`
}

export interface AdmitResult {
  ok: boolean
  envelope: ExecutionEnvelope | null
  reason: string | null
}

/** 送交执行复验：结构门（validateStoredPassport，非授权）+ 受支持版本 + 完成护照 + 精确复验。 */
export function admitPassportCandidate(
  passport: DecisionPassport,
  candidateId: string,
  executionEpoch: number,
  capturedAt: string,
  businessKey = '',
): AdmitResult {
  if (passport.schema !== PASSPORT_SCHEMA || passport.envelopeVersion !== PASSPORT_ENVELOPE_VERSION)
    return { ok: false, envelope: null, reason: '护照 envelope/版本未知，拒绝送执行' }
  if (passport.status !== 'complete')
    return { ok: false, envelope: null, reason: `护照 status=${passport.status} 非 complete，拒绝送执行` }
  const structural = validateStoredPassport(passport)
  if (!structural.ok) return { ok: false, envelope: null, reason: `护照结构门未过（${structural.reason}），拒绝送执行` }
  if (!(SUPPORTED_SOURCES as readonly string[]).includes(passport.inputSource))
    return { ok: false, envelope: null, reason: `不支持的 inputSource=${passport.inputSource}` }
  if (!(SUPPORTED_GENERATORS as readonly string[]).includes(passport.generator))
    return { ok: false, envelope: null, reason: `不支持的 generator=${passport.generator}` }
  if (!(SUPPORTED_CANONICAL_VERSIONS as readonly string[]).includes(passport.inputSnapshot.canonicalVersion))
    return { ok: false, envelope: null, reason: `不支持的 canonicalVersion=${passport.inputSnapshot.canonicalVersion}` }
  if (!(SUPPORTED_PASSPORT_VERSIONS as readonly string[]).includes(passport.passportVersion))
    return { ok: false, envelope: null, reason: `不支持的 passportVersion=${passport.passportVersion}` }
  if (passport.ruleVersion !== RULE_VERSION)
    return { ok: false, envelope: null, reason: `ruleVersion 不受支持（${passport.ruleVersion}）` }
  if (passport.verifierVersion !== VERIFIER_VERSION)
    return { ok: false, envelope: null, reason: `verifierVersion 不受支持（${passport.verifierVersion}）` }

  const record = passport.attempts.find((a) => a.candidateId === candidateId)
  if (!record) return { ok: false, envelope: null, reason: `未找到 candidate ${candidateId}` }
  const executable =
    record.verification.evaluated === true &&
    record.verification.ok === true &&
    record.planOrNull != null &&
    record.planOrNull.feasible
  if (!executable)
    return {
      ok: false,
      envelope: null,
      reason: `候选不可执行（status=${record.status}，evaluated=${record.verification.evaluated}，ok=${String(record.verification.ok)}），拒绝送执行`,
    }
  const plan = record.planOrNull as PlanResult
  if (record.originalInputIdentity !== passport.inputCanonical)
    return { ok: false, envelope: null, reason: '候选输入身份与护照不一致，拒绝送执行' }
  if (record.b01Verdict.batchId !== passport.batchId)
    return { ok: false, envelope: null, reason: '候选 batch 与护照不一致，拒绝送执行' }

  const snap = passport.inputSnapshot
  const fixture = snapshotToFixture(snap)
  const inputCheck = canonicalPortfolioInput(fixture)
  if (!inputCheck.ok || inputCheck.id !== passport.inputCanonical)
    return { ok: false, envelope: null, reason: '快照输入 canonical 不匹配，拒绝送执行' }
  if (snap.points.length !== 96 || snap.stepMinutes !== 15)
    return { ok: false, envelope: null, reason: '输入非 96×15 完整窗口，拒绝送执行' }

  const canonical = canonicalCandidate(fixture, record.strategy, plan)
  if (!canonical.ok || canonical.id !== record.canonicalId)
    return { ok: false, envelope: null, reason: 'canonicalCandidate 与记录 canonical 不匹配，拒绝送执行' }

  const finite = assertFiniteDeep({ snap, plan, declared: record.verification.declaredMetrics })
  if (finite) return { ok: false, envelope: null, reason: `非有限数值，拒绝送执行：${finite}` }

  const context = contextOf(snap)
  const cv = verifyPlanConstraints(plan, context)
  const mv = verifyLabPlanMetrics(plan, snap.units, snap.initial, snap.stepMinutes)
  const declared = record.verification.declaredMetrics
  const rec = mv.recomputed
  const declaredMatches =
    typeof declared.energyKwh === 'number' &&
    Number.isFinite(declared.energyKwh) &&
    Math.abs(declared.energyKwh - rec.totalEnergyKwh) <= 1e-9 &&
    declared.switches === rec.totalSwitches
  if (!cv.hasSolution || !cv.complete || !cv.passed || !mv.ok)
    return { ok: false, envelope: null, reason: '按快照重跑复验未通过，拒绝送执行' }
  if (!declaredMatches) return { ok: false, envelope: null, reason: '声明指标与复算不一致，拒绝送执行' }

  const verificationId = `qv-${shortHash(`${passport.passportId}|${candidateId}|${executionEpoch}|${EXECUTION_VERSION}`)}`
  const binding: ExecutionBinding = {
    passportId: passport.passportId,
    candidateId,
    batchId: passport.batchId,
    epoch: passengerEpoch(passport),
    inputCanonical: passport.inputCanonical,
    canonicalId: record.canonicalId,
    executionEpoch,
    verificationId,
  }
  const receipt: ExecutionReceipt = {
    strategy: record.strategy,
    verifierVersion: VERIFIER_VERSION,
    ruleVersion: RULE_VERSION,
    modelVersion: record.strategy === 'milp_weighted' ? FLOW_MILP_MODEL_VERSION : 'n/a',
    objectiveVersion: record.objectiveVersion,
    evaluated: true,
    constraints: {
      hasSolution: cv.hasSolution,
      passed: cv.passed,
      complete: cv.complete,
      violationCount: cv.violationCount,
      byType: { ...cv.byType },
      violations: cv.violations.map((v) => ({ periodIndex: v.periodIndex, periodLabel: v.periodLabel, type: v.type, unitId: v.unitId, message: v.message })),
      verifierVersion: cv.verifierVersion,
      ruleVersion: cv.ruleVersion,
    },
    metrics: {
      ok: mv.ok,
      mismatchCount: mv.mismatches.length,
      mismatches: mv.mismatches.map((m) => ({ field: m.field, periodIndex: m.periodIndex, declared: m.declared, recomputed: m.recomputed })),
      recomputed: { ...rec },
    },
    declaredMetrics: { ...declared },
    recomputedMetrics: { ...rec },
    declaredMatchesRecomputed: declaredMatches,
  }
  const envelope: ExecutionEnvelope = {
    schema: EXECUTION_SCHEMA,
    envelopeVersion: EXECUTION_ENVELOPE_VERSION,
    executionVersion: EXECUTION_VERSION,
    executionId: newExecutionId(),
    revision: 0,
    passportId: passport.passportId,
    candidateId,
    strategy: record.strategy,
    batchId: passport.batchId,
    epoch: passengerEpoch(passport),
    inputCanonical: passport.inputCanonical,
    canonicalId: record.canonicalId,
    source: passport.inputSource,
    generator: passport.generator,
    passportVersion: passport.passportVersion,
    scenarioId: passport.scenarioId,
    scenarioLabel: passport.scenarioLabel,
    capturedAt,
    binding,
    receipt,
    inputSnapshot: deepClone(snap),
    plan: deepClone(plan),
    executionEpoch,
    status: 'verified',
    disposition: 'none',
    commandLog: [],
    decisionAuditLink: null,
    approvedAt: null,
    approvedBy: null,
    startCommandId: null,
    startedAt: null,
    consumed: false,
    retiredReason: null,
    rejectedReason: null,
    ledger: [],
    cursor: 0,
    modelEnergyKwh: 0,
    lastChange: replayLastChange(snap, plan, 0),
    fingerprint: executionFingerprint({
      source: passport.inputSource,
      generator: passport.generator,
      ruleVersion: RULE_VERSION,
      inputCanonical: passport.inputCanonical,
      canonicalId: record.canonicalId,
    }),
    businessKey,
    dataQuality: { status: 'not_evaluated', note: '合成模拟；不称工业质量/压力/健康/现场收益/认证。' },
    authorization: EXECUTION_AUTHORIZATION,
    notes: ['短 ID/hash 非权限；权威绑定为完整 canonical。', 'Start 不加桶；advance 仅人工、写成功才发布。'],
  }
  const bad = assertFiniteDeep(envelope)
  if (bad) return { ok: false, envelope: null, reason: `非有限数值，拒绝送执行：${bad}` }
  return { ok: true, envelope: deepFreeze(envelope), reason: null }
}

function passengerEpoch(passport: DecisionPassport): number {
  return passport.epoch
}

function requireIdentity(env: ExecutionEnvelope): string | null {
  if (!bindingShapeOk(env.binding)) return 'binding shape 非法'
  if (!envelopeIdentityOk(env)) return '顶层身份/binding/link 不一致'
  return null
}

export function manualApprove(
  envelope: ExecutionEnvelope,
  opts: { operator: string; approvedAt: string; decisionId?: string; auditId?: string },
): { ok: boolean; envelope: ExecutionEnvelope | null; reason: string | null } {
  if (envelope.status !== 'verified') return { ok: false, envelope: null, reason: `状态 ${envelope.status} 不可批准` }
  if (!opts.operator) return { ok: false, envelope: null, reason: '缺少人工操作者' }
  const bad = requireIdentity(envelope)
  if (bad) return { ok: false, envelope: null, reason: bad }
  const l = envelope.decisionAuditLink
  if (l && (!l.decisionId || !l.auditId)) return { ok: false, envelope: null, reason: 'decision↔audit 关联不完整' }
  const decisionId = opts.decisionId ?? l?.decisionId ?? `qd-${shortHash(`${envelope.executionId}|decision`)}`
  const auditId = opts.auditId ?? l?.auditId ?? `qa-${shortHash(`${envelope.executionId}|audit`)}`
  if (!decisionId || !auditId) return { ok: false, envelope: null, reason: '空 decision/audit ID' }
  const link: DecisionAuditLink = {
    decisionId,
    auditId,
    action: 'approve',
    operator: opts.operator,
    at: opts.approvedAt,
    binding: { ...envelope.binding },
    syntheticOnly: true,
  }
  return {
    ok: true,
    envelope: deepFreeze({ ...envelope, status: 'approved', disposition: 'approved', approvedAt: opts.approvedAt, approvedBy: opts.operator, decisionAuditLink: link }),
    reason: null,
  }
}

export function rejectExecution(
  envelope: ExecutionEnvelope,
  opts: { operator: string; reason: string; at: string },
): { ok: boolean; envelope: ExecutionEnvelope | null; reason: string | null } {
  if (envelope.status === 'executing' || envelope.status === 'completed' || envelope.status === 'retired')
    return { ok: false, envelope: null, reason: `状态 ${envelope.status} 不可驳回` }
  const bad = requireIdentity(envelope)
  if (bad && envelope.disposition !== 'none') return { ok: false, envelope: null, reason: bad }
  const decisionId = envelope.decisionAuditLink?.decisionId ?? `qd-${shortHash(`${envelope.executionId}|reject`)}`
  const auditId = envelope.decisionAuditLink?.auditId ?? `qa-${shortHash(`${envelope.executionId}|reject-audit`)}`
  const link: DecisionAuditLink = {
    decisionId,
    auditId,
    action: 'reject',
    operator: opts.operator,
    at: opts.at,
    binding: { ...envelope.binding },
    syntheticOnly: true,
  }
  return {
    ok: true,
    envelope: deepFreeze({ ...envelope, status: 'rejected', disposition: 'rejected', rejectedReason: opts.reason, decisionAuditLink: link }),
    reason: null,
  }
}

export function startExecution(
  envelope: ExecutionEnvelope,
  opts: { commandId: string; startedAt: string },
): { ok: boolean; envelope: ExecutionEnvelope | null; reason: string | null; duplicate: boolean } {
  if (envelope.commandLog.includes(opts.commandId)) return { ok: true, envelope, reason: null, duplicate: true }
  if (envelope.status !== 'approved') return { ok: false, envelope: null, reason: `状态 ${envelope.status} 不可 Start`, duplicate: false }
  const bad = requireIdentity(envelope)
  if (bad) return { ok: false, envelope: null, reason: bad, duplicate: false }
  const l = envelope.decisionAuditLink
  if (!l || !l.decisionId || !l.auditId || l.action !== 'approve' || !bindingEquals(l.binding, envelope.binding))
    return { ok: false, envelope: null, reason: '批准关联/binding 不匹配，拒绝 Start', duplicate: false }
  if (envelope.consumed || envelope.retiredReason) return { ok: false, envelope: null, reason: '批准已消费/已退休，拒绝 Start', duplicate: false }
  return {
    ok: true,
    envelope: deepFreeze({ ...envelope, status: 'executing', consumed: true, startCommandId: opts.commandId, startedAt: opts.startedAt, commandLog: [...envelope.commandLog, opts.commandId] }),
    reason: null,
    duplicate: false,
  }
}

function integrate(envelope: ExecutionEnvelope, index: number): { entry: ExecutionLedgerEntry; cumulative: number } {
  const p = envelope.plan.periods[index]
  const byId = new Map(envelope.inputSnapshot.units.map((u) => [u.id, u]))
  let power = 0
  for (const id of p.runningUnitIds) {
    const unit = byId.get(id)
    const load = p.unitLoads[id]
    if (unit && typeof load === 'number' && Number.isFinite(load)) power += unitPower(unit, load)
  }
  const step = envelope.inputSnapshot.stepMinutes
  const energy = power * (step / 60)
  const cumulative = envelope.modelEnergyKwh + energy
  const decisionId = envelope.decisionAuditLink?.decisionId ?? ''
  const auditId = envelope.decisionAuditLink?.auditId ?? ''
  return {
    entry: {
      index,
      minuteOfDay: p.minuteOfDay,
      demand: p.demand,
      supply: p.supply,
      powerKw: power,
      energyKwh: energy,
      cumulativeEnergyKwh: cumulative,
      runningUnitIds: [...p.runningUnitIds],
      unitLoads: { ...p.unitLoads },
      switches: p.switches,
      receiptHash: shortHash(`${envelope.executionId}|${index}|${power}|${cumulative}|${envelope.binding.verificationId}`),
      executionId: envelope.executionId,
      verificationId: envelope.binding.verificationId,
      decisionId,
      auditId,
    },
    cumulative,
  }
}

export function advanceExecution(
  envelope: ExecutionEnvelope,
  opts: { commandId: string; executionId: string; executionEpoch: number; verificationId: string; expectedCursor: number; at: string },
): { ok: boolean; envelope: ExecutionEnvelope | null; reason: string | null; duplicate: boolean; completed: boolean } {
  if (envelope.commandLog.includes(opts.commandId)) return { ok: true, envelope, reason: null, duplicate: true, completed: envelope.status === 'completed' }
  if (opts.executionId !== envelope.executionId) return { ok: false, envelope: null, reason: 'executionId 不符，拒绝 advance', duplicate: false, completed: false }
  const bad = requireIdentity(envelope)
  if (bad) return { ok: false, envelope: null, reason: bad, duplicate: false, completed: false }
  if (envelope.status !== 'executing') return { ok: false, envelope: null, reason: `状态 ${envelope.status} 不可 advance`, duplicate: false, completed: false }
  if (envelope.executionEpoch !== opts.executionEpoch || envelope.binding.verificationId !== opts.verificationId)
    return { ok: false, envelope: null, reason: '执行 epoch/身份不符，拒绝 advance', duplicate: false, completed: false }
  if (opts.expectedCursor !== envelope.cursor)
    return { ok: false, envelope: null, reason: `expectedCursor ${opts.expectedCursor} ≠ 当前 ${envelope.cursor}（跳桶/旧实例）`, duplicate: false, completed: false }
  if (envelope.cursor >= envelope.plan.periods.length)
    return { ok: false, envelope: null, reason: '已到窗口末端', duplicate: false, completed: true }

  const { entry, cumulative } = integrate(envelope, envelope.cursor)
  const nextCursor = envelope.cursor + 1
  const completed = nextCursor >= envelope.plan.periods.length
  const next: ExecutionEnvelope = {
    ...envelope,
    status: completed ? 'completed' : 'executing',
    ledger: [...envelope.ledger, entry],
    cursor: nextCursor,
    modelEnergyKwh: cumulative,
    lastChange: replayLastChange(envelope.inputSnapshot, envelope.plan, nextCursor),
    commandLog: [...envelope.commandLog, opts.commandId],
  }
  return { ok: true, envelope: deepFreeze(next), reason: null, duplicate: false, completed }
}

export function pauseExecution(
  envelope: ExecutionEnvelope,
  commandId: string,
): { ok: boolean; envelope: ExecutionEnvelope | null; reason: string | null; duplicate: boolean } {
  if (envelope.commandLog.includes(commandId)) return { ok: true, envelope, reason: null, duplicate: true }
  if (envelope.status !== 'executing') return { ok: false, envelope: null, reason: `状态 ${envelope.status} 不可 Pause`, duplicate: false }
  const bad = requireIdentity(envelope)
  if (bad) return { ok: false, envelope: null, reason: bad, duplicate: false }
  return { ok: true, envelope: deepFreeze({ ...envelope, status: 'paused', commandLog: [...envelope.commandLog, commandId] }), reason: null, duplicate: false }
}

export function resumeExecution(
  envelope: ExecutionEnvelope,
  commandId: string,
): { ok: boolean; envelope: ExecutionEnvelope | null; reason: string | null; duplicate: boolean } {
  if (envelope.commandLog.includes(commandId)) return { ok: true, envelope, reason: null, duplicate: true }
  if (envelope.status !== 'paused') return { ok: false, envelope: null, reason: `状态 ${envelope.status} 不可 Resume`, duplicate: false }
  const bad = requireIdentity(envelope)
  if (bad) return { ok: false, envelope: null, reason: bad, duplicate: false }
  return { ok: true, envelope: deepFreeze({ ...envelope, status: 'executing', commandLog: [...envelope.commandLog, commandId] }), reason: null, duplicate: false }
}

export function retireExecution(
  envelope: ExecutionEnvelope,
  reason: string,
): { ok: boolean; envelope: ExecutionEnvelope | null; reason: string | null } {
  if (envelope.status === 'retired') return { ok: true, envelope, reason: null }
  return { ok: true, envelope: deepFreeze({ ...envelope, status: 'retired', retiredReason: reason }), reason: null }
}

export function changeRequiresRetire(
  envelope: ExecutionEnvelope,
  current: { source: string; generator: string; ruleVersion: string; inputCanonical: string; canonicalId: string },
): string | null {
  const fp = executionFingerprint(current)
  if (fp !== envelope.fingerprint) return '输入/来源/规则/执行候选发生变化，需退休并重新送审'
  return null
}

// ---- 严格 ledger 重放 + envelope 校验 ----

function replayLedger(envelope: ExecutionEnvelope): string | null {
  const snap = envelope.inputSnapshot
  const plan = envelope.plan
  if (!Array.isArray(plan.periods) || plan.periods.length !== 96) return 'plan-window'
  const byId = new Map(snap.units.map((u) => [u.id, u]))
  let cum = 0
  const prev: Record<string, number> = {}
  for (let i = 0; i < envelope.ledger.length; i += 1) {
    const e = envelope.ledger[i]
    const p = plan.periods[i]
    prev[i] = 0
    if (e.index !== i) return `ledger-index:${i}`
    if (e.minuteOfDay !== p.minuteOfDay) return `ledger-minute:${i}`
    const rs = [...e.runningUnitIds].sort().join(',')
    const ps = [...p.runningUnitIds].sort().join(',')
    if (rs !== ps) return `ledger-running:${i}`
    if (Math.abs(e.demand - p.demand) > EXEC_TOLERANCE || Math.abs(e.supply - p.supply) > EXEC_TOLERANCE)
      return `ledger-declared:${i}`
    let power = 0
    for (const id of p.runningUnitIds) {
      const u = byId.get(id)
      const load = e.unitLoads?.[id]
      if (u && typeof load === 'number' && Number.isFinite(load) && Math.abs(load - (p.unitLoads[id] ?? NaN)) <= EXEC_TOLERANCE)
        power += unitPower(u, load)
      else return `ledger-load:${i}`
    }
    const energy = power * (snap.stepMinutes / 60)
    cum += energy
    if (Math.abs(e.powerKw - power) > EXEC_TOLERANCE) return `ledger-power:${i}`
    if (Math.abs(e.energyKwh - energy) > EXEC_TOLERANCE) return `ledger-energy:${i}`
    if (Math.abs(e.cumulativeEnergyKwh - cum) > EXEC_TOLERANCE) return `ledger-cumulative:${i}`
    const hash = shortHash(`${envelope.executionId}|${i}|${power}|${cum}|${envelope.binding.verificationId}`)
    if (e.receiptHash !== hash) return `ledger-receipt:${i}`
    if (e.executionId !== envelope.executionId || e.verificationId !== envelope.binding.verificationId)
      return `ledger-binding:${i}`
    if ((envelope.decisionAuditLink?.decisionId ?? '') !== '' && e.decisionId !== envelope.decisionAuditLink?.decisionId)
      return `ledger-decision:${i}`
  }
  return null
}

export function validateStoredEnvelope(raw: unknown): { ok: boolean; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not-object' }
  const env = raw as ExecutionEnvelope
  if (env.schema !== EXECUTION_SCHEMA) return { ok: false, reason: 'schema' }
  if (env.envelopeVersion !== EXECUTION_ENVELOPE_VERSION) return { ok: false, reason: 'envelope-version' }
  if (typeof env.executionId !== 'string' || !env.executionId) return { ok: false, reason: 'executionId' }
  if (!bindingShapeOk(env.binding)) return { ok: false, reason: 'binding-shape' }
  if (!envelopeIdentityOk(env)) return { ok: false, reason: 'identity-mismatch' }
  if (!env.receipt || typeof env.receipt !== 'object') return { ok: false, reason: 'receipt' }
  if (env.receipt.strategy !== env.strategy) return { ok: false, reason: 'receipt-strategy' }
  if (!env.receipt.verifierVersion || !env.receipt.ruleVersion || !env.receipt.objectiveVersion)
    return { ok: false, reason: 'receipt-versions' }
  if (!env.receipt.constraints || env.receipt.constraints.complete !== true || env.receipt.constraints.hasSolution !== true)
    return { ok: false, reason: 'receipt-incomplete' }
  if (!Array.isArray(env.ledger)) return { ok: false, reason: 'ledger' }
  if (typeof env.cursor !== 'number' || env.cursor !== env.ledger.length) return { ok: false, reason: 'cursor-ledger' }
  if (env.cursor > 96) return { ok: false, reason: 'cursor-range' }
  if (typeof env.modelEnergyKwh !== 'number' || !Number.isFinite(env.modelEnergyKwh)) return { ok: false, reason: 'modelEnergy' }
  if (!Array.isArray(env.commandLog)) return { ok: false, reason: 'commandLog' }
  if (!env.inputSnapshot || !Array.isArray(env.inputSnapshot.points) || env.inputSnapshot.points.length !== 96)
    return { ok: false, reason: 'snapshot-buckets' }
  if (!env.plan || !Array.isArray(env.plan.periods)) return { ok: false, reason: 'plan' }
  // lastChange 与重放一致
  const expectedLast = replayLastChange(env.inputSnapshot, env.plan, env.cursor)
  if (!lastChangeEqual(expectedLast, env.lastChange ?? {})) return { ok: false, reason: 'lastChange-mismatch' }
  // ledger 重放
  const lr = replayLedger(env)
  if (lr) return { ok: false, reason: lr }
  if (env.ledger.length > 0) {
    const last = env.ledger[env.ledger.length - 1]
    if (Math.abs(env.modelEnergyKwh - last.cumulativeEnergyKwh) > EXEC_TOLERANCE) return { ok: false, reason: 'modelEnergy-cumulative' }
  } else if (env.modelEnergyKwh !== 0) return { ok: false, reason: 'modelEnergy-zero' }
  const finite = assertFiniteDeep(env)
  if (finite) return { ok: false, reason: `non-finite:${finite}` }
  return { ok: true, reason: 'ok' }
}

// ---- versioned 本地存储 ----

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
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

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

export function loadExecutionStore(storage?: StorageLike | null): ExecutionStoreSnapshot {
  const store = resolveStorage(storage)
  const snap: ExecutionStoreSnapshot = { envelopes: [], raw: null, writable: true, corrupted: false, warnings: [] }
  if (!store) {
    snap.writable = false
    snap.warnings.push('当前环境没有可用的本地存储；执行只读展示，未持久化。')
    return snap
  }
  let raw: string | null = null
  try {
    raw = store.getItem(EXECUTION_STORE_KEY)
  } catch {
    snap.writable = false
    snap.warnings.push('读取执行存储被拒绝；只读展示，未持久化。')
    return snap
  }
  snap.raw = raw
  if (raw === null) return snap
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    snap.corrupted = true
    snap.writable = false
    snap.warnings.push('执行存储 JSON 损坏：保留原文、不混旧 AuditKind、不覆盖。')
    return snap
  }
  if (!isObject(parsed) || parsed.schemaVersion !== EXECUTION_ENVELOPE_VERSION || !Array.isArray(parsed.envelopes)) {
    snap.corrupted = true
    snap.writable = false
    snap.warnings.push('执行存储 envelope/schemaVersion 未知：保留原文、不覆盖。')
    return snap
  }
  const ids = new Set<string>()
  let bad = 0
  for (const item of parsed.envelopes) {
    const check = validateStoredEnvelope(item)
    const id = isObject(item) && typeof item.executionId === 'string' ? item.executionId : ''
    if (!check.ok || !id || ids.has(id)) {
      bad += 1
      continue
    }
    ids.add(id)
    snap.envelopes.push(deepFreeze(deepClone(item as unknown as ExecutionEnvelope)))
  }
  if (bad > 0) {
    snap.corrupted = true
    snap.writable = false
    snap.warnings.push(`执行存储有 ${bad} 条损坏/重复/假账本记录：保留原文、writable=false、不覆盖。`)
  }
  return snap
}

export function saveExecutionEnvelope(
  envelope: ExecutionEnvelope,
  storage?: StorageLike | null,
  opts?: { expectedRevision?: number; expected?: ExecutionEnvelope },
): { ok: boolean; bytes: number; error?: string; overCapacity?: boolean } {
  const store = resolveStorage(storage)
  if (!store) return { ok: false, bytes: 0, error: '当前环境没有可用的本地存储' }
  const existing = loadExecutionStore(store)
  if (!existing.writable || existing.corrupted)
    return { ok: false, bytes: 0, error: '执行存储已损坏或被拒，保持只读，拒绝写入/覆盖原文' }
  const selfCheck = validateStoredEnvelope(envelope)
  if (!selfCheck.ok) return { ok: false, bytes: 0, error: `执行记录校验未通过：${selfCheck.reason}` }
  const idx = existing.envelopes.findIndex((e) => e.executionId === envelope.executionId)
  const persisted = idx >= 0 ? existing.envelopes[idx] : null
  if (persisted) {
    // 显式 revision 门：必须与调用方捕获的 expectedRevision 精确相等，且新记录 revision = 旧+1。
    if (opts?.expectedRevision !== undefined && persisted.revision !== opts.expectedRevision)
      return { ok: false, bytes: 0, error: `revision 冲突：持久 ${persisted.revision} ≠ 期望 ${opts.expectedRevision}` }
    if (opts?.expected !== undefined && !protectedEqual(persisted, opts.expected))
      return { ok: false, bytes: 0, error: '持久同 ID 完整内容已变化，拒绝覆盖' }
    if (envelope.revision !== persisted.revision + 1)
      return { ok: false, bytes: 0, error: `新 revision ${envelope.revision} ≠ 旧+1 ${persisted.revision + 1}` }
  } else if (opts?.expectedRevision !== undefined) {
    return { ok: false, bytes: 0, error: '持久层无同 ID 记录，拒绝按 expectedRevision 更新' }
  }
  const next = idx >= 0 ? existing.envelopes.map((e, i) => (i === idx ? envelope : e)) : [...existing.envelopes, envelope]
  const text = JSON.stringify({ schemaVersion: EXECUTION_ENVELOPE_VERSION, savedAt: new Date().toISOString(), envelopes: next })
  const bytes = byteLength(text)
  if (bytes > EXECUTION_CAPACITY_BYTES) return { ok: false, bytes, overCapacity: true, error: '超出执行存储容量上限，请先导出（不自动删旧）' }
  try {
    store.setItem(EXECUTION_STORE_KEY, text)
    return { ok: true, bytes }
  } catch (error) {
    return { ok: false, bytes, error: error instanceof Error ? error.message : '执行写入失败（无部分提交，保留 raw 与 prefix）' }
  }
}

export function exportExecutionJson(envelope: ExecutionEnvelope): string {
  const bad = assertFiniteDeep(envelope)
  if (bad) throw new Error(`拒绝导出：非有限数值 ${bad}`)
  return JSON.stringify(envelope, null, 2)
}

// ---- 上层持久 controller（单例；与 Panel 生命周期解耦） ----

export interface ExecutionBusinessContext {
  /** 业务身份键（场景/模式/参数/资格故障/规则等由上层汇总）；观察/视图变化不得进入。 */
  businessKey: string
  invalid?: boolean
}

const ACTIVE_STATUSES: ExecutionStatus[] = ['verified', 'approved', 'executing', 'paused']

/**
 * 完整受保护内容一致：逐字段深比较整个 envelope（plan/input/receipt/approval/ledger/businessKey 等），
 * 忽略 store 外壳 savedAt 与 JSON 对象键顺序（按 key 集合比对）。
 */
export function protectedEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) if (!protectedEqual(a[i], b[i])) return false
    return true
  }
  const ka = Object.keys(a as Record<string, unknown>)
  const kb = Object.keys(b as Record<string, unknown>)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!protectedEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

export class ExecutionController {
  private latest: ExecutionEnvelope | null = null
  private listeners = new Set<() => void>()
  private warnings: string[] = []
  private context: ExecutionBusinessContext = { businessKey: '' }
  private safetyRetired = false
  private pendingSaveReason: string | null = null

  constructor(private storage?: StorageLike | null) {
    this.restore()
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', (e: StorageEvent) => {
        if (e.key !== EXECUTION_STORE_KEY && e.key !== null) return
        this.failClosedOnExternalWrite()
      })
    }
  }

  /** 相关 storage 事件：先内存 fail-closed 永久停权，再尝试保存；写失败保留告警，存储恢复也不复活。 */
  failClosedOnExternalWrite(): void {
    this.failClosedRetire('storage 事件：外部写入，fail-closed 永久退休')
  }

  /** 必须退休路径：先内存 fail-closed，再尝试持久；不以 persist 成功为停步前提。 */
  private failClosedRetire(reason: string): void {
    if (!this.latest) return
    const base = this.latest
    // 已 retired：仅当持久完整同值且无未保存/冲突时幂等 no-op（不写/不增 revision/不制造 pending）；
    // 旧 pending / 外写异内容 / 缺持久 / quota 一律继续 fail-closed，不假清。
    if (base.status === 'retired') {
      this.safetyRetired = true
      const snap0 = loadExecutionStore(this.storage)
      const persisted0 = snap0.envelopes.find((e) => e.executionId === base.executionId)
      const same = Boolean(persisted0 && protectedEqual(persisted0, base))
      if (same && this.pendingSaveReason === null) {
        this.emit()
        return
      }
      if (this.pendingSaveReason === null) {
        this.pendingSaveReason = persisted0 ? '冲突：持久内容与退休态不一致，未覆盖 raw' : '退休态缺持久记录，未写入'
        this.warnings.push(this.pendingSaveReason)
      }
      this.emit()
      return
    }
    if (ACTIVE_STATUSES.includes(base.status)) {
      this.latest = deepFreeze({ ...base, status: 'retired', retiredReason: reason, revision: base.revision + 1 }) as ExecutionEnvelope
    }
    this.safetyRetired = true
    this.pendingSaveReason = reason
    this.emit()
    // 冲突保护：若持久同 ID 内容已被外部改变，绝不写入退休态覆盖其 raw。
    const snap = loadExecutionStore(this.storage)
    const persisted = snap.envelopes.find((e) => e.executionId === base.executionId)
    if (persisted && !protectedEqual(persisted, base)) {
      this.pendingSaveReason = '冲突：持久同 ID 内容已变化，未覆盖 raw，内存已永久停权'
      this.warnings.push(this.pendingSaveReason)
      return
    }
    const saved = saveExecutionEnvelope(this.latest, this.storage, { expectedRevision: base.revision, expected: base })
    if (!saved.ok) {
      this.pendingSaveReason = `退休未保存（保留 prefix/raw）：${saved.error}`
      this.warnings.push(this.pendingSaveReason)
    } else {
      this.pendingSaveReason = null
    }
  }

  /** 刷新恢复：活动状态只读证据并退休；completed/retired 保留；保存失败不得回退未退休状态。 */
  private restore(): void {
    const snap = loadExecutionStore(this.storage)
    this.warnings.push(...snap.warnings)
    if (snap.envelopes.length === 0) return
    let mostRecent = snap.envelopes[0]
    for (const e of snap.envelopes) if (e.revision >= mostRecent.revision) mostRecent = e
    let restored: ExecutionEnvelope = mostRecent
    if (ACTIVE_STATUSES.includes(mostRecent.status)) {
      restored = deepFreeze({ ...mostRecent, status: 'retired', retiredReason: '刷新恢复：只读证据并退休，需新 epoch 重新送审', revision: mostRecent.revision + 1 }) as ExecutionEnvelope
      this.safetyRetired = true
      const saved = saveExecutionEnvelope(restored, this.storage, { expectedRevision: mostRecent.revision, expected: mostRecent })
      if (!saved.ok) {
        this.pendingSaveReason = `刷新退休写失败（内存已退休，保留 prefix）：${saved.error}`
        this.warnings.push(this.pendingSaveReason)
      }
    }
    // 绝不从存储回退未退休 mostRecent。
    this.latest = deepFreeze(deepClone(restored))
  }

  /**
   * 命令前核持久同 ID 最新 revision/强身份/最新处置：
   * 与本次 captured 内存快照精确一致才允许；否则 adopt 持久（fail-closed）并拒绝。
   * 该读写 guard 不等于跨标签事务。
   */
  /**
   * 命令门：捕获的旧 envelope 与最新持久同 ID 记录必须完整受保护内容一致（protectedEqual），
   * 且 revision 一致；否则立即内存永久停权（保留已提交 prefix/模型能量），不覆盖变化 raw，拒绝旧命令。
   * 该读写 guard 不等于跨标签事务。
   */
  private expectedGate():
    | { ok: true; revision: number; snapshot: ExecutionEnvelope }
    | { ok: false; reason: string } {
    if (!this.latest) return { ok: false, reason: '无执行' }
    if (!ACTIVE_STATUSES.includes(this.latest.status)) return { ok: false, reason: '当前执行非活动状态，拒绝命令' }
    const snap = loadExecutionStore(this.storage)
    const persisted = snap.envelopes.find((e) => e.executionId === this.latest!.executionId)
    if (!persisted) return { ok: false, reason: '持久层无同 ID 记录，拒绝命令' }
    if (persisted.revision !== this.latest.revision || !protectedEqual(persisted, this.latest)) {
      // 外部已改变任一并持久内容 → 内存永久停权；绝不 adopt 活动持久记录，也绝不覆盖 raw。
      const base = this.latest
      this.latest = deepFreeze({ ...base, status: 'retired', retiredReason: '持久同 ID 内容已变化，拒绝旧命令并永久停权', revision: base.revision + 1 }) as ExecutionEnvelope
      this.safetyRetired = true
      this.pendingSaveReason = '冲突：持久同 ID 内容已变化，未覆盖 raw，内存已永久停权'
      this.warnings.push(this.pendingSaveReason)
      this.emit()
      return { ok: false, reason: '持久同 ID 完整内容已变化，拒绝旧命令' }
    }
    return { ok: true, revision: persisted.revision, snapshot: persisted }
  }

  private guardBusiness(): string | null {
    if (!this.latest || !ACTIVE_STATUSES.includes(this.latest.status)) return null
    if (this.context.invalid) return '输入无效/故障，立即停步永久退休'
    if (this.context.businessKey && this.context.businessKey !== this.latest.businessKey)
      return '业务上下文（场景/模式/参数/资格/规则）变化，立即停步永久退休'
    return null
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const fn of this.listeners) fn()
  }
  getLatest(): ExecutionEnvelope | null {
    return this.latest
  }
  getWarnings(): string[] {
    return [...this.warnings]
  }
  getPendingSaveReason(): string | null {
    return this.pendingSaveReason
  }
  isSafetyRetired(): boolean {
    return this.safetyRetired
  }
  setBusinessContext(ctx: ExecutionBusinessContext): void {
    this.context = ctx
    const reason = this.guardBusiness()
    if (reason) this.failClosedRetire(reason)
  }
  private commit(next: ExecutionEnvelope, action: string, expected: ExecutionEnvelope): boolean {
    const withRevision: ExecutionEnvelope = deepFreeze({ ...next, revision: expected.revision + 1 })
    const saved = saveExecutionEnvelope(withRevision, this.storage, { expectedRevision: expected.revision, expected })
    if (!saved.ok) {
      this.warnings.push(`${action} 写入失败：${saved.error}（未发布，保留 raw 与 prefix）`)
      return false
    }
    this.latest = withRevision
    this.emit()
    return true
  }
  admit(passport: DecisionPassport, candidateId: string, executionEpoch: number, capturedAt: string): AdmitResult {
    const r = admitPassportCandidate(passport, candidateId, executionEpoch, capturedAt, this.context.businessKey)
    if (r.ok && r.envelope) {
      const saved = saveExecutionEnvelope(r.envelope, this.storage)
      if (!saved.ok) {
        this.warnings.push(`admit 写入失败：${saved.error}（未发布）`)
        return { ok: false, envelope: null, reason: 'admit 写失败' }
      }
      this.latest = r.envelope
      this.safetyRetired = false
      this.pendingSaveReason = null
      this.emit()
    }
    return r
  }
  approve(opts: { operator: string; approvedAt: string }): { ok: boolean; reason: string | null } {
    if (!this.latest) return { ok: false, reason: '无执行' }
    const g = this.guardBusiness()
    if (g) return { ok: false, reason: g }
    const gate = this.expectedGate()
    if (!gate.ok) return { ok: false, reason: gate.reason }
    const r = manualApprove(this.latest, opts)
    if (!r.ok || !r.envelope) return { ok: false, reason: r.reason }
    return this.commit(r.envelope, 'approve', gate.snapshot) ? { ok: true, reason: null } : { ok: false, reason: 'approve 写失败' }
  }
  reject(opts: { operator: string; reason: string; at: string }): { ok: boolean; reason: string | null } {
    if (!this.latest) return { ok: false, reason: '无执行' }
    const gate = this.expectedGate()
    if (!gate.ok) return { ok: false, reason: gate.reason }
    const r = rejectExecution(this.latest, opts)
    if (!r.ok || !r.envelope) return { ok: false, reason: r.reason }
    return this.commit(r.envelope, 'reject', gate.snapshot) ? { ok: true, reason: null } : { ok: false, reason: 'reject 写失败' }
  }
  start(opts: { commandId: string; startedAt: string }): { ok: boolean; reason: string | null; duplicate: boolean } {
    if (!this.latest) return { ok: false, reason: '无执行', duplicate: false }
    const g = this.guardBusiness()
    if (g) { this.failClosedRetire(g); return { ok: false, reason: g, duplicate: false } }
    const gate = this.expectedGate()
    if (!gate.ok) return { ok: false, reason: gate.reason, duplicate: false }
    const r = startExecution(this.latest, opts)
    if (!r.ok || !r.envelope) return { ok: false, reason: r.reason, duplicate: false }
    if (r.duplicate) return { ok: true, reason: null, duplicate: true }
    return this.commit(r.envelope, 'start', gate.snapshot) ? { ok: true, reason: null, duplicate: false } : { ok: false, reason: 'start 写失败', duplicate: false }
  }
  advance(opts: { commandId: string; executionEpoch: number; verificationId: string; expectedCursor: number; at: string }): { ok: boolean; reason: string | null; duplicate: boolean; completed: boolean } {
    if (!this.latest) return { ok: false, reason: '无执行', duplicate: false, completed: false }
    const g = this.guardBusiness()
    if (g) { this.failClosedRetire(g); return { ok: false, reason: g, duplicate: false, completed: false } }
    const gate = this.expectedGate()
    if (!gate.ok) return { ok: false, reason: gate.reason, duplicate: false, completed: false }
    // 用本次捕获的 expectedCursor，绝不用最新 cursor 替代。
    const r = advanceExecution(this.latest, { executionId: this.latest.executionId, commandId: opts.commandId, executionEpoch: opts.executionEpoch, verificationId: opts.verificationId, expectedCursor: opts.expectedCursor, at: opts.at })
    if (!r.ok || !r.envelope) return { ok: false, reason: r.reason, duplicate: false, completed: false }
    if (r.duplicate) return { ok: true, reason: null, duplicate: true, completed: r.completed }
    return this.commit(r.envelope, 'advance', gate.snapshot) ? { ok: true, reason: null, duplicate: false, completed: r.completed } : { ok: false, reason: 'advance 写失败', duplicate: false, completed: false }
  }
  pause(commandId: string): { ok: boolean; reason: string | null } {
    if (!this.latest) return { ok: false, reason: '无执行' }
    const gate = this.expectedGate()
    if (!gate.ok) return { ok: false, reason: gate.reason }
    const r = pauseExecution(this.latest, commandId)
    if (!r.ok || !r.envelope) return { ok: false, reason: r.reason }
    if (r.duplicate) return { ok: true, reason: null }
    return this.commit(r.envelope, 'pause', gate.snapshot) ? { ok: true, reason: null } : { ok: false, reason: 'pause 写失败' }
  }
  resume(commandId: string): { ok: boolean; reason: string | null } {
    if (!this.latest) return { ok: false, reason: '无执行' }
    const gate = this.expectedGate()
    if (!gate.ok) return { ok: false, reason: gate.reason }
    const r = resumeExecution(this.latest, commandId)
    if (!r.ok || !r.envelope) return { ok: false, reason: r.reason }
    if (r.duplicate) return { ok: true, reason: null }
    return this.commit(r.envelope, 'resume', gate.snapshot) ? { ok: true, reason: null } : { ok: false, reason: 'resume 写失败' }
  }
  retire(reason: string): { ok: boolean; reason: string | null } {
    if (!this.latest) return { ok: false, reason: '无执行' }
    this.failClosedRetire(reason)
    return { ok: true, reason: null }
  }
}

/** 模块级单例：跨路由卸载保留执行，不因 Panel 卸载退休。 */
export const executionController = new ExecutionController()
