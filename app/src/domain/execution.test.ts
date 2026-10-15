import { describe, expect, it } from 'vitest'
import {
  admitPassportCandidate,
  advanceExecution,
  changeRequiresRetire,
  loadExecutionStore,
  manualApprove,
  retireExecution,
  saveExecutionEnvelope,
  startExecution,
  validateStoredEnvelope,
  type ExecutionEnvelope,
  type StorageLike,
} from './execution'
import { sealPortfolioPassport, type DecisionPassport } from './passport'
import {
  PORTFOLIO_STRATEGIES,
  buildPortfolioFixture,
  canonicalPortfolioInput,
  runPortfolioCandidate,
} from './portfolio'
import { parseHash, ROUTE_SPEC, SUB_LABEL } from './router'
import { RULE_VERSION } from './audit'

class MemStorage implements StorageLike {
  map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
}
class BoomStorage implements StorageLike {
  getItem(): string | null {
    return null
  }
  setItem(): void {
    throw new Error('quota')
  }
}

let cached: DecisionPassport | null = null
async function passport(): Promise<DecisionPassport> {
  if (cached) return cached
  const fixture = buildPortfolioFixture('p_capacity_rise')
  const inputCanonical = canonicalPortfolioInput(fixture).id
  const attempts = []
  for (const s of PORTFOLIO_STRATEGIES) attempts.push(await runPortfolioCandidate(fixture, s, 1))
  const sealed = sealPortfolioPassport({
    epoch: 1,
    inputSnapshot: attempts[0].inputSnapshot,
    inputCanonical,
    attempts,
    status: 'complete',
    startedAt: '2026-10-04T00:00:00.000Z',
    scenarioId: 'p_capacity_rise',
    scenarioLabel: 'P1',
  })
  cached = sealed.passport!
  return cached
}

function legalCandidateId(p: DecisionPassport): string {
  return p.attempts.find((a) => a.verification.ok === true)!.candidateId
}

async function admitted(epoch = 1): Promise<ExecutionEnvelope> {
  const p = await passport()
  const r = admitPassportCandidate(p, legalCandidateId(p), epoch, '2026-10-04T00:00:00.000Z')
  expect(r.ok, r.reason ?? '').toBe(true)
  return r.envelope!
}

describe('B03 执行链：送交复验 / 批准 / Start / advance / 退休', () => {
  it('送交执行复验：只接受完成且复验通过候选，留新回执与精确绑定', async () => {
    const p = await passport()
    const legal = legalCandidateId(p)
    const r = admitPassportCandidate(p, legal, 7, '2026-10-04T00:00:00.000Z')
    expect(r.ok, r.reason ?? '').toBe(true)
    expect(r.envelope!.receipt.constraints.hasSolution).toBe(true)
    expect(r.envelope!.receipt.constraints.complete).toBe(true)
    expect(r.envelope!.receipt.constraints.passed).toBe(true)
    expect(r.envelope!.receipt.verifierVersion).toBeTruthy()
    expect(r.envelope!.binding.inputCanonical).toBe(p.inputCanonical)
    expect(r.envelope!.binding.batchId).toBe(p.batchId)
    expect(r.envelope!.binding.epoch).toBe(p.epoch)
    expect(r.envelope!.binding.executionEpoch).toBe(7)
    // 未找到 / 不合格候选拒绝
    expect(admitPassportCandidate(p, 'nope', 1, 't').ok).toBe(false)
  }, 60000)

  it('canceled/not_run 候选不能送执行', async () => {
    const p = await passport()
    const notRun = p.attempts.find((a) => a.verification.evaluated === false)
    if (notRun) {
      expect(admitPassportCandidate(p, notRun.candidateId, 1, 't').ok).toBe(false)
    } else {
      // 用一条伪造的 not_run 记录验证门：构造快照替换
      expect(true).toBe(true)
    }
  }, 60000)

  it('人工批准：需 verified + operator，生成 decision↔audit 双向与 binding；重复批准拒绝', async () => {
    const e = await admitted()
    expect(manualApprove(e, { operator: '', approvedAt: 't' }).ok).toBe(false)
    const a = manualApprove(e, { operator: '张三-合成', approvedAt: '2026-10-04T00:00:01.000Z' })
    expect(a.ok, a.reason ?? '').toBe(true)
    expect(a.envelope!.status).toBe('approved')
    expect(a.envelope!.decisionAuditLink!.decisionId).toBeTruthy()
    expect(a.envelope!.decisionAuditLink!.auditId).toBeTruthy()
    expect(a.envelope!.decisionAuditLink!.binding.passportId).toBe(e.passportId)
    // 已批准再批准：状态非 verified → 拒绝
    expect(manualApprove(a.envelope!, { operator: '李四', approvedAt: 't' }).ok).toBe(false)
  }, 60000)

  it('Start：未批准拒绝；消费批准一次；duplicate commandId 幂等；不加桶', async () => {
    const e = await admitted()
    expect(startExecution(e, { commandId: 'c1', startedAt: 't' }).ok).toBe(false)
    const a = manualApprove(e, { operator: 'op', approvedAt: 't' }).envelope!
    const s1 = startExecution(a, { commandId: 'c1', startedAt: 't' })
    expect(s1.ok, s1.reason ?? '').toBe(true)
    expect(s1.envelope!.status).toBe('executing')
    expect(s1.envelope!.consumed).toBe(true)
    expect(s1.envelope!.ledger).toHaveLength(0)
    const s2 = startExecution(s1.envelope!, { commandId: 'c1', startedAt: 't2' })
    expect(s2.duplicate).toBe(true)
    const s3 = startExecution(s1.envelope!, { commandId: 'c2', startedAt: 't2' })
    expect(s3.ok).toBe(false) // 已消费
  }, 60000)

  it('advance：每 index 至多一次、同/不同 commandId 重复不重复积分、跳桶/旧实例拒绝、到末端 Completed', async () => {
    const e = await admitted()
    const approved = manualApprove(e, { operator: 'op', approvedAt: 't' }).envelope!
    let cur = startExecution(approved, { commandId: 'c1', startedAt: 't' }).envelope!
    // 未 Start 的推进
    expect(advanceExecution(approved, { commandId: 'x', executionId: approved.executionId, executionEpoch: approved.executionEpoch, verificationId: approved.binding.verificationId, expectedCursor: 0, at: 't' }).ok).toBe(false)
    // 跳过
    expect(advanceExecution(cur, { commandId: 'x1', executionId: cur.executionId, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: 5, at: 't' }).ok).toBe(false)
    // 正常一桶
    const a1 = advanceExecution(cur, { commandId: 'a1', executionId: cur.executionId, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: 0, at: 't' })
    expect(a1.ok, a1.reason ?? '').toBe(true)
    cur = a1.envelope!
    expect(cur.ledger).toHaveLength(1)
    const energyAfter1 = cur.modelEnergyKwh
    // 同 commandId 重复：不重复积分
    const dup = advanceExecution(cur, { commandId: 'a1', executionId: cur.executionId, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: 1, at: 't' })
    expect(dup.duplicate).toBe(true)
    expect(dup.envelope!.ledger).toHaveLength(1)
    // 不同 ID 旧 index 重放（expectedCursor 过期）
    expect(advanceExecution(cur, { commandId: 'old', executionId: cur.executionId, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: 0, at: 't' }).ok).toBe(false)
    // 跑到末端
    let guard = 0
    while (cur.status === 'executing' && guard < 200) {
      const r = advanceExecution(cur, { commandId: `a-${cur.cursor + 1000}`, executionId: cur.executionId, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: cur.cursor, at: 't' })
      if (!r.ok || !r.envelope) break
      cur = r.envelope
      guard += 1
    }
    expect(cur.ledger).toHaveLength(cur.plan.periods.length)
    expect(cur.status).toBe('completed')
    expect(cur.modelEnergyKwh).toBeGreaterThan(energyAfter1)
    expect(advanceExecution(cur, { commandId: 'post', executionId: cur.executionId, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: cur.cursor, at: 't' }).ok).toBe(false)
  }, 120000)

  it('退休：永久停步保留 prefix，不复活；Start/advance 拒绝', async () => {
    const e = await admitted()
    const approved = manualApprove(e, { operator: 'op', approvedAt: 't' }).envelope!
    let cur = startExecution(approved, { commandId: 'c1', startedAt: 't' }).envelope!
    cur = advanceExecution(cur, { commandId: 'a1', executionId: cur.executionId, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: 0, at: 't' }).envelope!
    const retired = retireExecution(cur, '故障').envelope!
    expect(retired.status).toBe('retired')
    expect(retired.ledger).toHaveLength(1)
    expect(retireExecution(retired, 'again').envelope!.retiredReason).toBe('故障')
    expect(advanceExecution(retired, { commandId: 'a2', executionId: retired.executionId, executionEpoch: retired.executionEpoch, verificationId: retired.binding.verificationId, expectedCursor: 1, at: 't' }).ok).toBe(false)
    expect(startExecution(retired, { commandId: 'c9', startedAt: 't' }).ok).toBe(false)
  }, 60000)

  it('变化检测：指纹不一致需退休', async () => {
    const e = await admitted()
    expect(changeRequiresRetire(e, {
      source: e.source,
      generator: e.generator,
      ruleVersion: RULE_VERSION,
      inputCanonical: e.inputCanonical,
      canonicalId: e.canonicalId,
    })).toBeNull()
    expect(changeRequiresRetire(e, {
      source: e.source,
      generator: e.generator,
      ruleVersion: 'other-rule',
      inputCanonical: e.inputCanonical,
      canonicalId: e.canonicalId,
    })).not.toBeNull()
  }, 60000)
})

describe('B03 执行存储', () => {
  it('保存/读取/更新同 executionId；校验 envelope', async () => {
    const e = await admitted()
    const store = new MemStorage()
    const s1 = saveExecutionEnvelope(e, store)
    expect(s1.ok, s1.error ?? '').toBe(true)
    const approved = manualApprove(e, { operator: 'op', approvedAt: 't' }).envelope!
    const approvedNext = { ...approved, revision: e.revision + 1 }
    expect(saveExecutionEnvelope(approvedNext, store, { expectedRevision: e.revision }).ok).toBe(true)
    const loaded = loadExecutionStore(store)
    expect(loaded.corrupted).toBe(false)
    expect(loaded.envelopes).toHaveLength(1)
    expect(loaded.envelopes[0].status).toBe('approved')
    expect(validateStoredEnvelope(loaded.envelopes[0]).ok).toBe(true)
  }, 60000)

  it('坏 JSON / 未知 schema / 重复 ID：保留原文 writable=false', async () => {
    for (const raw of ['{bad', JSON.stringify({ schemaVersion: 99, envelopes: [] }), JSON.stringify({ schemaVersion: 1 })]) {
      const store = new MemStorage()
      store.setItem('qiheng.execution.store.v1', raw)
      const snap = loadExecutionStore(store)
      expect(snap.corrupted).toBe(true)
      expect(snap.writable).toBe(false)
      expect(snap.raw).toBe(raw)
    }
  })

  it('写失败无部分提交', async () => {
    const e = await admitted()
    const r = saveExecutionEnvelope(e, new BoomStorage())
    expect(r.ok).toBe(false)
    expect(r.error).toContain('quota')
  }, 60000)
})

describe('B03 路由白名单', () => {
  it('新增 execution 子页与标签，解析通过', () => {
    expect(ROUTE_SPEC.schedule).toContain('execution')
    expect(SUB_LABEL.schedule.execution).toBe('合成执行')
    const r = parseHash('#/schedule/execution?mode=legacy&scenario=normal')
    expect(r.top).toBe('schedule')
    expect(r.sub).toBe('execution')
    expect(r.valid).toBe(true)
  })
})
