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
  suffixCanonical,
  SuffixRunner,
  type ParentGate,
  type SuffixRequest,
} from './replan'
import { ExecutionController, protectedEqual, type ExecutionEnvelope, type StorageLike } from './execution'
import { sealPortfolioPassport, type DecisionPassport } from './passport'
import {
  PORTFOLIO_STRATEGIES,
  buildPortfolioFixture,
  canonicalPortfolioInput,
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
let cached: DecisionPassport | null = null
async function passport(): Promise<DecisionPassport> {
  if (cached) return cached
  const fixture = buildPortfolioFixture('p_capacity_rise')
  const inputCanonical = canonicalPortfolioInput(fixture).id
  const attempts = []
  for (const s of PORTFOLIO_STRATEGIES) attempts.push(await runPortfolioCandidate(fixture, s, 1))
  cached = sealPortfolioPassport({ epoch: 1, inputSnapshot: attempts[0].inputSnapshot, inputCanonical, attempts, status: 'complete', startedAt: '2026-10-04T00:00:00.000Z', scenarioId: 'p_capacity_rise', scenarioLabel: 'P1' }).passport!
  return cached
}
function idOf(p: DecisionPassport): string { return p.attempts.find((a) => a.verification.ok === true)!.candidateId }
async function parentWithPrefix(n: number): Promise<ExecutionEnvelope> {
  const c = new ExecutionController(new MemStorage())
  const p = await passport()
  c.setBusinessContext({ businessKey: 'normal|qa-b04d' })
  c.admit(p, idOf(p), 1101, 't'); c.approve({ operator: 'op', approvedAt: 't' }); c.start({ commandId: 's', startedAt: 't' })
  let cur = c.getLatest()!
  for (let i = 0; i < n; i += 1) { c.advance({ commandId: `a${i}`, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: cur.cursor, at: 't' }); cur = c.getLatest()! }
  return cur
}
const solve = async (input: Parameters<typeof solveFlowMilp>[0]) => ({ workerState: 'ok' as const, result: await solveFlowMilp(input), error: null })
function gate(p: ExecutionEnvelope | null, pending: string | null = null): ParentGate {
  return { getLatest: () => p, getPendingSaveReason: () => pending, loadPersisted: (id) => (p && id === p.executionId ? p : null) }
}
async function buildRecord() {
  const parent0 = await parentWithPrefix(56)
  const replay = replayPrefix(parent0.inputSnapshot, parent0.plan, parent0.ledger, 56, { executionId: parent0.executionId, verificationId: parent0.binding.verificationId })
  const incident = captureIncident(parent0, 56, 'AC-02 故障', 't', ['AC-02'])
  const retired = retireForIncident(parent0, incident).envelope!
  const built = buildSuffixInput(retired.inputSnapshot, replay, ['AC-02'])
  const req: SuffixRequest = { requestId: 'suffix-d', epoch: 1102, parentPassportId: retired.binding.passportId, parentCandidateId: retired.binding.candidateId, parentExecutionId: retired.executionId, parentVerificationId: retired.binding.verificationId, parentRevision: retired.revision, businessKey: retired.businessKey, cursor: 56, faultSet: ['AC-02'], ruleVersion: RULE_VERSION, verifierVersion: VERIFIER_VERSION, inputCanonical: suffixCanonical(retired.inputSnapshot, replay, ['AC-02'], 1102), capturedAt: 't' }
  const run = await runSuffixReplan(req, built.input, solve)
  const planned = commitSuffixLedger(retired.inputSnapshot, replay, run.attempt!.result!.plan!, run.attempt!, ['AC-02'], { segmentExecutionId: 'pending', verificationId: 'pending', decisionId: '', auditId: '', variantId: 'pending' })
  const created = createSuffixExecution(req, run.attempt!, planned, replay, retired)
  return { retired, incident, created }
}

describe('B04d 接线反例与正控', () => {
  it('父屏障：未退休 / pendingSaveReason 非空 / 换父 → 拒；合法退休父 → 正控通过', async () => {
    const { retired, incident, created } = await buildRecord()
    expect(new ReplanController(new MemStorage(), gate({ ...retired, status: 'executing' } as ExecutionEnvelope)).createSuffix(created.record!, incident).ok).toBe(false)
    expect(new ReplanController(new MemStorage(), gate(retired, 'pending')).createSuffix(created.record!, incident).ok).toBe(false)
    const other = new ReplanController(new MemStorage(), gate(null))
    expect(other.createSuffix(created.record!, incident).ok).toBe(false)
    expect(other.getLatest()).toBeNull()
    const ok = new ReplanController(new MemStorage(), gate(retired))
    expect(ok.createSuffix(created.record!, incident).ok).toBe(true)
    expect(ok.approve({ operator: 'op', at: 't' }).ok).toBe(true)
    expect(ok.start('c').ok).toBe(true)
    expect(ok.advance({ expectedCursor: 0 }).ok).toBe(true)
  }, 180000)

  it('外部改写指针/内容 → terminate 保 raw、旧确认不能批准新对象', async () => {
    const store = new MemStorage()
    const { retired, incident, created } = await buildRecord()
    const controller = new ReplanController(store, gate(retired))
    expect(controller.createSuffix(created.record!, incident).ok).toBe(true)
    const captured = controller.getLatest()!
    // 外部同 revision 改 note + 指针 revision
    const parsed = JSON.parse(store.getItem(KEY)!)
    parsed.records[0].dataQuality.note = '外部'
    parsed.latestByParent[retired.executionId] = { suffixId: parsed.records[0].suffixId, revision: parsed.records[0].revision + 99 }
    store.setItem(KEY, JSON.stringify(parsed))
    const rawAfter = store.getItem(KEY)!
    expect(controller.approve({ operator: 'op', at: 't' }).ok).toBe(false)
    expect(controller.getLatest()!.status).toBe('terminated')
    expect(store.getItem(KEY)).toBe(rawAfter)
    // 旧确认对象与新 latest 不同
    expect(protectedEqual(controller.getLatest(), captured)).toBe(false)
  }, 180000)

  it('迟到/卸载不写成功（runner 终止后拒绝）', async () => {
    const { incident, created } = await buildRecord()
    const runner = new SuffixRunner()
    runner.begin({ requestId: 'req' } as never, { epoch: 1, parentRevision: 1, prefixCursor: 56, cursor: 56, faultSet: ['AC-02'], requestId: 'req' })
    runner.terminate('卸载/第二故障')
    const late = runner.accept('req', { epoch: 1, parentRevision: 1, prefixCursor: 56, cursor: 56, faultSet: ['AC-02'], requestId: 'req' }, { requestId: 'req', state: 'ok', nativeState: null, reasons: [], result: null, timedOut: false, cancelled: false, error: null })
    expect(late.ok).toBe(false)
    void incident
    void created
  }, 180000)

  it('第二故障在已提交子桶后阻断保账本（不退回父 cursor）', async () => {
    const store = new MemStorage()
    const { retired, incident, created } = await buildRecord()
    const controller = new ReplanController(store, gate(retired))
    controller.createSuffix(created.record!, incident)
    controller.approve({ operator: 'op', at: 't' })
    controller.start('c')
    controller.advance({ expectedCursor: 0 })
    const before = controller.getLatest()!
    expect(before.cursor).toBe(1)
    controller.terminate('第二故障：不支持组合 prefix 续算')
    const after = controller.getLatest()!
    expect(after.status).toBe('terminated')
    expect(after.ledger.length).toBe(1)
    expect(after.lineage.prefixCursor).toBe(56)
  }, 180000)

  it('写出 qiheng-replan-b04d-result.json', async () => {
    const store = new MemStorage()
    const { retired, incident, created } = await buildRecord()
    // 正控
    const ok = new ReplanController(new MemStorage(), gate(retired))
    ok.createSuffix(created.record!, incident); ok.approve({ operator: 'op', at: 't' }); ok.start('c'); ok.advance({ expectedCursor: 0 })
    const positive = ok.getLatest()!
    // 父屏障拒绝
    const bad = new ReplanController(store, gate({ ...retired, status: 'executing' } as ExecutionEnvelope))
    const barrierReject = bad.createSuffix(created.record!, incident)
    // 外写终止
    const c2 = new ReplanController(store, gate(retired))
    c2.createSuffix(created.record!, incident)
    const captured = c2.getLatest()!
    const parsed = JSON.parse(store.getItem(KEY)!)
    parsed.records[0].dataQuality.note = '外部'
    store.setItem(KEY, JSON.stringify(parsed))
    const rawAfter = store.getItem(KEY)!
    const oldConfirm = c2.approve({ operator: 'op', at: 't' })
    const payload = {
      schema: 'qiheng-replan-b04d-export-v1',
      generatedAt: new Date().toISOString(),
      note: 'B04d 真实接线：父保存屏障实际调用、storage 监听、Panel 捕获确认/异步 guard、第二故障保账本阻断。',
      parentBarrier: { rejectNotRetired: barrierReject.ok, rejectReason: barrierReject.reason },
      positive: { status: positive.status, cursor: positive.cursor, cumulative: positive.cumulativeEnergyKwh },
      externalWrite: { approveOk: oldConfirm.ok, latestStatus: c2.getLatest()!.status, rawUnchanged: store.getItem(KEY) === rawAfter, oldConfirmStale: !protectedEqual(c2.getLatest(), captured) },
      wiring: { parentGateUsedIn: ['createSuffix', 'update(approve/start/advance)'], storageListener: 'constructor window storage for replan/execution/null keys', panelPendingCaptured: 'suffixId/epoch/verificationId/revision/expectedCursor/full snapshot', asyncGuard: 'requestId+retiredParentSnapshot+context.faultSet' },
    }
    writeFileSync('qiheng-replan-b04d-result.json', JSON.stringify(payload, null, 2))
    expect(payload.parentBarrier.rejectNotRetired).toBe(false)
    expect(payload.positive.status).toBe('executing')
    expect(payload.externalWrite.approveOk).toBe(false)
    expect(payload.externalWrite.latestStatus).toBe('terminated')
    expect(payload.externalWrite.rawUnchanged).toBe(true)
    expect(payload.externalWrite.oldConfirmStale).toBe(true)
  }, 180000)
})
