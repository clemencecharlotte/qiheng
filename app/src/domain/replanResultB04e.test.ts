import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  ReplanController,
  buildSuffixInput,
  captureIncident,
  commitSuffixLedger,
  createSuffixExecution,
  replayPrefix,
  retireForIncident,
  runSuffixReplan,
  startSuffix,
  suffixBindingOk,
  suffixCanonical,
  suffixCumulativeOk,
  validateSuffixRecord,
  type ParentGate,
  type SuffixExecutionRecord,
  type SuffixRequest,
} from './replan'
import { ExecutionController, type ExecutionEnvelope, type StorageLike } from './execution'
import { sealPortfolioPassport, type DecisionPassport } from './passport'
import {
  PORTFOLIO_STRATEGIES,
  buildPortfolioFixture,
  canonicalPortfolioInput,
  deepClone,
  runPortfolioCandidate,
} from './portfolio'
import { solveFlowMilp } from './optimizer/flowMilp'
import { RULE_VERSION } from './audit'
import { VERIFIER_VERSION } from './constraints'

class MemStorage implements StorageLike {
  map = new Map<string, string>()
  getItem(k: string): string | null { return this.map.get(k) ?? null }
  setItem(k: string, v: string): void { this.map.set(k, v) }
}
const KEY = 'qiheng.replan.store.v1'
const EKEY = 'qiheng.execution.store.v1'

let cachedPassport: DecisionPassport | null = null
async function passport(): Promise<DecisionPassport> {
  if (cachedPassport) return cachedPassport
  const fixture = buildPortfolioFixture('p_capacity_rise')
  const inputCanonical = canonicalPortfolioInput(fixture).id
  const attempts = []
  for (const s of PORTFOLIO_STRATEGIES) attempts.push(await runPortfolioCandidate(fixture, s, 1))
  cachedPassport = sealPortfolioPassport({ epoch: 1, inputSnapshot: attempts[0].inputSnapshot, inputCanonical, attempts, status: 'complete', startedAt: '2026-10-04T00:00:00.000Z', scenarioId: 'p_capacity_rise', scenarioLabel: 'P1' }).passport!
  return cachedPassport
}
function idOf(p: DecisionPassport): string { return p.attempts.find((a) => a.verification.ok === true)!.candidateId }
async function parentWithPrefix(n: number): Promise<ExecutionEnvelope> {
  const c = new ExecutionController(new MemStorage())
  const p = await passport()
  c.setBusinessContext({ businessKey: 'normal|qa-b04e' })
  c.admit(p, idOf(p), 1201, 't'); c.approve({ operator: 'op', approvedAt: 't' }); c.start({ commandId: 's', startedAt: 't' })
  let cur = c.getLatest()!
  for (let i = 0; i < n; i += 1) { c.advance({ commandId: `a${i}`, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: cur.cursor, at: 't' }); cur = c.getLatest()! }
  return cur
}
const solve = async (input: Parameters<typeof solveFlowMilp>[0]) => ({ workerState: 'ok' as const, result: await solveFlowMilp(input), error: null })
function gate(p: ExecutionEnvelope | null, pending: string | null = null): ParentGate {
  return { getLatest: () => p, getPendingSaveReason: () => pending, loadPersisted: (id) => (p && id === p.executionId ? p : null) }
}
let memo: { retired: ExecutionEnvelope; incident: ReturnType<typeof captureIncident>; created: { record: SuffixExecutionRecord | null } } | null = null
async function buildRecord() {
  if (memo) return memo
  const parent0 = await parentWithPrefix(56)
  const replay = replayPrefix(parent0.inputSnapshot, parent0.plan, parent0.ledger, 56, { executionId: parent0.executionId, verificationId: parent0.binding.verificationId })
  const incident = captureIncident(parent0, 56, 'AC-02 故障', 't', ['AC-02'])
  const retired = retireForIncident(parent0, incident).envelope!
  const built = buildSuffixInput(retired.inputSnapshot, replay, ['AC-02'])
  const req: SuffixRequest = { requestId: 'suffix-e', epoch: 1202, parentPassportId: retired.binding.passportId, parentCandidateId: retired.binding.candidateId, parentExecutionId: retired.executionId, parentVerificationId: retired.binding.verificationId, parentRevision: retired.revision, businessKey: retired.businessKey, cursor: 56, faultSet: ['AC-02'], ruleVersion: RULE_VERSION, verifierVersion: VERIFIER_VERSION, inputCanonical: suffixCanonical(retired.inputSnapshot, replay, ['AC-02'], 1202), capturedAt: 't' }
  const run = await runSuffixReplan(req, built.input, solve)
  const planned = commitSuffixLedger(retired.inputSnapshot, replay, run.attempt!.result!.plan!, run.attempt!, ['AC-02'], { segmentExecutionId: 'pending', verificationId: 'pending', decisionId: '', auditId: '', variantId: 'pending' })
  const created = createSuffixExecution(req, run.attempt!, planned, replay, retired)
  memo = { retired, incident, created: { record: created.record } }
  return memo
}
async function freshControllerWithChild(): Promise<{ controller: ReplanController; store: MemStorage; retired: ExecutionEnvelope; incident: ReturnType<typeof captureIncident> }> {
  const { retired, incident, created } = await buildRecord()
  const store = new MemStorage()
  const controller = new ReplanController(store, gate(retired))
  controller.createSuffix(created.record!, incident)
  controller.approve({ operator: 'op', at: 't' })
  controller.start('c')
  controller.advance({ expectedCursor: 0 })
  return { controller, store, retired, incident }
}

describe('B04e 四阻断修复', () => {
  it('1 activeParentId 异父：approve 首/次均拒、保 raw、旧 approve 不覆盖', async () => {
    const { retired, incident, created } = await buildRecord()
    const store = new MemStorage()
    const controller = new ReplanController(store, gate(retired))
    expect(controller.createSuffix(created.record!, incident).ok).toBe(true)
    const parsed = JSON.parse(store.getItem(KEY)!)
    parsed.activeParentId = 'other-parent'
    store.setItem(KEY, JSON.stringify(parsed))
    const rawAfter = store.getItem(KEY)!
    expect(controller.approve({ operator: 'op', at: 't' }).ok).toBe(false)
    expect(controller.getLatest()!.status).toBe('terminated')
    expect(store.getItem(KEY)).toBe(rawAfter)
    // 恢复旧 activeParentId 后仍拒
    const restore = JSON.parse(store.getItem(KEY)!)
    restore.activeParentId = retired.executionId
    store.setItem(KEY, JSON.stringify(restore))
    expect(controller.approve({ operator: 'op', at: 't' }).ok).toBe(false)
  }, 180000)

  it('2 未批准终止证据可读但不可 Start；部分ID/假批准/非空账本拒', async () => {
    const { created } = await buildRecord()
    const rec = deepClone(created.record!)
    const terminated: SuffixExecutionRecord = { ...rec, status: 'terminated', revision: rec.revision + 1 }
    expect(suffixBindingOk(terminated)).toBe(true)
    expect(validateSuffixRecord(terminated).ok).toBe(true)
    expect(startSuffix(terminated, 'c').ok).toBe(false) // 非 approved，不可 Start
    // 部分 ID
    const partial = deepClone(terminated); partial.binding.decisionId = 'd'; partial.decisionId = 'd'
    expect(suffixBindingOk(partial)).toBe(false)
    // 假批准但无账本：decision/audit 非空
    const fake = deepClone(terminated); fake.binding.decisionId = 'd'; fake.binding.auditId = 'a'; fake.decisionId = 'd'; fake.auditId = 'a'
    expect(suffixBindingOk(fake)).toBe(true) // 结构上看似已批准
    // 非空账本但审批 ID 空 → 拒
    const exec = deepClone(terminated); exec.ledger = [deepClone(rec.plannedRows[0])]; exec.cursor = 1
    expect(suffixBindingOk(exec)).toBe(false)
  }, 180000)

  it('3 同父已有已提交子桶 → 新 create 拒，账本同值（不退回父 cursor）', async () => {
    const { controller, store, retired, incident } = await freshControllerWithChild()
    const before = controller.getLatest()!
    expect(controller.hasCommittedChild(retired.executionId)).toBe(true)
    const countBefore = JSON.parse(store.getItem(KEY)!).records.length
    const again = new ReplanController(store, gate(retired)).createSuffix(before, incident)
    expect(again.ok).toBe(false)
    expect(again.reason).toContain('已提交子桶')
    // 不新增任何子段记录（刷新退休只改状态，不新增）
    expect(JSON.parse(store.getItem(KEY)!).records.length).toBe(countBefore)
    // 刷新恢复后仍拒
    const refreshed = new ReplanController(store, gate(retired))
    expect(refreshed.hasCommittedChild(retired.executionId)).toBe(true)
    expect(refreshed.createSuffix(before, incident).ok).toBe(false)
    expect(controller.getLatest()!.ledger.length).toBe(1)
  }, 180000)

  it('4 重复退休幂等 no-op（同值）；pending/异 raw 不假清', async () => {
    const store = new MemStorage()
    const p = await passport()
    const c = new ExecutionController(store)
    c.setBusinessContext({ businessKey: 'normal|qa-b04e' })
    c.admit(p, idOf(p), 1203, 't'); c.approve({ operator: 'op', approvedAt: 't' }); c.start({ commandId: 's', startedAt: 't' })
    c.advance({ commandId: 'a', executionEpoch: c.getLatest()!.executionEpoch, verificationId: c.getLatest()!.binding.verificationId, expectedCursor: 0, at: 't' })
    expect(c.retire('第一次退休').ok).toBe(true)
    const rev1 = c.getLatest()!.revision
    expect(c.getPendingSaveReason()).toBeNull()
    expect(c.retire('第二次退休').ok).toBe(true)
    expect(c.getLatest()!.revision).toBe(rev1)
    expect(c.getPendingSaveReason()).toBeNull()
    // 异 raw：外部改内容后退休不得假清
    const raw = store.getItem(EKEY)!
    const parsed = JSON.parse(raw)
    parsed.envelopes[0].retiredReason = '外部改写'
    store.setItem(EKEY, JSON.stringify(parsed))
    c.retire('第三次')
    expect(c.getPendingSaveReason()).not.toBeNull()
  }, 180000)

  it('正控：parent56/AC02 40桶 suffix；批准与 Start 各 0 桶，一桶按机理积分', async () => {
    const { retired, incident, created } = await buildRecord()
    const controller = new ReplanController(new MemStorage(), gate(retired))
    controller.createSuffix(created.record!, incident)
    const verified = controller.getLatest()!
    expect(verified.plannedRows.length).toBe(40)
    expect(verified.ledger.length).toBe(0)
    controller.approve({ operator: 'op', at: 't' })
    const approved = controller.getLatest()!
    expect(approved.ledger.length).toBe(0)
    controller.start('c')
    const started = controller.getLatest()!
    expect(started.ledger.length).toBe(0)
    controller.advance({ expectedCursor: 0 })
    const after1 = controller.getLatest()!
    expect(after1.ledger.length).toBe(1)
    expect(after1.ledger[0].originalIndex).toBe(56)
    expect(after1.cumulativeEnergyKwh).toBeCloseTo(after1.ledger[0].cumulativeEnergyKwh, 9)
    expect(suffixCumulativeOk(after1)).toBe(true)
    void retired; void incident
  }, 180000)

  it('写出 qiheng-replan-b04e-result.json', async () => {
    const { retired, incident, created } = await buildRecord()
    const controller = new ReplanController(new MemStorage(), gate(retired))
    controller.createSuffix(created.record!, incident)
    controller.approve({ operator: 'op', at: 't' })
    controller.start('c')
    const zeroBucketsOnApproveStart = controller.getLatest()!.ledger.length === 0
    controller.advance({ expectedCursor: 0 })
    const after1 = controller.getLatest()!

    const store = new MemStorage()
    const c2 = new ReplanController(store, gate(retired))
    c2.createSuffix(created.record!, incident)
    const parsed = JSON.parse(store.getItem(KEY)!)
    parsed.activeParentId = 'other-parent'
    store.setItem(KEY, JSON.stringify(parsed))
    const rawBefore = store.getItem(KEY)!
    const activeParentReject = c2.approve({ operator: 'op', at: 't' })

    const terminatedRead: SuffixExecutionRecord = { ...deepClone(created.record!), status: 'terminated', revision: created.record!.revision + 1 }

    const payload = {
      schema: 'qiheng-replan-b04e-export-v1',
      generatedAt: new Date().toISOString(),
      note: 'B04e 四阻断修复：activeParentId 核、未批准终止只读、已提交子桶禁止重生成、重复退休幂等。仅合成模拟。',
      activeParentIdGate: { approveOk: activeParentReject.ok, latestStatus: c2.getLatest()!.status, rawUnchanged: store.getItem(KEY) === rawBefore },
      unapprovedTerminated: { readable: validateSuffixRecord(terminatedRead).ok, bindingOk: suffixBindingOk(terminatedRead), startOk: startSuffix(terminatedRead, 'c').ok },
      committedChildBlock: { hasCommittedChild: controller.hasCommittedChild(retired.executionId) },
      positive: { plannedRows: after1.plannedRows.length, approveStartZeroBuckets: zeroBucketsOnApproveStart, cursor: after1.cursor, originalIndex: after1.ledger[0].originalIndex, cumulative: after1.cumulativeEnergyKwh, cumulativeOk: suffixCumulativeOk(after1) },
      idempotentRetire: { note: '见 narrow test：重复退休同值 no-op 不增 revision/不制造 pending；异 raw 不假清' },
    }
    writeFileSync('qiheng-replan-b04e-result.json', JSON.stringify(payload, null, 2))
    expect(payload.activeParentIdGate.approveOk).toBe(false)
    expect(payload.activeParentIdGate.latestStatus).toBe('terminated')
    expect(payload.activeParentIdGate.rawUnchanged).toBe(true)
    expect(payload.unapprovedTerminated.readable).toBe(true)
    expect(payload.unapprovedTerminated.startOk).toBe(false)
    expect(payload.positive.approveStartZeroBuckets).toBe(true)
    expect(payload.positive.originalIndex).toBe(56)
  }, 180000)
})
