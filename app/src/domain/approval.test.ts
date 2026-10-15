import { describe, expect, it } from 'vitest'
import { RULE_VERSION } from './audit'
import type { AuditEvent } from './audit'
import { runScenario } from './engine'
import { FIXED_SEED, UNITS } from './units'
import type { ApprovalDecision, ScenarioId } from './types'
import {
  checkSubmitSnapshot,
  DEMO_STORE_KEY,
  DEMO_STORE_SCHEMA_VERSION,
  LEGACY_DECISIONS_KEY,
  loadDemoStore,
  planSignature,
  resolveEffectiveDecision,
  saveDemoStore,
  validateDecision,
  type ApprovalContext,
  type StorageLike,
} from './approval'

class FakeStorage implements StorageLike {
  map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

function ctxFor(scenario: ScenarioId, seed = FIXED_SEED): ApprovalContext {
  const run = runScenario(scenario, UNITS, seed)
  return {
    scenario,
    sourceId: 'synthetic_schedule',
    runRef: `synthetic_schedule:${scenario}:seed=${run.series.seed}`,
    candidateRef: run.evaluation.candidates.map((u) => u.id).join('+') || 'none',
    ruleVersion: RULE_VERSION,
    planSignature: planSignature(run.recommendation),
  }
}

function decisionFor(ctx: ApprovalContext, patch: Partial<ApprovalDecision> = {}): ApprovalDecision {
  return {
    id: `${ctx.scenario}-1`,
    scenario: ctx.scenario,
    action: 'approve',
    reason: '演示批准理由',
    createdAt: '2026-10-01 10:00:00',
    createdAtIso: '2026-10-01T02:00:00.000Z',
    synthetic: true,
    sourceId: ctx.sourceId,
    runRef: ctx.runRef,
    candidateRef: 'AC-01+AC-02',
    ruleVersion: ctx.ruleVersion,
    planSignature: ctx.planSignature,
    auditId: 'evt-0001',
    ...patch,
  }
}

function auditFor(ctx: ApprovalContext, decisionId: string, patch: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'evt-0001',
    at: '2026-10-01T02:00:00.000Z',
    kind: 'approve',
    scenario: ctx.scenario,
    sourceIds: ['synthetic_schedule'],
    sourceScope: 'schedule',
    inputSummary: '对建议执行批准',
    conclusion: '演示批准理由',
    evidenceIds: ['safety-verdict'],
    ruleVersion: RULE_VERSION,
    operatorAction: '人工批准（仅演示状态）',
    decisionId,
    ...patch,
  }
}

describe('planSignature 完整方案绑定', () => {
  it('同一场景同一 seed 签名稳定', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED)
    expect(planSignature(run.recommendation)).toBe(planSignature(run.recommendation))
  })

  it('不同场景的完整方案签名不同', () => {
    const normal = runScenario('normal', UNITS, FIXED_SEED)
    const failure = runScenario('unit_failure', UNITS, FIXED_SEED)
    expect(planSignature(normal.recommendation)).not.toBe(planSignature(failure.recommendation))
  })
})

describe('有效批准统一选择器', () => {
  it('来源/场景/运行/规则/完整方案/双向审计全部一致才有效', () => {
    const ctx = ctxFor('normal')
    const result = resolveEffectiveDecision(
      [decisionFor(ctx)],
      [auditFor(ctx, 'normal-1')],
      ctx,
    )
    expect(result.status).toBe('effective')
    expect(result.decision?.id).toBe('normal-1')
    expect(result.auditEvent?.id).toBe('evt-0001')
  })

  it('缺少关联审计时不生效（不能只靠理由或场景推断）', () => {
    const ctx = ctxFor('normal')
    const result = resolveEffectiveDecision([decisionFor(ctx)], [], ctx)
    expect(result.status).toBe('unlinked')
  })

  it('审计仅单侧关联（decisionId 不匹配）时不生效', () => {
    const ctx = ctxFor('normal')
    const orphan: AuditEvent = auditFor(ctx, 'other-decision')
    const result = resolveEffectiveDecision([decisionFor(ctx)], [orphan], ctx)
    expect(result.status).toBe('unlinked')
  })

  it('规则版本过期时不生效，须重新审核', () => {
    const ctx = ctxFor('normal')
    const result = resolveEffectiveDecision(
      [decisionFor(ctx, { ruleVersion: 'qiheng-rules-v0.4.0' })],
      [auditFor(ctx, 'normal-1')],
      ctx,
    )
    expect(result.status).toBe('stale_rule')
  })

  it('完整方案变化（逐时段计划签名不同）不继承原批准', () => {
    const ctx = ctxFor('normal')
    const result = resolveEffectiveDecision(
      [decisionFor(ctx, { planSignature: 'X|0|other-plan' })],
      [auditFor(ctx, 'normal-1')],
      ctx,
    )
    expect(result.status).toBe('plan_changed')
  })

  it('切到另一场景不继承批准', () => {
    const normalCtx = ctxFor('normal')
    const surgeCtx = ctxFor('surge')
    const result = resolveEffectiveDecision(
      [decisionFor(normalCtx)],
      [auditFor(normalCtx, 'normal-1')],
      surgeCtx,
    )
    expect(result.status).toBe('none')
  })

  it('审计 kind 与决策 action 不一致时不生效（wrongActionAudit）', () => {
    const ctx = ctxFor('normal')
    const result = resolveEffectiveDecision(
      [decisionFor(ctx)],
      [auditFor(ctx, 'normal-1', { kind: 'reject' })],
      ctx,
    )
    expect(result.status).toBe('unlinked')
  })

  it('审计来源为回放而决策为调度时不生效（historySourceAudit）', () => {
    const ctx = ctxFor('normal')
    const result = resolveEffectiveDecision(
      [decisionFor(ctx)],
      [
        auditFor(ctx, 'normal-1', {
          sourceScope: 'history',
          sourceIds: ['synthetic_history'],
        }),
      ],
      ctx,
    )
    expect(result.status).toBe('unlinked')
  })

  it('审计规则版本非当前时不生效（wrongRuleAudit）', () => {
    const ctx = ctxFor('normal')
    const result = resolveEffectiveDecision(
      [decisionFor(ctx)],
      [auditFor(ctx, 'normal-1', { ruleVersion: 'qiheng-rules-v0.4.0' })],
      ctx,
    )
    expect(result.status).toBe('unlinked')
  })

  it('审计场景与决策不一致时不生效', () => {
    const ctx = ctxFor('normal')
    const result = resolveEffectiveDecision(
      [decisionFor(ctx)],
      [auditFor(ctx, 'normal-1', { scenario: 'surge' })],
      ctx,
    )
    expect(result.status).toBe('unlinked')
  })

  it('较新的 unlinked 驳回不能回溯重激活旧的有效批准', () => {
    const ctx = ctxFor('normal')
    const olderApprove = decisionFor(ctx, {
      id: 'normal-old-approve',
      createdAtIso: '2026-10-01T01:00:00.000Z',
      auditId: 'evt-old',
    })
    const olderAudit = auditFor(ctx, 'normal-old-approve', { id: 'evt-old' })
    const newerReject = decisionFor(ctx, {
      id: 'normal-new-reject',
      action: 'reject',
      createdAtIso: '2026-10-01T03:00:00.000Z',
      auditId: 'evt-missing',
    })
    const result = resolveEffectiveDecision(
      [newerReject, olderApprove],
      [olderAudit],
      ctx,
    )
    expect(result.status).toBe('unlinked')
    expect(result.decision?.id).toBe('normal-new-reject')
  })

  it('批准 A 后切到 B：旧 A 批准在 B 上下文失效，且切回 A 不越过更新驳回重激活', () => {
    const ctxA = ctxFor('normal')
    const approveA = decisionFor(ctxA, {
      id: 'A-approve',
      createdAtIso: '2026-10-01T01:00:00.000Z',
      auditId: 'evt-A',
    })
    const auditA = auditFor(ctxA, 'A-approve', { id: 'evt-A' })
    // A 在自身上下文有效
    expect(resolveEffectiveDecision([approveA], [auditA], ctxA).status).toBe('effective')

    // 较新的 B 驳回（同一场景标识但完整方案 / 候选不同，如 lab 切夹具）
    const ctxB: ApprovalContext = {
      ...ctxA,
      runRef: `${ctxA.runRef}-B`,
      candidateRef: 'AC-02',
      planSignature: 'X|0|other-plan',
    }
    const rejectB = decisionFor(ctxB, {
      id: 'B-reject',
      action: 'reject',
      createdAtIso: '2026-10-01T05:00:00.000Z',
      auditId: 'evt-B',
    })
    const auditB = auditFor(ctxB, 'B-reject', { id: 'evt-B', kind: 'reject' })

    // 在 A 上下文：最新是 B 驳回，身份不匹配 → 不生效，且不回溯激活 A
    const inA = resolveEffectiveDecision([rejectB, approveA], [auditA, auditB], ctxA)
    expect(inA.status).not.toBe('effective')
    expect(inA.decision?.id).toBe('B-reject')
  })

  it('候选绑定变化时不继承批准', () => {
    const ctx = ctxFor('normal')
    const result = resolveEffectiveDecision(
      [decisionFor(ctx, { candidateRef: 'AC-02' })],
      [auditFor(ctx, 'normal-1')],
      ctx,
    )
    expect(result.status).toBe('plan_changed')
  })

  it('旧 v1 迁移记录永不作为有效批准', () => {
    const ctx = ctxFor('normal')
    const result = resolveEffectiveDecision(
      [decisionFor(ctx, { migrated: true, auditId: null })],
      [auditFor(ctx, 'normal-1')],
      ctx,
    )
    expect(result.status).toBe('migrated')
  })

  it('被阻断的批准尝试不构成批准证据', () => {
    const ctx = ctxFor('surge')
    const blocked: AuditEvent = auditFor(ctx, '', {
      kind: 'approve',
      decisionId: null,
      operatorAction: '批准请求被安全审查阻断，未写入决策记录',
    })
    const result = resolveEffectiveDecision([], [blocked], ctx)
    expect(result.status).toBe('none')
    expect(result.decision).toBeNull()
  })
})

describe('提交端快照核验', () => {
  it('快照与当前身份一致才允许写入', () => {
    expect(checkSubmitSnapshot('lab-identity-A', 'lab-identity-A').ok).toBe(true)
  })

  it('过期快照（已切模式/夹具/偏好/初态）拒绝写入', () => {
    const result = checkSubmitSnapshot('lab-identity-A', 'lab-identity-B')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('不一致')
  })

  it('缺失/空快照一律 fail-closed 拒绝', () => {
    for (const missing of [undefined, null, '']) {
      const result = checkSubmitSnapshot(missing, 'lab-identity-A')
      expect(result.ok).toBe(false)
    }
  })

  it('legacy 合法快照（显示/确认/提交同一 runRef）接受', () => {
    const legacyRunRef = 'synthetic_schedule:normal:seed=20260929'
    expect(checkSubmitSnapshot(legacyRunRef, legacyRunRef).ok).toBe(true)
  })

  it('迟到快照（身份已变）拒绝', () => {
    expect(checkSubmitSnapshot('legacy:old', 'legacy:new').ok).toBe(false)
  })

  it('lab 偏好隔离：A 快照不能在 B 身份下通过', () => {
    expect(checkSubmitSnapshot('lab-identity-energy', 'lab-identity-switch').ok).toBe(false)
  })
})

describe('存储 envelope 与迁移', () => {
  it('保存后可原样读回 decisions 与 auditEvents', () => {
    const ctx = ctxFor('normal')
    const storage = new FakeStorage()
    const decision = decisionFor(ctx)
    const audit = auditFor(ctx, 'normal-1')
    expect(saveDemoStore([decision], [audit], storage).ok).toBe(true)
    const loaded = loadDemoStore(storage)
    expect(loaded.envelopePresent).toBe(true)
    expect(loaded.decisions).toHaveLength(1)
    expect(loaded.auditEvents).toHaveLength(1)
    expect(loaded.decisions[0].auditId).toBe('evt-0001')
    expect(loaded.auditEvents[0].decisionId).toBe('normal-1')
  })

  it('结构损坏的决策条目被拒绝作为有效批准', () => {
    const storage = new FakeStorage()
    storage.setItem(
      DEMO_STORE_KEY,
      JSON.stringify({
        schemaVersion: DEMO_STORE_SCHEMA_VERSION,
        savedAt: '2026-10-01T00:00:00.000Z',
        decisions: [
          { id: '', scenario: 'normal', action: 'approve', reason: 'x', createdAt: 't', synthetic: true },
          { id: 'ok-1', scenario: 'bad-scenario', action: 'approve', reason: 'x', createdAt: 't', synthetic: true },
          { id: 'ok-2', scenario: 'normal', action: 'sideways', reason: 'x', createdAt: 't', synthetic: true },
        ],
        auditEvents: [],
      }),
    )
    const loaded = loadDemoStore(storage)
    expect(loaded.decisions).toHaveLength(0)
    expect(loaded.warnings.join('')).toContain('损坏')
  })

  it('schemaVersion 不符时拒绝作为有效批准', () => {
    const storage = new FakeStorage()
    storage.setItem(
      DEMO_STORE_KEY,
      JSON.stringify({ schemaVersion: 1, savedAt: 'x', decisions: [], auditEvents: [] }),
    )
    const loaded = loadDemoStore(storage)
    expect(loaded.envelopePresent).toBe(false)
    expect(loaded.warnings.join('')).toContain('schemaVersion')
  })

  it('旧 v1 记录仅作为可见历史迁移，不伪造审计且不生效', () => {
    const storage = new FakeStorage()
    storage.setItem(
      LEGACY_DECISIONS_KEY,
      JSON.stringify([
        {
          id: 'normal-1',
          scenario: 'normal',
          action: 'approve',
          reason: '旧理由',
          createdAt: '2026-09-30 10:00:00',
          synthetic: true,
          sourceId: 'synthetic_schedule',
          ruleVersion: 'qiheng-rules-v0.4.0',
        },
      ]),
    )
    const loaded = loadDemoStore(storage)
    expect(loaded.migratedFromV1).toBe(true)
    expect(loaded.decisions).toHaveLength(1)
    expect(loaded.decisions[0].migrated).toBe(true)
    expect(loaded.auditEvents).toHaveLength(0)
    expect(loaded.warnings.join('')).toContain('重新审核')

    const ctx = ctxFor('normal')
    const result = resolveEffectiveDecision(loaded.decisions, loaded.auditEvents, ctx)
    expect(result.status).toBe('migrated')
  })

  it('validateDecision 保留完整绑定字段', () => {
    const ctx = ctxFor('normal')
    const validated = validateDecision(decisionFor(ctx))
    expect(validated?.planSignature).toBe(ctx.planSignature)
    expect(validated?.runRef).toBe(ctx.runRef)
    expect(validated?.candidateRef).toBe(ctx.candidateRef)
    expect(validated?.auditId).toBe('evt-0001')
  })

  it('v2 损坏时不回退 v1、不覆盖坏原文（writable=false）', () => {
    const storage = new FakeStorage()
    storage.setItem(DEMO_STORE_KEY, '{ this is not json')
    storage.setItem(
      LEGACY_DECISIONS_KEY,
      JSON.stringify([
        {
          id: 'legacy-1',
          scenario: 'normal',
          action: 'approve',
          reason: '旧理由',
          createdAt: '2026-09-30 10:00:00',
          synthetic: true,
        },
      ]),
    )
    const loaded = loadDemoStore(storage)
    expect(loaded.writable).toBe(false)
    expect(loaded.decisions).toHaveLength(0)
    expect(loaded.migratedFromV1).toBe(false)
    // 坏原文保持不动
    expect(storage.getItem(DEMO_STORE_KEY)).toBe('{ this is not json')
  })

  it('v2 schema 不符时不回退 v1', () => {
    const storage = new FakeStorage()
    storage.setItem(DEMO_STORE_KEY, JSON.stringify({ schemaVersion: 1, decisions: [] }))
    storage.setItem(
      LEGACY_DECISIONS_KEY,
      JSON.stringify([
        { id: 'legacy-1', scenario: 'normal', action: 'approve', reason: 'x', createdAt: 't', synthetic: true },
      ]),
    )
    const loaded = loadDemoStore(storage)
    expect(loaded.writable).toBe(false)
    expect(loaded.migratedFromV1).toBe(false)
  })

  it('读取被拒时给出恢复提示且不抛异常', () => {
    const denied: StorageLike = {
      getItem() {
        throw new Error('SecurityError')
      },
      setItem() {},
    }
    const loaded = loadDemoStore(denied)
    expect(loaded.writable).toBe(false)
    expect(loaded.warnings.join('')).toContain('拒绝')
    expect(loaded.decisions).toHaveLength(0)
  })

  it('未知 / 错配 sourceIds 的审计整条拒绝，不被过滤洗白', () => {
    const storage = new FakeStorage()
    const ctx = ctxFor('normal')
    const bad = { ...auditFor(ctx, 'normal-1'), sourceIds: ['synthetic_history'] }
    const unknown = { ...auditFor(ctx, 'normal-1', { id: 'evt-0002' }), sourceIds: ['evil_source'] }
    storage.setItem(
      DEMO_STORE_KEY,
      JSON.stringify({
        schemaVersion: DEMO_STORE_SCHEMA_VERSION,
        savedAt: 'x',
        decisions: [decisionFor(ctx)],
        auditEvents: [bad, unknown],
      }),
    )
    const loaded = loadDemoStore(storage)
    expect(loaded.auditEvents).toHaveLength(0)
    expect(loaded.warnings.join('')).toContain('来源非法')
  })

  it('重复决策 ID / 审计 ID 一律丢弃，不生效', () => {
    const storage = new FakeStorage()
    const ctx = ctxFor('normal')
    const d = decisionFor(ctx)
    const storageEnvelope = {
      schemaVersion: DEMO_STORE_SCHEMA_VERSION,
      savedAt: 'x',
      decisions: [d, { ...d }],
      auditEvents: [auditFor(ctx, 'normal-1'), auditFor(ctx, 'normal-1')],
    }
    storage.setItem(DEMO_STORE_KEY, JSON.stringify(storageEnvelope))
    const loaded = loadDemoStore(storage)
    expect(loaded.decisions).toHaveLength(0)
    expect(loaded.auditEvents).toHaveLength(0)
    expect(loaded.warnings.join('')).toContain('重复')
    const result = resolveEffectiveDecision(loaded.decisions, loaded.auditEvents, ctx)
    expect(result.status).toBe('none')
  })
})
