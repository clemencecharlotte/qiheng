import { RULE_VERSION, isCurrentRuleVersion, type AuditEvent } from './audit'
import type { SourceId } from './sources'
import type { ApprovalDecision, PlanResult, ScenarioId } from './types'

/**
 * 演示状态持久化与“当前有效批准”统一合同。
 *
 * 设计约束：
 * - 单一 envelope（含 schemaVersion）同步保存 decisions 与 auditEvents；旧 v1 key 保留可回退。
 * - 逐项校验类型 / action / ID / 来源 / 场景 / run / 规则 / 完整方案签名 / 关联审计；
 *   损坏条目拒绝作为有效批准，不伪造历史审计，不自动升级旧记录。
 * - 这是本地演示存储，不宣称防篡改或企业级审计。
 */

export const DEMO_STORE_KEY = 'qiheng.demo.store.v2'
export const LEGACY_DECISIONS_KEY = 'qiheng.demo.decisions.v1'
export const DEMO_STORE_SCHEMA_VERSION = 2

const SCENARIO_IDS: ScenarioId[] = ['normal', 'surge', 'unit_failure']
const AUDIT_KINDS = ['recompute', 'qa', 'approve', 'reject', 'export']
const SOURCE_IDS: SourceId[] = ['synthetic_schedule', 'synthetic_history']
const SOURCE_SCOPES = ['schedule', 'history', 'both']

export interface DemoStoreEnvelope {
  schemaVersion: number
  savedAt: string
  decisions: ApprovalDecision[]
  auditEvents: AuditEvent[]
}

export interface DemoStoreSnapshot {
  decisions: ApprovalDecision[]
  auditEvents: AuditEvent[]
  /** 加载过程中的可见说明 / 告警（损坏条目、旧版迁移等）。 */
  warnings: string[]
  /** 是否来自旧 v1 存储的可见历史迁移。 */
  migratedFromV1: boolean
  /** 新 envelope 是否存在且可解析。 */
  envelopePresent: boolean
  /**
   * 是否允许写回 v2 envelope。v2 损坏 / 版本不符 / 读取被拒时为 false，
   * 不覆盖坏原文，本次会话只做内存态。
   */
  writable: boolean
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isScenario(value: unknown): value is ScenarioId {
  return typeof value === 'string' && (SCENARIO_IDS as string[]).includes(value)
}

/** 校验一条决策记录；结构损坏返回 null（不得作为有效批准）。 */
export function validateDecision(raw: unknown): ApprovalDecision | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (!isNonEmptyString(d.id)) return null
  if (d.action !== 'approve' && d.action !== 'reject') return null
  if (!isScenario(d.scenario)) return null
  if (typeof d.reason !== 'string') return null
  if (!isNonEmptyString(d.createdAt)) return null
  if (d.synthetic !== true) return null

  const out: ApprovalDecision = {
    id: d.id,
    scenario: d.scenario,
    action: d.action,
    reason: d.reason,
    createdAt: d.createdAt,
    synthetic: true,
  }
  if (isNonEmptyString(d.sourceId)) out.sourceId = d.sourceId
  if (isNonEmptyString(d.runRef)) out.runRef = d.runRef
  if (isNonEmptyString(d.candidateRef)) out.candidateRef = d.candidateRef
  if (isNonEmptyString(d.ruleVersion)) out.ruleVersion = d.ruleVersion
  if (typeof d.planFeasible === 'boolean') out.planFeasible = d.planFeasible
  if (isNonEmptyString(d.planSignature)) out.planSignature = d.planSignature
  if (isNonEmptyString(d.createdAtIso)) out.createdAtIso = d.createdAtIso
  if (typeof d.auditId === 'string') out.auditId = d.auditId
  else if (d.auditId === null) out.auditId = null
  if (d.migrated === true) out.migrated = true
  return out
}

/** 校验一条审计事件；结构损坏返回 null（不以它作为批准证据）。 */
export function validateAuditEvent(raw: unknown): AuditEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (!isNonEmptyString(e.id)) return null
  if (!isNonEmptyString(e.at)) return null
  if (typeof e.kind !== 'string' || !AUDIT_KINDS.includes(e.kind)) return null
  if (e.scenario !== 'n/a' && !isScenario(e.scenario)) return null
  if (!Array.isArray(e.sourceIds)) return null
  if (typeof e.sourceScope !== 'string' || !SOURCE_SCOPES.includes(e.sourceScope)) {
    return null
  }
  // 未知 / 非法 sourceIds 一律拒绝整条，而不是过滤后洗成合法。
  if (!e.sourceIds.every((s): s is SourceId => (SOURCE_IDS as string[]).includes(s as string))) {
    return null
  }
  const sourceIds = e.sourceIds as SourceId[]
  // scope 与来源集合必须严格一致（无重复、无缺项、无多余项）。
  const scope = e.sourceScope as AuditEvent['sourceScope']
  const expected: Record<string, SourceId[]> = {
    schedule: ['synthetic_schedule'],
    history: ['synthetic_history'],
    both: ['synthetic_schedule', 'synthetic_history'],
  }
  const want = expected[scope]
  const uniqueSources = new Set(sourceIds)
  if (uniqueSources.size !== sourceIds.length) return null
  if (want.length !== sourceIds.length || !want.every((s) => uniqueSources.has(s))) {
    return null
  }
  if (typeof e.inputSummary !== 'string') return null
  if (typeof e.conclusion !== 'string') return null
  if (!Array.isArray(e.evidenceIds)) return null
  if (!isNonEmptyString(e.ruleVersion)) return null
  if (typeof e.operatorAction !== 'string') return null

  const event: AuditEvent = {
    id: e.id,
    at: e.at,
    kind: e.kind as AuditEvent['kind'],
    scenario: e.scenario as AuditEvent['scenario'],
    sourceIds,
    sourceScope: scope,
    inputSummary: e.inputSummary,
    conclusion: e.conclusion,
    evidenceIds: e.evidenceIds.filter((s): s is string => typeof s === 'string'),
    ruleVersion: e.ruleVersion,
    operatorAction: e.operatorAction,
  }
  if (typeof e.beforePlanSummary === 'string') event.beforePlanSummary = e.beforePlanSummary
  if (typeof e.afterPlanSummary === 'string') event.afterPlanSummary = e.afterPlanSummary
  if (typeof e.rejectionReason === 'string') event.rejectionReason = e.rejectionReason
  if (typeof e.decisionId === 'string') event.decisionId = e.decisionId
  else if (e.decisionId === null) event.decisionId = null
  return event
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    // 某些隐私模式下访问 localStorage 本身即抛错
    return null
  }
}

function emptySnapshot(): DemoStoreSnapshot {
  return {
    decisions: [],
    auditEvents: [],
    warnings: [],
    migratedFromV1: false,
    envelopePresent: false,
    writable: true,
  }
}

/** 从 v1 决策数组迁移为可见历史：保留记录、标记 migrated、不伪造审计。 */
function migrateLegacy(raw: unknown): {
  decisions: ApprovalDecision[]
  dropped: number
} {
  if (!Array.isArray(raw)) return { decisions: [], dropped: 0 }
  const decisions: ApprovalDecision[] = []
  let dropped = 0
  for (const item of raw) {
    const valid = validateDecision(item)
    if (!valid) {
      dropped += 1
      continue
    }
    decisions.push({ ...valid, migrated: true, auditId: null })
  }
  return { decisions, dropped }
}

/** 丢弃在数组中出现多次的 ID（重复决策 / 审计 ID 一律不生效）。 */
function dropDuplicateIds<T extends { id: string }>(
  items: T[],
): { kept: T[]; dropped: number } {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
  const kept = items.filter((item) => (counts.get(item.id) ?? 0) === 1)
  return { kept, dropped: items.length - kept.length }
}

export function loadDemoStore(storage?: StorageLike | null): DemoStoreSnapshot {
  const store = resolveStorage(storage)
  if (!store) {
    // 浏览器环境却拿不到 localStorage：访问被拒，给恢复提示且不写。
    if (typeof window !== 'undefined' && storage === undefined) {
      const denied = emptySnapshot()
      denied.writable = false
      denied.warnings.push(
        '无法访问浏览器本地存储（可能被隐私设置拒绝）。本次会话可继续查看，但不会写入；请在站点设置允许本地存储后刷新。',
      )
      return denied
    }
    return emptySnapshot()
  }

  const snapshot = emptySnapshot()

  let newRaw: string | null = null
  try {
    newRaw = store.getItem(DEMO_STORE_KEY)
  } catch (error) {
    snapshot.writable = false
    snapshot.warnings.push(
      `读取本地演示存储被拒绝（${error instanceof Error ? error.message : '未知原因'}）。本次会话可继续查看，但不会写入；请在浏览器站点设置允许本地存储后刷新。`,
    )
    return snapshot
  }

  // v2 key 一旦存在，就绝不回退 v1，也绝不覆盖坏原文。
  if (newRaw !== null) {
    let parsed: unknown = undefined
    try {
      parsed = JSON.parse(newRaw)
    } catch {
      parsed = undefined
    }
    const env =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : null
    if (!env || env.schemaVersion !== DEMO_STORE_SCHEMA_VERSION) {
      snapshot.writable = false
      snapshot.warnings.push(
        `演示存储（v2）JSON / schemaVersion 损坏（期望 ${DEMO_STORE_SCHEMA_VERSION}）。已拒绝读取且不回退旧版、不覆盖原文；请在浏览器中清除该站点本地存储后刷新以恢复。本次会话不写入。`,
      )
      return snapshot
    }

    snapshot.envelopePresent = true

    const rawDecisions = Array.isArray(env.decisions) ? env.decisions : []
    const validDecisions: ApprovalDecision[] = []
    let droppedDecisions = 0
    for (const item of rawDecisions) {
      const valid = validateDecision(item)
      if (valid) validDecisions.push(valid)
      else droppedDecisions += 1
    }
    const decisionsDeduped = dropDuplicateIds(validDecisions)
    snapshot.decisions = decisionsDeduped.kept
    if (droppedDecisions > 0) {
      snapshot.warnings.push(
        `演示存储有 ${droppedDecisions} 条决策记录结构损坏，已丢弃且不作为有效批准。`,
      )
    }
    if (decisionsDeduped.dropped > 0) {
      snapshot.warnings.push(
        `演示存储有 ${decisionsDeduped.dropped} 条重复决策 ID，已全部丢弃且不作为有效批准。`,
      )
    }

    const rawEvents = Array.isArray(env.auditEvents) ? env.auditEvents : []
    const validEvents: AuditEvent[] = []
    let droppedEvents = 0
    for (const item of rawEvents) {
      const valid = validateAuditEvent(item)
      if (valid) validEvents.push(valid)
      else droppedEvents += 1
    }
    const eventsDeduped = dropDuplicateIds(validEvents)
    snapshot.auditEvents = eventsDeduped.kept
    if (droppedEvents > 0) {
      snapshot.warnings.push(
        `演示存储有 ${droppedEvents} 条审计记录结构损坏或来源非法，已丢弃。`,
      )
    }
    if (eventsDeduped.dropped > 0) {
      snapshot.warnings.push(
        `演示存储有 ${eventsDeduped.dropped} 条重复审计 ID，已全部丢弃。`,
      )
    }

    return snapshot
  }

  // v2 不存在：才从 v1 迁移可见历史（直接读一次 v1，不写回坏数据）。
  let legacyRaw: string | null = null
  try {
    legacyRaw = store.getItem(LEGACY_DECISIONS_KEY)
  } catch {
    legacyRaw = null
  }
  if (legacyRaw) {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(legacyRaw)
    } catch {
      parsed = null
    }
    const { decisions, dropped } = migrateLegacy(parsed)
    const deduped = dropDuplicateIds(decisions)
    if (deduped.kept.length > 0 || dropped > 0 || deduped.dropped > 0) {
      snapshot.migratedFromV1 = true
      snapshot.decisions = deduped.kept
      snapshot.warnings.push(
        `检测到旧版（v1）决策记录 ${deduped.kept.length} 条，仅作为可见历史迁移展示；缺少原审计与完整方案上下文，须按现行规则重新审核，不会自动升级为有效批准。`,
      )
      if (dropped > 0) {
        snapshot.warnings.push(`其中 ${dropped} 条旧记录结构损坏，已丢弃。`)
      }
      if (deduped.dropped > 0) {
        snapshot.warnings.push(`其中 ${deduped.dropped} 条重复 ID，已丢弃。`)
      }
    }
  }

  return snapshot
}

export interface SaveResult {
  ok: boolean
  error?: string
}

export function saveDemoStore(
  decisions: ApprovalDecision[],
  auditEvents: AuditEvent[],
  storage?: StorageLike | null,
): SaveResult {
  const store = resolveStorage(storage)
  if (!store) return { ok: false, error: '当前环境没有可用的本地存储' }
  const envelope: DemoStoreEnvelope = {
    schemaVersion: DEMO_STORE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    decisions,
    auditEvents,
  }
  try {
    store.setItem(DEMO_STORE_KEY, JSON.stringify(envelope))
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '本地存储写入失败',
    }
  }
}

/**
 * 完整方案绑定签名：逐时段（需求 / 投运机组 / 负载 / 供气）生成确定性签名。
 * 候选机组 ID 列表不足以代表完整方案；方案任一时段变化即签名变化。
 */
export function planSignature(plan: PlanResult): string {
  const periods = plan.periods.map((p) => {
    const ids = [...p.runningUnitIds].sort().join('+')
    const loads = Object.keys(p.unitLoads ?? {})
      .sort()
      .map((k) => `${k}=${(p.unitLoads[k] ?? 0).toFixed(4)}`)
      .join(',')
    return `${p.index}#${p.demand.toFixed(4)}#${ids}#${loads}#${p.supply.toFixed(4)}`
  })
  return `${plan.feasible ? 'F' : 'X'}|${plan.periods.length}|${periods.join(';')}`
}

export interface ApprovalContext {
  scenario: ScenarioId
  sourceId: SourceId
  runRef: string
  candidateRef: string
  ruleVersion: string
  planSignature: string
}

export type ApprovalStatus =
  | 'none'
  | 'effective'
  | 'stale_rule'
  | 'source_mismatch'
  | 'plan_changed'
  | 'unlinked'
  | 'migrated'

function expectedScope(sourceId: SourceId): 'schedule' | 'history' {
  return sourceId === 'synthetic_schedule' ? 'schedule' : 'history'
}

/** 来源集合严格等于该 scope 的规范集合：不接受未知来源、缺项、重复或多余项。 */
function sourcesExactlyFor(
  sourceIds: SourceId[],
  sourceId: SourceId,
): boolean {
  const expected: SourceId[] = [sourceId]
  if (sourceIds.length !== expected.length) return false
  const unique = new Set(sourceIds)
  if (unique.size !== sourceIds.length) return false
  return expected.every((s) => unique.has(s))
}

export interface EffectiveDecision {
  status: ApprovalStatus
  decision: ApprovalDecision | null
  auditEvent: AuditEvent | null
  reason: string
}

function evaluateDecision(
  decision: ApprovalDecision,
  auditEvents: AuditEvent[],
  context: ApprovalContext,
): EffectiveDecision {
  if (decision.migrated) {
    return {
      status: 'migrated',
      decision,
      auditEvent: null,
      reason:
        '旧版本（v1）迁移记录，缺少原审计与完整方案上下文，须重新审核，不作为当前有效批准。',
    }
  }
  if (!isCurrentRuleVersion(decision.ruleVersion)) {
    return {
      status: 'stale_rule',
      decision,
      auditEvent: null,
      reason: `记录规则版本 ${decision.ruleVersion ?? '—'} 非当前版本（${context.ruleVersion}），须按现行规则重审，不作为当前有效批准。`,
    }
  }
  if (decision.sourceId !== context.sourceId) {
    return {
      status: 'source_mismatch',
      decision,
      auditEvent: null,
      reason: '记录来源与当前来源不一致，不作为当前有效批准。',
    }
  }
  if (
    decision.runRef !== context.runRef ||
    decision.candidateRef !== context.candidateRef ||
    !decision.planSignature
  ) {
    return {
      status: 'plan_changed',
      decision,
      auditEvent: null,
      reason: '记录未绑定当前运行 / 候选 / 完整方案，须重新审核。',
    }
  }
  if (decision.planSignature !== context.planSignature) {
    return {
      status: 'plan_changed',
      decision,
      auditEvent: null,
      reason: '完整方案已变化（逐时段机组 / 负载 / 供气不同），原处置不继承，须重新审核。',
    }
  }

  // fail-closed：审计必须与决策严格一致，任何一项不匹配都不生效。
  const linked = auditEvents.find((e) => e.id === decision.auditId)
  if (!linked) {
    return {
      status: 'unlinked',
      decision,
      auditEvent: null,
      reason: '缺少与真实审计事件的双向关联（审计缺失 / 断裂），须重新审核。',
    }
  }
  if (linked.decisionId !== decision.id) {
    return {
      status: 'unlinked',
      decision,
      auditEvent: null,
      reason: '审计与决策 ID 关联错位（decisionId 不指向本决策），须重新审核。',
    }
  }
  if (linked.kind !== decision.action) {
    return {
      status: 'unlinked',
      decision,
      auditEvent: null,
      reason: `审计类型（${linked.kind}）与决策动作（${decision.action}）不一致，须重新审核。`,
    }
  }
  if (linked.scenario !== decision.scenario || linked.scenario !== context.scenario) {
    return {
      status: 'unlinked',
      decision,
      auditEvent: null,
      reason: '审计场景与决策 / 当前场景不一致，须重新审核。',
    }
  }
  if (!isCurrentRuleVersion(linked.ruleVersion)) {
    return {
      status: 'unlinked',
      decision,
      auditEvent: null,
      reason: '关联审计非当前规则版本，须重新审核。',
    }
  }
  if (
    linked.sourceScope !== expectedScope(context.sourceId) ||
    !sourcesExactlyFor(linked.sourceIds, context.sourceId)
  ) {
    return {
      status: 'unlinked',
      decision,
      auditEvent: null,
      reason: '关联审计的来源范围 / 来源集合与当前来源不一致，须重新审核。',
    }
  }
  return {
    status: 'effective',
    decision,
    auditEvent: linked,
    reason: '来源、场景、运行、候选、规则版本、完整方案与关联审计均一致，为当前有效处置。',
  }
}

/**
 * 统一的“当前有效决策”选择器。
 *
 * 取**最新一条同场景处置**（按 createdAtIso 降序，缺失视为最旧，平序保持数组顺序
 * ——数组新记录在前）作为唯一裁决对象：最新处置失效就显示待重审 / 历史，
 * 不允许较新的 unlinked / reject 回溯重激活更旧的 approve。
 * 决策整体检查来源、场景、seed/run、候选、规则版本、完整方案签名与关联审计双向绑定。
 */
export function resolveEffectiveDecision(
  decisions: ApprovalDecision[],
  auditEvents: AuditEvent[],
  context: ApprovalContext,
): EffectiveDecision {
  const candidates = decisions.filter((d) => d.scenario === context.scenario)
  if (candidates.length === 0) {
    return { status: 'none', decision: null, auditEvent: null, reason: '当前场景暂无处置记录。' }
  }
  const ordered = candidates
    .map((decision, index) => ({ decision, index }))
    .sort((a, b) => {
      const cmp = (b.decision.createdAtIso ?? '').localeCompare(
        a.decision.createdAtIso ?? '',
      )
      return cmp !== 0 ? cmp : a.index - b.index
    })
  return evaluateDecision(ordered[0].decision, auditEvents, context)
}

/** 是否构成“当前有效批准”（仅 approve 且绑定一致）。 */
export function hasEffectiveApproval(result: EffectiveDecision): boolean {
  return result.status === 'effective' && result.decision?.action === 'approve'
}

export interface SnapshotCheck {
  ok: boolean
  reason: string
}

/**
 * 提交端快照核验：在“打开确认时”捕获的完整 run 身份必须与提交时最新上下文一致。
 * 过期 / 缺失一律 fail-closed，返回未写入回执且不记审计，绝不把旧确认当作新方案批准。
 */
export function checkSubmitSnapshot(
  expected: string | null | undefined,
  current: string,
): SnapshotCheck {
  if (!expected) {
    return {
      ok: false,
      reason: '缺少提交时的方案身份快照，已按 fail-closed 拒绝写入。',
    }
  }
  if (expected !== current) {
    return {
      ok: false,
      reason:
        '确认时的方案身份与当前不一致（已切换模式 / 夹具 / 偏好 / 初态 / 参数或方案变化），本次未写入、未记审计。',
    }
  }
  return { ok: true, reason: '' }
}

export const APPROVAL_CONTEXT_RULE_VERSION = RULE_VERSION
