import { describe, expect, it } from 'vitest'
import {
  EXECUTION_STORE_KEY,
  ExecutionController,
  admitPassportCandidate,
  advanceExecution,
  envelopeIdentityOk,
  loadExecutionStore,
  manualApprove,
  rejectExecution,
  retireExecution,
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
  deepClone,
  runPortfolioCandidate,
} from './portfolio'
import { FLOW_MILP_MODEL_VERSION } from './optimizer/flowMilp'

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
function idOf(p: DecisionPassport, strategy: string): string {
  return p.attempts.find((a) => a.strategy === strategy)!.candidateId
}
async function admitted(candidateId?: string): Promise<ExecutionEnvelope> {
  const p = await passport()
  const cid = candidateId ?? idOf(p, 'milp_weighted')
  const r = admitPassportCandidate(p, cid, 7, '2026-10-04T00:00:00.000Z')
  expect(r.ok, r.reason ?? '').toBe(true)
  return r.envelope!
}
function advanced(env: ExecutionEnvelope, n: number): ExecutionEnvelope {
  let cur = startExecution(manualApprove(env, { operator: 'op', approvedAt: 't' }).envelope!, { commandId: 's', startedAt: 't' }).envelope!
  for (let i = 0; i < n; i += 1) {
    cur = advanceExecution(cur, { commandId: `a${i}`, executionId: cur.executionId, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: cur.cursor, at: 't' }).envelope!
  }
  return cur
}

describe('B03b admission 版本/状态门', () => {
  it('passport.status=canceled / 错 source / 错 generator / 错 canonicalVersion / 错版本 / 错 rule 均拒绝', async () => {
    const p = await passport()
    const cid = idOf(p, 'milp_weighted')
    expect(admitPassportCandidate(p, cid, 1, 't').ok).toBe(true)
    expect(admitPassportCandidate({ ...deepClone(p), status: 'canceled' }, cid, 1, 't').ok).toBe(false)
    expect(admitPassportCandidate({ ...deepClone(p), inputSource: 'official-unverified' }, cid, 1, 't').ok).toBe(false)
    expect(admitPassportCandidate({ ...deepClone(p), generator: 'other-gen' }, cid, 1, 't').ok).toBe(false)
    expect(admitPassportCandidate({ ...deepClone(p), passportVersion: 'passport-unknown' }, cid, 1, 't').ok).toBe(false)
    expect(admitPassportCandidate({ ...deepClone(p), ruleVersion: 'unsupported' }, cid, 1, 't').ok).toBe(false)
    const c = deepClone(p)
    c.inputSnapshot.canonicalVersion = 'unknown-canonical'
    expect(admitPassportCandidate(c, cid, 1, 't').ok).toBe(false)
  }, 60000)

  it('receipt 保留正确策略版本，不把 DP 冒称 MILP 目标', async () => {
    const p = await passport()
    const milp = admitPassportCandidate(p, idOf(p, 'milp_weighted'), 1, 't').envelope!
    expect(milp.receipt.modelVersion).toBe(FLOW_MILP_MODEL_VERSION)
    const dp = admitPassportCandidate(p, idOf(p, 'lab_energy_first'), 1, 't').envelope!
    expect(dp.receipt.strategy).toBe('lab_energy_first')
    expect(dp.receipt.modelVersion).toBe('n/a')
    expect(dp.receipt.objectiveVersion).toBe('lab_energy_first')
  }, 60000)
})

describe('B03b 强 binding 与人工处置', () => {
  it('顶层只改 passportId/candidateId、link.auditId 空、link.binding.verificationId 错 → Start 拒', async () => {
    const e = await admitted()
    const a = manualApprove(e, { operator: 'op', approvedAt: 't' }).envelope!
    const topTamper = deepClone(a)
    topTamper.passportId = 'forged'
    topTamper.candidateId = 'forged'
    expect(envelopeIdentityOk(topTamper)).toBe(false)
    expect(startExecution(topTamper, { commandId: 'c', startedAt: 't' }).ok).toBe(false)

    const linkEmpty = deepClone(a)
    linkEmpty.decisionAuditLink!.auditId = ''
    expect(startExecution(linkEmpty, { commandId: 'c', startedAt: 't' }).ok).toBe(false)

    const linkBad = deepClone(a)
    linkBad.decisionAuditLink!.binding.verificationId = 'wrong'
    expect(startExecution(linkBad, { commandId: 'c', startedAt: 't' }).ok).toBe(false)

    expect(startExecution(a, { commandId: 'c', startedAt: 't' }).ok).toBe(true)
  }, 60000)

  it('approve 后 reject、retire 后旧 Start 均拒绝', async () => {
    const e = await admitted()
    const a = manualApprove(e, { operator: 'op', approvedAt: 't' }).envelope!
    const rej = rejectExecution(a, { operator: 'op', reason: '驳回', at: 't' })
    expect(rej.ok, rej.reason ?? '').toBe(true)
    expect(rej.envelope!.status).toBe('rejected')
    expect(startExecution(rej.envelope!, { commandId: 'c', startedAt: 't' }).ok).toBe(false)

    const retired = retireExecution(e, '退休').envelope!
    expect(startExecution(retired, { commandId: 'c', startedAt: 't' }).ok).toBe(false)
  }, 60000)

  it('确认迟到：advance 携旧 expectedCursor/错 executionId 拒绝', async () => {
    const e = await admitted()
    const a = manualApprove(e, { operator: 'op', approvedAt: 't' }).envelope!
    const started = startExecution(a, { commandId: 'c', startedAt: 't' }).envelope!
    const r1 = advanceExecution(started, { commandId: 'x', executionId: started.executionId, executionEpoch: started.executionEpoch, verificationId: started.binding.verificationId, expectedCursor: 0, at: 't' })
    const cur = r1.envelope!
    expect(advanceExecution(cur, { commandId: 'late', executionId: cur.executionId, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: 0, at: 't' }).ok).toBe(false)
    expect(advanceExecution(cur, { commandId: 'wrongid', executionId: 'other', executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: 1, at: 't' }).reason).toContain('executionId')
  }, 60000)
})

describe('B03b 假账本 / lastChange 严格校验', () => {
  it('篡改首桶 power/energy/cumulative/modelEnergy=1 → validate/load 拒绝并保留原文', async () => {
    const cur = advanced(await admitted(), 2)
    const fake = deepClone(cur)
    fake.ledger[0].powerKw = 1
    fake.ledger[0].energyKwh = 1
    fake.ledger[0].cumulativeEnergyKwh = 1
    fake.modelEnergyKwh = 1
    expect(validateStoredEnvelope(fake).ok).toBe(false)
    const store = new MemStorage()
    store.setItem(EXECUTION_STORE_KEY, JSON.stringify({ schemaVersion: 1, envelopes: [fake] }))
    const snap = loadExecutionStore(store)
    expect(snap.corrupted).toBe(true)
    expect(snap.writable).toBe(false)
    expect(snap.raw).toBeTruthy()
  }, 60000)

  it('lastChange 与重放不一致 → 拒绝', async () => {
    const cur = advanced(await admitted(), 1)
    const fake = deepClone(cur)
    fake.lastChange = { 'AC-01': 99999 }
    expect(validateStoredEnvelope(fake).ok).toBe(false)
  }, 60000)
})

describe('B03b 上层 controller：刷新退休 / storage fail-closed / 变化退休 / 写失败', () => {
  it('刷新加载活动 approved 只读证据并退休，保留 prefix', async () => {
    const store = new MemStorage()
    const a = manualApprove(await admitted(), { operator: 'op', approvedAt: 't' }).envelope!
    expect((await import('./execution')).saveExecutionEnvelope(a, store).ok).toBe(true)
    const controller = new ExecutionController(store)
    const latest = controller.getLatest()!
    expect(latest.status).toBe('retired')
    expect(latest.retiredReason).toContain('刷新恢复')
    expect(latest.ledger).toHaveLength(a.ledger.length)
  }, 60000)

  it('storage 事件 fail-closed 立即停旧授权', async () => {
    const controller = new ExecutionController(new MemStorage())
    const p = await passport()
    const r = controller.admit(p, idOf(p, 'milp_weighted'), 5, 't')
    expect(r.ok, r.reason ?? '').toBe(true)
    expect(controller.getLatest()!.status).toBe('verified')
    controller.failClosedOnExternalWrite()
    expect(controller.getLatest()!.status).toBe('retired')
    expect(controller.getLatest()!.retiredReason).toContain('storage')
  }, 60000)

  it('业务上下文变化立即退休；A→B→A 不复活', async () => {
    const controller = new ExecutionController(new MemStorage())
    const p = await passport()
    controller.setBusinessContext({ businessKey: 'A' })
    controller.admit(p, idOf(p, 'milp_weighted'), 5, 't')
    expect(controller.getLatest()!.businessKey).toBe('A')
    expect(controller.getLatest()!.status).toBe('verified')
    controller.setBusinessContext({ businessKey: 'B' })
    expect(controller.getLatest()!.status).toBe('retired')
    controller.setBusinessContext({ businessKey: 'A' })
    expect(controller.getLatest()!.status).toBe('retired')
  }, 60000)

  it('写失败无部分提交，latest 不发布', async () => {
    const controller = new ExecutionController(new BoomStorage())
    const p = await passport()
    const r = controller.admit(p, idOf(p, 'milp_weighted'), 5, 't')
    expect(r.ok).toBe(false)
    expect(controller.getLatest()).toBeNull()
    expect(controller.getWarnings().join()).toContain('写入失败')
  }, 60000)
})
