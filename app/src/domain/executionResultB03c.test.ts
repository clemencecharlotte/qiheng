import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  ExecutionController,
  saveExecutionEnvelope,
  type ExecutionEnvelope,
  type StorageLike,
} from './execution'
import { sealPortfolioPassport, type DecisionPassport } from './passport'
import {
  PORTFOLIO_STRATEGIES,
  buildPortfolioFixture,
  canonicalPortfolioInput,
  deepClone,
  runPortfolioCandidate,
} from './portfolio'

class MemStorage implements StorageLike {
  map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
}
class FlakyStorage extends MemStorage {
  fail = false
  setItem(k: string, v: string): void {
    if (this.fail) throw new Error('quota')
    super.setItem(k, v)
  }
}

let cached: DecisionPassport | null = null
async function passport(): Promise<DecisionPassport> {
  if (cached) return cached
  const fixture = buildPortfolioFixture('p_capacity_rise')
  const inputCanonical = canonicalPortfolioInput(fixture).id
  const attempts = []
  for (const s of PORTFOLIO_STRATEGIES) attempts.push(await runPortfolioCandidate(fixture, s, 1))
  cached = sealPortfolioPassport({
    epoch: 1,
    inputSnapshot: attempts[0].inputSnapshot,
    inputCanonical,
    attempts,
    status: 'complete',
    startedAt: '2026-10-04T00:00:00.000Z',
    scenarioId: 'p_capacity_rise',
    scenarioLabel: 'P1',
  }).passport!
  return cached
}
function idOf(p: DecisionPassport): string {
  return p.attempts.find((a) => a.verification.ok === true)!.candidateId
}
function uuid(): string {
  return `cmd-${Math.random().toString(16).slice(2, 10)}`
}

describe('B03c 残余结果导出', () => {
  it('写出 qiheng-execution-b03c-result.json', async () => {
    const p = await passport()

    // 所修分支：真实 admit→approve→Start→1 桶（不重跑全 96）
    const c1 = new ExecutionController(new MemStorage())
    c1.setBusinessContext({ businessKey: 'normal' })
    expect(c1.admit(p, idOf(p), 201, 't').ok).toBe(true)
    expect(c1.approve({ operator: '张三-合成', approvedAt: 't' }).ok).toBe(true)
    expect(c1.start({ commandId: uuid(), startedAt: 't' }).ok).toBe(true)
    const latest1 = c1.getLatest()!
    const adv = c1.advance({ commandId: uuid(), executionEpoch: latest1.executionEpoch, verificationId: latest1.binding.verificationId, expectedCursor: 0, at: 't' })
    expect(adv.ok, adv.reason ?? '').toBe(true)
    const afterOne = c1.getLatest()!

    // 业务上下文 normal→surge→normal 永久退休
    const c2 = new ExecutionController(new MemStorage())
    c2.setBusinessContext({ businessKey: 'normal' })
    c2.admit(p, idOf(p), 202, 't')
    c2.setBusinessContext({ businessKey: 'surge' })
    const bizRetired = c2.getLatest()!.status
    c2.setBusinessContext({ businessKey: 'normal' })
    const bizStillRetired = c2.getLatest()!.status
    c2.setBusinessContext({ businessKey: 'normal', invalid: true })

    // revision/处置 guard：外部新 retired revision 阻断旧 Start
    const store = new MemStorage()
    const c3 = new ExecutionController(store)
    c3.setBusinessContext({ businessKey: 'normal' })
    c3.admit(p, idOf(p), 203, 't')
    c3.approve({ operator: 'op', approvedAt: 't' })
    const approved = c3.getLatest()!
    const external: ExecutionEnvelope = { ...deepClone(approved), status: 'retired', retiredReason: '外部退休', revision: approved.revision + 1 }
    const extSaved = saveExecutionEnvelope(external, store, { expectedRevision: approved.revision })
    const staleStart = c3.start({ commandId: uuid(), startedAt: 't' })

    // 同 revision 不同处置
    const store2 = new MemStorage()
    const c4 = new ExecutionController(store2)
    c4.setBusinessContext({ businessKey: 'normal' })
    c4.admit(p, idOf(p), 204, 't')
    c4.approve({ operator: 'op', approvedAt: 't' })
    const approved4 = c4.getLatest()!
    store2.setItem('qiheng.execution.store.v1', JSON.stringify({ schemaVersion: 1, envelopes: [{ ...deepClone(approved4), status: 'retired' }] }))
    const sameRevStart = c4.start({ commandId: uuid(), startedAt: 't' })

    // invalid 退休写失败 + 存储恢复不复活
    const flaky = new FlakyStorage()
    const c5 = new ExecutionController(flaky)
    c5.setBusinessContext({ businessKey: 'normal' })
    c5.admit(p, idOf(p), 205, 't')
    flaky.fail = true
    c5.setBusinessContext({ businessKey: 'normal', invalid: true })
    const invalidRetired = c5.getLatest()!.status
    const pending = c5.getPendingSaveReason()
    flaky.fail = false
    c5.setBusinessContext({ businessKey: 'normal' })
    const afterRecovery = c5.start({ commandId: uuid(), startedAt: 't' })
    const recoveredStatus = c5.getLatest()!.status

    // 刷新 restore 保存失败
    const flaky2 = new FlakyStorage()
    const seed = new ExecutionController(flaky2)
    seed.setBusinessContext({ businessKey: 'normal' })
    seed.admit(p, idOf(p), 206, 't')
    flaky2.fail = true
    const refreshed = new ExecutionController(flaky2)

    const payload = {
      schema: 'qiheng-execution-b03c-export-v1',
      generatedAt: new Date().toISOString(),
      note: 'B03c 残余收尾：业务上下文守卫、revision/处置 guard、必须退休先内存 fail-closed。仅合成模拟。完整 96 桶轨迹见 qiheng-execution-b03b-result.json（未覆盖）。',
      fixedBranch: {
        status: afterOne.status,
        cursor: afterOne.cursor,
        ledgerLength: afterOne.ledger.length,
        modelEnergyKwh: afterOne.modelEnergyKwh,
        binding: afterOne.binding,
      },
      businessRetire: { afterSurge: bizRetired, afterBackToNormal: bizStillRetired },
      revisionGuard: { externalSaved: extSaved.ok, staleStart: { ok: staleStart.ok, reason: staleStart.reason } },
      sameRevisionDifferentDisposition: { startOk: sameRevStart.ok, reason: sameRevStart.reason },
      invalidWriteFailureRecovery: { status: invalidRetired, pending, startAfterRecoveryOk: afterRecovery.ok, statusAfterRecovery: recoveredStatus },
      refreshWriteFailure: { status: refreshed.getLatest()!.status, pending: refreshed.getPendingSaveReason() },
    }
    writeFileSync('qiheng-execution-b03c-result.json', JSON.stringify(payload, null, 2))

    expect(afterOne.cursor).toBe(1)
    expect(bizRetired).toBe('retired')
    expect(bizStillRetired).toBe('retired')
    expect(staleStart.ok).toBe(false)
    expect(sameRevStart.ok).toBe(false)
    expect(invalidRetired).toBe('retired')
    expect(afterRecovery.ok).toBe(false)
    expect(recoveredStatus).toBe('retired')
    expect(refreshed.getLatest()!.status).toBe('retired')
  }, 300000)
})
