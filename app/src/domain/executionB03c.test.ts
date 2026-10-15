import { describe, expect, it } from 'vitest'
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
  }).passport!
  return cached
}
function idOf(p: DecisionPassport): string {
  return p.attempts.find((a) => a.verification.ok === true)!.candidateId
}

describe('B03c 残余1：业务上下文守卫（App 接线路径）', () => {
  it('normal→surge→normal 永久退休，A→B→A 不复活', async () => {
    const controller = new ExecutionController(new MemStorage())
    const p = await passport()
    controller.setBusinessContext({ businessKey: 'normal|legacy|capacity_rise|energy_first|fault=none' })
    controller.admit(p, idOf(p), 5, 't')
    expect(controller.getLatest()!.status).toBe('verified')
    controller.setBusinessContext({ businessKey: 'surge|legacy|capacity_rise|energy_first|fault=none' })
    expect(controller.getLatest()!.status).toBe('retired')
    controller.setBusinessContext({ businessKey: 'normal|legacy|capacity_rise|energy_first|fault=none' })
    expect(controller.getLatest()!.status).toBe('retired')
  }, 60000)

  it('invalid=true 立即退休', async () => {
    const controller = new ExecutionController(new MemStorage())
    const p = await passport()
    controller.setBusinessContext({ businessKey: 'normal' })
    controller.admit(p, idOf(p), 5, 't')
    controller.setBusinessContext({ businessKey: 'normal', invalid: true })
    expect(controller.getLatest()!.status).toBe('retired')
  }, 60000)
})

describe('B03c 残余2：revision/处置 guard', () => {
  it('外部写入同 ID 新 retired revision → 旧 approve/Start/advance 拒绝', async () => {
    const store = new MemStorage()
    const controller = new ExecutionController(store)
    const p = await passport()
    expect(controller.admit(p, idOf(p), 5, 't').ok).toBe(true)
    expect(controller.approve({ operator: 'op', approvedAt: 't' }).ok).toBe(true)
    const approved = controller.getLatest()!
    // 外部同 ID 写入 retired revision = approved.revision+1
    const external: ExecutionEnvelope = { ...deepClone(approved), status: 'retired', retiredReason: '外部退休', revision: approved.revision + 1 }
    expect(saveExecutionEnvelope(external, store, { expectedRevision: approved.revision }).ok).toBe(true)

    const started = controller.start({ commandId: 'c', startedAt: 't' })
    expect(started.ok).toBe(false)
    expect(controller.getLatest()!.status).toBe('retired')
    expect(controller.advance({ commandId: 'a', executionEpoch: approved.executionEpoch, verificationId: approved.binding.verificationId, expectedCursor: 0, at: 't' }).ok).toBe(false)
    expect(controller.approve({ operator: 'op', approvedAt: 't2' }).ok).toBe(false)
  }, 60000)

  it('同 revision 不同处置 → 拒绝覆盖', async () => {
    const store = new MemStorage()
    const controller = new ExecutionController(store)
    const p = await passport()
    controller.admit(p, idOf(p), 5, 't')
    controller.approve({ operator: 'op', approvedAt: 't' })
    const approved = controller.getLatest()!
    // 直接写同 ID、同 revision、不同处置（绕过 revision+1 规则）
    const forged: ExecutionEnvelope = { ...deepClone(approved), status: 'retired', retiredReason: '伪造同 rev' }
    store.setItem('qiheng.execution.store.v1', JSON.stringify({ schemaVersion: 1, envelopes: [forged] }))
    const r = controller.start({ commandId: 'c', startedAt: 't' })
    expect(r.ok).toBe(false)
    expect(controller.getLatest()!.status).toBe('retired')
  }, 60000)
})

describe('B03c 残余3：必须退休路径先内存 fail-closed', () => {
  it('invalid 退休写失败 + 存储恢复不复活', async () => {
    const store = new FlakyStorage()
    const controller = new ExecutionController(store)
    const p = await passport()
    controller.setBusinessContext({ businessKey: 'normal' })
    expect(controller.admit(p, idOf(p), 5, 't').ok).toBe(true)
    store.fail = true
    controller.setBusinessContext({ businessKey: 'normal', invalid: true })
    expect(controller.getLatest()!.status).toBe('retired')
    expect(controller.getPendingSaveReason()).toContain('未保存')
    store.fail = false
    // 存储恢复：旧授权不可用，不复活
    controller.setBusinessContext({ businessKey: 'normal' })
    const s = controller.start({ commandId: 'c', startedAt: 't' })
    expect(s.ok).toBe(false)
    expect(controller.getLatest()!.status).toBe('retired')
  }, 60000)

  it('刷新 restore 保存失败不回退未退休 mostRecent', async () => {
    const store = new FlakyStorage()
    const p = await passport()
    const tmp = new ExecutionController(store)
    tmp.setBusinessContext({ businessKey: 'normal' })
    tmp.admit(p, idOf(p), 5, 't')
    const active = tmp.getLatest()!
    expect(active.status).toBe('verified')
    store.fail = true
    const controller = new ExecutionController(store)
    expect(controller.getLatest()!.status).toBe('retired')
    expect(controller.getPendingSaveReason()).toContain('刷新退休写失败')
  }, 60000)
})
