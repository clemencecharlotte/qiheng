import { verifyPlanConstraints, VERIFIER_VERSION, type VerifyContext } from './constraints'
import { verifyLabPlanMetrics } from './lab'
import { RULE_VERSION } from './audit'
import {
  canonicalCandidate,
  canonicalPortfolioInput,
  deepClone,
  shortHash,
  snapshotToFixture,
  verifyCandidate,
  type PortfolioCandidate,
  type PortfolioInputSnapshot,
  type PortfolioMetrics,
  type PortfolioStrategy,
  type FeasibleDomain,
} from './portfolio'
import {
  FLOW_MILP_MODEL_VERSION,
  FLOW_MILP_OBJECTIVE_VERSION,
} from './optimizer/flowMilp'
import type { PlanResult } from './types'

/**
 * 决策护照（B02b）——独立 versioned 本地 envelope。
 * 一次真实规划 = 一份不可变封存记录；结构与旧 demo.store.v2 / AuditKind 完全分离。
 * 非认证/非执行授权；明确标注“尚未授权执行”。schema 校验不是防篡改或认证证明。
 */

export const PASSPORT_ENVELOPE_VERSION = 1
export const PASSPORT_SCHEMA = 'qiheng-passport-v1'
export const PASSPORT_STORE_KEY = 'qiheng.passport.store.v1'
export const PASSPORT_AUTHORIZATION = '尚未授权执行'
export const PASSPORT_CAPACITY_BYTES = 6_000_000
export const PASSPORT_VERSION = 'passport-b02b-v1'

export type PassportStatus = 'complete' | 'canceled' | 'failed'
export type ProducerKind = 'raw-producer' | 'adapted-plan'

export const STRATEGY_LABEL: Record<PortfolioStrategy, string> = {
  milp_weighted: 'MILP 加权连续流量',
  lab_energy_first: 'DP 能耗优先',
  lab_switch_first: 'DP 切换优先',
  conservative_rule: '保守规则',
}

const STRATEGIES: PortfolioStrategy[] = [
  'milp_weighted',
  'lab_energy_first',
  'lab_switch_first',
  'conservative_rule',
]

function objectiveOf(strategy: PortfolioStrategy): string {
  return strategy === 'milp_weighted' ? FLOW_MILP_OBJECTIVE_VERSION : strategy
}

function domainOf(strategy: PortfolioStrategy): FeasibleDomain {
  if (strategy === 'milp_weighted') return 'flow-milp'
  if (strategy === 'conservative_rule') return 'conservative-rule'
  return 'dp-lookahead'
}

function producerOf(strategy: PortfolioStrategy): { kind: ProducerKind; note: string } {
  if (strategy === 'milp_weighted')
    return { kind: 'raw-producer', note: 'HiGHS 连续流量 MILP 原始求解输出' }
  if (strategy === 'conservative_rule')
    return { kind: 'adapted-plan', note: '冻结保守规则输出 + 全机组翻转声明适配，非原始逐桶声明' }
  return { kind: 'raw-producer', note: '冻结 DP 求解器原始输出' }
}

export interface PassportVerification {
  evaluated: boolean
  ok: boolean | null
  notRunReason: string | null
  identity: { ok: boolean; canonicalMatch: boolean; reasons: string[] }
  constraints: {
    hasSolution: boolean
    passed: boolean
    complete: boolean
    violationCount: number
    byType: Record<string, number>
    violations: Array<{ periodIndex: number; periodLabel: string; type: string; unitId?: string; message: string }>
    verifierVersion: string
    ruleVersion: string
  } | null
  metrics: {
    ok: boolean
    mismatchCount: number
    mismatches: Array<{ field: string; periodIndex?: number; declared: number; recomputed: number }>
    recomputed: { totalEnergyKwh: number; totalSwitches: number; excessSupplyM3: number }
  } | null
  /** 原声明指标（独立字段，不修值；展示/合法取复算）。 */
  declaredMetrics: PortfolioMetrics
  recomputedMetrics: { totalEnergyKwh: number; totalSwitches: number; excessSupplyM3: number } | null
  declaredMatchesRecomputed: boolean
  /** B01 verifyCandidate 的拒绝原因（原证据）。 */
  b01RejectReasons: string[]
}

export interface PassportCandidateRecord {
  candidateId: string
  canonicalId: string
  strategy: PortfolioStrategy
  strategyLabel: string
  objectiveVersion: string
  domain: FeasibleDomain
  status: string
  planOrNull: PlanResult | null
  reasons: string[]
  /** 原 native 诊断：有限值原样，非有限以 { __nonFinite } 显式标记，不洗成 null。 */
  diagnostics: unknown
  producer: { kind: ProducerKind; note: string }
  originalInputIdentity: string
  b01Verdict: { legal: boolean; canonicalOk: boolean; batchId: number }
  verification: PassportVerification
  /**
   * 独立、有限原值的“拒绝证据一致性编码”。仅用于证明 rejected 记录的原值/原因自洽，
   * 不是安全资格、不称防篡改；通过候选仍走严格 canonical 校验。
   */
  evidenceConsistency: EvidenceConsistency
  /** 复算指标（展示/合法用）。 */
  metrics: { energyKwh: number | null; switches: number | null; excessSupplyM3: number | null }
}

export interface EvidenceConsistency {
  version: 'passport-evidence-v1'
  status: 'consistent' | 'rejected' | 'not_run'
  canonicalMatched: boolean
  evidenceHash: string
  note: string
}

interface EvidencePreimage {
  strategy: string
  inputCanonical: string
  claimedCanonicalId: string
  recomputedCanonicalId: string | null
  evaluated: boolean
  ok: boolean | null
  planPeriods: number | null
  declaredMetrics: PortfolioMetrics
  recomputedMetrics: { totalEnergyKwh: number; totalSwitches: number; excessSupplyM3: number } | null
  rejectReasons: string[]
}

function encodeEvidence(p: EvidencePreimage): EvidenceConsistency {
  const canonicalMatched =
    p.recomputedCanonicalId !== null && p.recomputedCanonicalId === p.claimedCanonicalId
  const status: EvidenceConsistency['status'] =
    p.evaluated === false ? 'not_run' : p.ok === true ? 'consistent' : 'rejected'
  const evidenceHash = shortHash(
    JSON.stringify({
      v: 'passport-evidence-v1',
      strategy: p.strategy,
      inputCanonical: p.inputCanonical,
      claimedCanonicalId: p.claimedCanonicalId,
      recomputedCanonicalId: p.recomputedCanonicalId,
      evaluated: p.evaluated,
      ok: p.ok,
      planPeriods: p.planPeriods,
      declaredMetrics: p.declaredMetrics,
      recomputedMetrics: p.recomputedMetrics,
      rejectReasons: p.rejectReasons,
    }),
  )
  return {
    version: 'passport-evidence-v1',
    status,
    canonicalMatched,
    evidenceHash,
    note: '证据一致性编码：仅证明 rejected 记录原值/原因自洽，不是安全资格，不称防篡改。',
  }
}

function evidenceFromRecordFields(
  snapshot: PortfolioInputSnapshot,
  record: {
    strategy: PortfolioStrategy
    originalInputIdentity: string
    canonicalId: string
    planOrNull: PlanResult | null
    verification: PassportVerification
  },
): EvidenceConsistency {
  const recomputed = canonicalCandidate(snapshotToFixture(snapshot), record.strategy, record.planOrNull ?? null)
  return encodeEvidence({
    strategy: record.strategy,
    inputCanonical: record.originalInputIdentity,
    claimedCanonicalId: record.canonicalId,
    recomputedCanonicalId: recomputed.ok ? recomputed.id : null,
    evaluated: record.verification.evaluated,
    ok: record.verification.ok,
    planPeriods: record.planOrNull ? record.planOrNull.periods.length : null,
    declaredMetrics: record.verification.declaredMetrics,
    recomputedMetrics: record.verification.recomputedMetrics,
    rejectReasons: record.verification.b01RejectReasons,
  })
}

function evidenceEquals(a: unknown, b: EvidenceConsistency): boolean {
  if (!a || typeof a !== 'object') return false
  const e = a as Record<string, unknown>
  return (
    e.version === b.version &&
    e.status === b.status &&
    e.canonicalMatched === b.canonicalMatched &&
    e.evidenceHash === b.evidenceHash
  )
}

export interface PassportReferences {
  passport: string
  input: string
  candidates: Array<{ candidateId: string; ref: string }>
  verifications: Array<{ candidateId: string; ref: string }>
}

export interface PassportDataQuality {
  status: 'not_evaluated'
  scope: string
  reasons: string[]
  unknownFields: Array<{ field: string; reason: string }>
}

export interface DecisionPassport {
  schema: typeof PASSPORT_SCHEMA
  envelopeVersion: number
  passportVersion: string
  passportId: string
  batchId: number
  epoch: number
  status: PassportStatus
  scenarioId: string
  scenarioLabel: string
  inputSource: string
  generator: string
  inputCanonical: string
  ruleVersion: string
  verifierVersion: string
  modelVersion: string
  objectiveVersion: string
  /** 生成捕获时间（非工业采集时刻）。 */
  captureStartedAt: string
  generatedAt: string
  sourceCollectionTime: 'unknown'
  sourceRange: { pointCount: number; stepMinutes: number; startMinute: number; endMinute: number }
  dataQuality: PassportDataQuality
  inputSnapshot: PortfolioInputSnapshot
  attempts: PassportCandidateRecord[]
  summary: { attempted: number; legal: number; rejected: number; notRun: number }
  references: PassportReferences
  authorization: string
  notes: string[]
}

export interface SealResult {
  ok: boolean
  passport: DecisionPassport | null
  reason: string | null
}

// ---- 有限性编码：拒绝 NaN/±Infinity，绝不静默洗成 null ----

const METRIC_EPS = 1e-9

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

export function sanitizeNonFinite(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : { __nonFinite: String(value) }
  }
  if (Array.isArray(value)) return value.map(sanitizeNonFinite)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeNonFinite(v)
    return out
  }
  return value
}

export function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length
  let bytes = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      i += 1
    } else bytes += 3
  }
  return bytes
}

// ---- 复验：身份 + 原独立 constraints/metrics，声明/复算分离 ----

function contextFromSnapshot(s: PortfolioInputSnapshot): VerifyContext {
  return {
    series: {
      seed: s.seed,
      scenario: 'normal',
      scenarioLabel: s.id,
      synthetic: true,
      stepMinutes: s.stepMinutes,
      points: s.points,
      note: PASSPORT_VERSION,
    },
    allUnits: s.units,
    evaluation: { candidates: s.candidates, eligibility: s.eligibility, excludedNotes: s.excludedNotes },
    initial: s.initial,
    faultUnitId: s.faultUnitId,
  }
}

function finiteNum(v: number | null): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function verifyRecord(c: PortfolioCandidate): PassportVerification {
  const declared: PortfolioMetrics = { ...c.metrics }
  if (!c.plan) {
    return {
      evaluated: false,
      ok: null,
      notRunReason: `not_run：无方案（status=${c.status}）${c.reasons.length ? `；${c.reasons.join('；')}` : ''}`,
      identity: { ok: false, canonicalMatch: false, reasons: ['no-plan'] },
      constraints: null,
      metrics: null,
      declaredMetrics: declared,
      recomputedMetrics: null,
      declaredMatchesRecomputed: false,
      b01RejectReasons: [...c.reasons],
    }
  }
  const verdict = verifyCandidate(c)
  const context = contextFromSnapshot(c.inputSnapshot)
  const cv = verifyPlanConstraints(c.plan, context)
  const mv = verifyLabPlanMetrics(c.plan, c.inputSnapshot.units, c.inputSnapshot.initial, c.inputSnapshot.stepMinutes)
  const rec = mv.recomputed
  const declaredMatches =
    finiteNum(declared.energyKwh) &&
    finiteNum(declared.switches) &&
    finiteNum(declared.excessSupplyM3) &&
    Math.abs(declared.energyKwh - rec.totalEnergyKwh) <= METRIC_EPS &&
    declared.switches === rec.totalSwitches &&
    Math.abs(declared.excessSupplyM3 - rec.excessSupplyM3) <= METRIC_EPS
  const identityOk = verdict.ok && c.canonicalOk && c.canonicalId.startsWith(c.inputIdentity)
  const ok =
    identityOk && cv.hasSolution && cv.complete && cv.passed && mv.ok && declaredMatches
  return {
    evaluated: true,
    ok,
    notRunReason: null,
    identity: { ok: identityOk, canonicalMatch: c.canonicalId.startsWith(c.inputIdentity), reasons: verdict.reasons },
    constraints: {
      hasSolution: cv.hasSolution,
      passed: cv.passed,
      complete: cv.complete,
      violationCount: cv.violationCount,
      byType: { ...cv.byType },
      violations: cv.violations.map((v) => ({
        periodIndex: v.periodIndex,
        periodLabel: v.periodLabel,
        type: v.type,
        unitId: v.unitId,
        message: v.message,
      })),
      verifierVersion: cv.verifierVersion,
      ruleVersion: cv.ruleVersion,
    },
    metrics: {
      ok: mv.ok,
      mismatchCount: mv.mismatches.length,
      mismatches: mv.mismatches.map((m) => ({
        field: m.field,
        periodIndex: m.periodIndex,
        declared: m.declared,
        recomputed: m.recomputed,
      })),
      recomputed: { ...rec },
    },
    declaredMetrics: declared,
    recomputedMetrics: { ...rec },
    declaredMatchesRecomputed: declaredMatches,
    b01RejectReasons: verdict.reasons,
  }
}

function recordOf(c: PortfolioCandidate): PassportCandidateRecord {
  const verification = verifyRecord(c)
  const recomputed = verification.recomputedMetrics
  const base = {
    candidateId: c.candidateId,
    canonicalId: c.canonicalId,
    strategy: c.strategy,
    strategyLabel: STRATEGY_LABEL[c.strategy],
    objectiveVersion: c.objectiveVersion,
    domain: c.domain,
    status: c.status,
    planOrNull: c.plan,
    reasons: [...c.reasons],
    diagnostics: c.diagnostics ? sanitizeNonFinite(c.diagnostics) : null,
    producer: producerOf(c.strategy),
    originalInputIdentity: c.inputIdentity,
    b01Verdict: { legal: verification.ok === true, canonicalOk: c.canonicalOk, batchId: c.batchId },
    verification,
    metrics: {
      energyKwh: recomputed ? recomputed.totalEnergyKwh : null,
      switches: recomputed ? recomputed.totalSwitches : null,
      excessSupplyM3: recomputed ? recomputed.excessSupplyM3 : null,
    },
  }
  return { ...base, evidenceConsistency: evidenceFromRecordFields(c.inputSnapshot, base) }
}

// ---- 深冻结 ----

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  }
  return value
}

export function newPassportId(now = Date.now()): string {
  const rnd =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10)
  return `qp-${now.toString(36)}-${rnd}`
}

/** 生成未完成策略的显式占位 attempt（not_run，不丢行）。 */
export function makeUnfinishedAttempt(
  draft: { epoch: number; inputCanonical: string; inputSnapshot: PortfolioInputSnapshot },
  strategy: PortfolioStrategy,
): PortfolioCandidate {
  const fixture = snapshotToFixture(draft.inputSnapshot)
  const canonical = canonicalCandidate(fixture, strategy, null)
  return {
    candidateId: shortHash(`${draft.inputCanonical}|${strategy}|not_run`),
    canonicalId: canonical.id,
    canonicalOk: canonical.ok,
    canonicalReason: canonical.reason,
    inputIdentity: canonical.inputIdentity,
    inputSnapshot: draft.inputSnapshot,
    batchId: draft.epoch,
    strategy,
    objectiveVersion: objectiveOf(strategy),
    domain: domainOf(strategy),
    plan: null,
    verified: false,
    metricsOk: false,
    metrics: { energyKwh: null, switches: null, excessSupplyM3: null },
    status: 'not_run',
    reasons: ['生成未完成即取消/离页/失败，未运行该策略'],
    diagnostics: null,
  }
}

export interface SealArgs {
  epoch: number
  inputSnapshot: PortfolioInputSnapshot
  /** 生成开始时捕获的精确输入 canonical。 */
  inputCanonical: string
  attempts: PortfolioCandidate[]
  status: PassportStatus
  startedAt: string
  scenarioId?: string
  scenarioLabel?: string
  passportId?: string
  now?: number
}

export function sealPortfolioPassport(args: SealArgs): SealResult {
  const generatedAt = new Date(args.now ?? Date.now()).toISOString()
  const passportId = args.passportId ?? newPassportId(args.now)

  if (!args.inputCanonical) return { ok: false, passport: null, reason: '缺少输入 canonical，拒绝封存' }
  if (args.attempts.length === 0) return { ok: false, passport: null, reason: '无候选 attempt，拒绝封存' }
  if (args.attempts.length > STRATEGIES.length)
    return { ok: false, passport: null, reason: `attempt 超过 ${STRATEGIES.length} 条，拒绝封存` }

  // 先校验原输入/计划/指标有限值，再深复制（防 JSON clone 洗 NaN）。
  const finite = assertFiniteDeep({
    inputSnapshot: args.inputSnapshot,
    attempts: args.attempts.map((a) => ({ plan: a.plan, metrics: a.metrics, reasons: a.reasons })),
  })
  if (finite) return { ok: false, passport: null, reason: `非有限数值，拒绝封存：${finite}` }

  const expectedInput = canonicalPortfolioInput(snapshotToFixture(args.inputSnapshot)).id
  if (!expectedInput || expectedInput !== args.inputCanonical)
    return { ok: false, passport: null, reason: '输入快照与 inputCanonical 不一致，拒绝封存' }

  const seenStrategy = new Set<PortfolioStrategy>()
  const seenCandidate = new Set<string>()
  for (const a of args.attempts) {
    if (a.batchId !== args.epoch)
      return { ok: false, passport: null, reason: `代次不一致（${a.strategy} batch=${a.batchId}≠${args.epoch}），拒绝混封` }
    if (a.inputIdentity !== args.inputCanonical)
      return { ok: false, passport: null, reason: `输入不一致（${a.strategy}），拒绝混封` }
    const aInput = canonicalPortfolioInput(snapshotToFixture(a.inputSnapshot)).id
    if (aInput !== args.inputCanonical)
      return { ok: false, passport: null, reason: `候选快照身份不一致（${a.strategy}），拒绝混封` }
    if (seenStrategy.has(a.strategy))
      return { ok: false, passport: null, reason: `重复策略 ${a.strategy}，拒绝封存` }
    seenStrategy.add(a.strategy)
    if (seenCandidate.has(a.candidateId))
      return { ok: false, passport: null, reason: `重复 candidateId ${a.candidateId}，拒绝封存` }
    seenCandidate.add(a.candidateId)
  }

  const records = args.attempts.map((c) => recordOf(c))
  const points = args.inputSnapshot.points
  const startMinute = points.length ? points[0].minuteOfDay : 0
  const endMinute = points.length ? points[points.length - 1].minuteOfDay : 0
  const legal = records.filter((r) => r.verification.ok === true).length
  const notRun = records.filter((r) => r.verification.evaluated === false).length
  const references: PassportReferences = {
    passport: passportId,
    input: `${passportId}#input`,
    candidates: records.map((r) => ({ candidateId: r.candidateId, ref: `${passportId}#candidate:${r.candidateId}` })),
    verifications: records.map((r) => ({
      candidateId: r.candidateId,
      ref: `${passportId}#verify:${r.candidateId}`,
    })),
  }
  const digest = shortHash(
    [passportId, args.inputSnapshot.id, records.map((r) => r.canonicalId).sort().join('&')].join('||'),
  )
  const passport: DecisionPassport = {
    schema: PASSPORT_SCHEMA,
    envelopeVersion: PASSPORT_ENVELOPE_VERSION,
    passportVersion: PASSPORT_VERSION,
    passportId,
    batchId: args.epoch,
    epoch: args.epoch,
    status: args.status,
    scenarioId: args.scenarioId ?? args.inputSnapshot.id,
    scenarioLabel: args.scenarioLabel ?? args.inputSnapshot.id,
    inputSource: args.inputSnapshot.source,
    generator: args.inputSnapshot.generator,
    inputCanonical: args.inputCanonical,
    ruleVersion: RULE_VERSION,
    verifierVersion: VERIFIER_VERSION,
    modelVersion: FLOW_MILP_MODEL_VERSION,
    objectiveVersion: FLOW_MILP_OBJECTIVE_VERSION,
    captureStartedAt: args.startedAt,
    generatedAt,
    sourceCollectionTime: 'unknown',
    sourceRange: {
      pointCount: points.length,
      stepMinutes: args.inputSnapshot.stepMinutes,
      startMinute,
      endMinute,
    },
    dataQuality: {
      status: 'not_evaluated',
      scope: '未对本次规划输入评估质量；回放/历史质量结论不粘贴到本护照。',
      reasons: [
        '已知全天需求为合成 development 输入，不是预测。',
        '本护照不评估压力合格/现场节能/健康真值。',
      ],
      unknownFields: [
        { field: 'predictionInterval', reason: '未做预测，无区间' },
        { field: 'pressureQualification', reason: '未在规划输入上评估压力合格' },
        { field: 'fieldEnergySaving', reason: '无现场实测节能数据' },
        { field: 'healthGroundTruth', reason: '无健康真值' },
        { field: 'operatorRealName', reason: '不采集操作者实名' },
      ],
    },
    inputSnapshot: deepClone(args.inputSnapshot),
    attempts: records,
    summary: {
      attempted: records.length,
      legal,
      rejected: records.length - legal - notRun,
      notRun,
    },
    references,
    authorization: PASSPORT_AUTHORIZATION,
    notes: [
      `passport digest ${digest}`,
      'captureStartedAt 为生成捕获时间，非工业采集时刻；来源采集时间为 unknown。',
      '冻结对象/ schema 校验不是防篡改或认证证明。',
      '旧批准/审计仅在真实双向关联且精确匹配时作历史证据，不升级为执行授权。',
    ],
  }
  const bad = assertFiniteDeep(passport)
  if (bad) return { ok: false, passport: null, reason: `非有限数值，拒绝封存：${bad}` }
  return { ok: true, passport: deepFreeze(passport), reason: null }
}

/** 结构化证据解析：只允许指向封存护照内部对象，绝不解析当前 run。 */
export function resolvePassportRef(
  passport: DecisionPassport,
  ref: string,
): { kind: 'input' | 'candidate' | 'verification'; found: boolean } {
  if (!ref.startsWith(`${passport.passportId}#`)) return { kind: 'input', found: false }
  if (ref === passport.references.input) return { kind: 'input', found: true }
  const cand = passport.references.candidates.find((c) => c.ref === ref)
  if (cand) return { kind: 'candidate', found: passport.attempts.some((a) => a.candidateId === cand.candidateId) }
  const ver = passport.references.verifications.find((v) => v.ref === ref)
  if (ver) return { kind: 'verification', found: passport.attempts.some((a) => a.candidateId === ver.candidateId) }
  return { kind: 'candidate', found: false }
}

// ---- versioned 本地存储（独立于 demo.store.v2） ----

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

/** 严格校验一条护照记录：shape + 96 桶有限输入 + canonical 绑定 + 引用/summary/回执一致。 */
export function validateStoredPassport(raw: unknown): { ok: boolean; reason: string } {
  if (!isObject(raw)) return { ok: false, reason: 'not-object' }
  if (raw.schema !== PASSPORT_SCHEMA) return { ok: false, reason: 'schema' }
  if (raw.envelopeVersion !== PASSPORT_ENVELOPE_VERSION) return { ok: false, reason: 'envelope-version' }
  if (typeof raw.passportId !== 'string' || !raw.passportId) return { ok: false, reason: 'passportId' }
  if (typeof raw.inputCanonical !== 'string' || !raw.inputCanonical) return { ok: false, reason: 'inputCanonical' }
  if (typeof raw.batchId !== 'number') return { ok: false, reason: 'batchId' }
  if (!Array.isArray(raw.attempts) || raw.attempts.length === 0) return { ok: false, reason: 'attempts' }
  if (!Array.isArray(raw.references) && !isObject(raw.references)) return { ok: false, reason: 'references' }
  const refs = raw.references as Record<string, unknown>
  if (!isObject(refs) || !Array.isArray(refs.candidates) || !Array.isArray(refs.verifications))
    return { ok: false, reason: 'references-shape' }
  if (!isObject(raw.summary)) return { ok: false, reason: 'summary' }
  if (!isObject(raw.inputSnapshot)) return { ok: false, reason: 'inputSnapshot' }
  const snap = raw.inputSnapshot as Record<string, unknown>
  if (!Array.isArray(snap.points) || snap.points.length !== 96) return { ok: false, reason: 'snapshot-buckets' }
  if (snap.stepMinutes !== 15) return { ok: false, reason: 'snapshot-step' }
  if (!Array.isArray(snap.units) || !Array.isArray(snap.eligibility) || !isObject(snap.initial))
    return { ok: false, reason: 'snapshot-shape' }
  const fixtureCheck = canonicalPortfolioInput(
    snapshotToFixture(snap as unknown as PortfolioInputSnapshot),
  )
  if (!fixtureCheck.ok || fixtureCheck.id !== raw.inputCanonical) return { ok: false, reason: 'snapshot-identity' }

  const seen = new Set<string>()
  let legal = 0
  let notRun = 0
  for (const a of raw.attempts) {
    if (!isObject(a)) return { ok: false, reason: 'attempt-shape' }
    if (typeof a.candidateId !== 'string' || !a.candidateId) return { ok: false, reason: 'attempt-candidateId' }
    if (seen.has(a.candidateId)) return { ok: false, reason: 'attempt-dup' }
    seen.add(a.candidateId)
    if (typeof a.canonicalId !== 'string' || !a.canonicalId) return { ok: false, reason: 'attempt-canonicalId' }
    if (a.originalInputIdentity !== raw.inputCanonical) return { ok: false, reason: 'attempt-input-binding' }
    if (!STRATEGIES.includes(a.strategy as PortfolioStrategy)) return { ok: false, reason: 'attempt-strategy' }
    if (!isObject(a.verification)) return { ok: false, reason: 'attempt-verification' }
    if (!isObject(a.metrics)) return { ok: false, reason: 'attempt-metrics' }
    if (!isObject(a.evidenceConsistency)) return { ok: false, reason: 'attempt-evidence' }
    if (!isObject(a.b01Verdict)) return { ok: false, reason: 'attempt-b01verdict' }
    // 同护照输入 / batch 绑定
    if ((a.b01Verdict as Record<string, unknown>).batchId !== raw.batchId)
      return { ok: false, reason: 'attempt-batch-binding' }
    const v = a.verification as Record<string, unknown>
    if (typeof v.evaluated !== 'boolean') return { ok: false, reason: 'attempt-evaluated' }
    // 独立重算证据一致性编码：拒绝记录保留原 claimed canonical/原计划/原声明与真实拒绝回执，
    // 不改错 canonical 为通过；通过候选仍要求 canonical 精确一致。
    const evidence = evidenceFromRecordFields(
      snap as unknown as PortfolioInputSnapshot,
      {
        strategy: a.strategy as PortfolioStrategy,
        originalInputIdentity: a.originalInputIdentity as string,
        canonicalId: a.canonicalId as string,
        planOrNull: (a.planOrNull ?? null) as PlanResult | null,
        verification: v as unknown as PassportVerification,
      },
    )
    if (!evidenceEquals(a.evidenceConsistency, evidence))
      return { ok: false, reason: 'attempt-evidence-mismatch' }
    if (v.evaluated === true && v.ok === true && !evidence.canonicalMatched)
      return { ok: false, reason: 'attempt-canonical-mismatch' }
    if (v.evaluated === false) notRun += 1
    else if (v.ok === true) legal += 1
  }
  const summary = raw.summary as Record<string, unknown>
  if (summary.attempted !== raw.attempts.length) return { ok: false, reason: 'summary-attempted' }
  if (summary.legal !== legal) return { ok: false, reason: 'summary-legal' }
  if (summary.notRun !== notRun) return { ok: false, reason: 'summary-notRun' }
  if ((refs.candidates as unknown[]).length !== raw.attempts.length) return { ok: false, reason: 'refs-candidates' }
  if ((refs.verifications as unknown[]).length !== raw.attempts.length) return { ok: false, reason: 'refs-verifications' }
  const finite = assertFiniteDeep(raw)
  if (finite) return { ok: false, reason: `non-finite:${finite}` }
  return { ok: true, reason: 'ok' }
}

export interface PassportStoreSnapshot {
  passports: DecisionPassport[]
  raw: string | null
  writable: boolean
  corrupted: boolean
  warnings: string[]
}

export function loadPassportStore(storage?: StorageLike | null): PassportStoreSnapshot {
  const store = resolveStorage(storage)
  const snapshot: PassportStoreSnapshot = {
    passports: [],
    raw: null,
    writable: true,
    corrupted: false,
    warnings: [],
  }
  if (!store) {
    snapshot.writable = false
    snapshot.warnings.push('当前环境没有可用的本地存储；护照只读展示，未持久化。')
    return snapshot
  }
  let raw: string | null = null
  try {
    raw = store.getItem(PASSPORT_STORE_KEY)
  } catch {
    snapshot.writable = false
    snapshot.warnings.push('读取护照本地存储被拒绝；只读展示，未持久化。')
    return snapshot
  }
  snapshot.raw = raw
  if (raw === null) return snapshot
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    snapshot.corrupted = true
    snapshot.writable = false
    snapshot.warnings.push('护照存储 JSON 损坏：已保留原文、不回退伪历史、不覆盖。')
    return snapshot
  }
  if (!isObject(parsed) || parsed.schemaVersion !== PASSPORT_ENVELOPE_VERSION || !Array.isArray(parsed.passports)) {
    snapshot.corrupted = true
    snapshot.writable = false
    snapshot.warnings.push('护照存储 envelope/schemaVersion 未知或 passports 缺失：已保留原文、不回退、不覆盖。')
    return snapshot
  }
  const ids = new Set<string>()
  let bad = 0
  for (const item of parsed.passports) {
    const check = validateStoredPassport(item)
    const id = isObject(item) && typeof item.passportId === 'string' ? item.passportId : ''
    if (!check.ok || !id || ids.has(id)) {
      bad += 1
      continue
    }
    ids.add(id)
    snapshot.passports.push(deepFreeze(deepClone(item as unknown as DecisionPassport)))
  }
  if (bad > 0) {
    // 坏 record / 重复 ID：保留原文、标记不可写，绝不在 save 时过滤后覆写。
    snapshot.corrupted = true
    snapshot.writable = false
    snapshot.warnings.push(
      `护照存储有 ${bad} 条损坏/重复/校验不过记录：已保留原文、writable=false、不覆盖；可只读查看有效条目。`,
    )
  }
  return snapshot
}

export interface SavePassportResult {
  ok: boolean
  bytes: number
  overCapacity: boolean
  error?: string
}

export function savePassport(
  passport: DecisionPassport,
  storage?: StorageLike | null,
): SavePassportResult {
  const store = resolveStorage(storage)
  if (!store) return { ok: false, bytes: 0, overCapacity: false, error: '当前环境没有可用的本地存储' }
  const existing = loadPassportStore(store)
  if (!existing.writable || existing.corrupted) {
    return { ok: false, bytes: 0, overCapacity: false, error: '护照存储已损坏或被拒，保持只读，拒绝写入/覆盖原文' }
  }
  const selfCheck = validateStoredPassport(passport)
  if (!selfCheck.ok) {
    return { ok: false, bytes: 0, overCapacity: false, error: `新护照校验未通过：${selfCheck.reason}` }
  }
  if (existing.passports.some((p) => p.passportId === passport.passportId)) {
    return { ok: false, bytes: 0, overCapacity: false, error: '同 passportId 已封存，拒绝覆盖' }
  }
  const next = [...existing.passports, passport]
  const envelope = {
    schemaVersion: PASSPORT_ENVELOPE_VERSION,
    savedAt: new Date().toISOString(),
    passports: next,
  }
  const text = JSON.stringify(envelope)
  const bytes = byteLength(text)
  if (bytes > PASSPORT_CAPACITY_BYTES) {
    return { ok: false, bytes, overCapacity: true, error: '超出护照容量上限，请先导出再清理（不自动删旧，不覆盖已封存）' }
  }
  try {
    store.setItem(PASSPORT_STORE_KEY, text)
    return { ok: true, bytes, overCapacity: false }
  } catch (error) {
    return {
      ok: false,
      bytes,
      overCapacity: false,
      error: error instanceof Error ? error.message : '护照写入失败（只读内存，未清旧 key）',
    }
  }
}

export function exportPassportJson(passport: DecisionPassport): string {
  const bad = assertFiniteDeep(passport)
  if (bad) throw new Error(`拒绝导出：非有限数值 ${bad}`)
  return JSON.stringify(passport, null, 2)
}
