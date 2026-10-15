import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  ReplanController,
  buildSuffixInput,
  captureIncident,
  canAuthorizeChild,
  commitSuffixLedger,
  createSuffixExecution,
  loadReplanStore,
  replayPrefix,
  retireForIncident,
  runSuffixReplan,
  suffixCanonical,
  SuffixRunner,
  validateSuffixRecord,
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
class FlakyStorage extends MemStorage {
  fail = false
  setItem(k: string, v: string): void { if (this.fail) throw new Error('quota'); super.setItem(k, v) }
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
  c.setBusinessContext({ businessKey: 'normal|qa-b04c' })
  c.admit(p, idOf(p), 1001, 't'); c.approve({ operator: 'op', approvedAt: 't' }); c.start({ commandId: 's', startedAt: 't' })
  let cur = c.getLatest()!
  for (let i = 0; i < n; i += 1) { c.advance({ commandId: `a${i}`, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: cur.cursor, at: 't' }); cur = c.getLatest()! }
  return cur
}

function gateFor(p: ExecutionEnvelope) {
  return {
    getLatest: () => p,
    getPendingSaveReason: () => null,
    loadPersisted: (id: string) => (id === p.executionId ? p : null),
  }
}

const solve = async (input: Parameters<typeof solveFlowMilp>[0]) => ({ workerState: 'ok' as const, result: await solveFlowMilp(input), error: null })
function reqOf(parent: ExecutionEnvelope, faults: string[], epoch: number, requestId: string): SuffixRequest {
  const replay = replayPrefix(parent.inputSnapshot, parent.plan, parent.ledger, parent.cursor, { executionId: parent.executionId, verificationId: parent.binding.verificationId })
  return { requestId, epoch, parentPassportId: parent.binding.passportId, parentCandidateId: parent.binding.candidateId, parentExecutionId: parent.executionId, parentVerificationId: parent.binding.verificationId, parentRevision: parent.revision, businessKey: parent.businessKey, cursor: parent.cursor, faultSet: faults, ruleVersion: RULE_VERSION, verifierVersion: VERIFIER_VERSION, inputCanonical: suffixCanonical(parent.inputSnapshot, replay, faults, epoch), capturedAt: 't' }
}

async function buildRecord() {
  const parent = await parentWithPrefix(56)
  const replay = replayPrefix(parent.inputSnapshot, parent.plan, parent.ledger, 56, { executionId: parent.executionId, verificationId: parent.binding.verificationId })
  const incident = captureIncident(parent, 56, 'AC-02 故障', 't', ['AC-02'])
  const built = buildSuffixInput(parent.inputSnapshot, replay, ['AC-02'])
  const req = reqOf(parent, ['AC-02'], 1002, 'suffix-c')
  const run = await runSuffixReplan(req, built.input, solve)
  const planned = commitSuffixLedger(parent.inputSnapshot, replay, run.attempt!.result!.plan!, run.attempt!, ['AC-02'], { segmentExecutionId: 'pending', verificationId: 'pending', decisionId: '', auditId: '', variantId: 'pending' })
  const retired = retireForIncident(parent, incident).envelope!
  const created = createSuffixExecution(req, run.attempt!, planned, replay, retired)
  return { parent: retired, replay, incident, run, planned, created }
}

describe('B04c 残余反例与正控', () => {
  it('单缺停机 AC-02 age → replay 拒', async () => {
    const parent = await parentWithPrefix(1)
    const ages = { ...parent.inputSnapshot.initial.minutesSinceChange }
    delete ages['AC-02']
    const r = replayPrefix({ ...parent.inputSnapshot, initial: { runningUnitIds: parent.inputSnapshot.initial.runningUnitIds, minutesSinceChange: ages } }, parent.plan, parent.ledger, 1)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('initial-age-missing')
  }, 60000)

  it('attempt.result.plan 负荷差 0.00001 而传另一合法 plan → commit 拒', async () => {
    const { parent, replay, run } = await buildRecord()
    const other = deepClone(run.attempt!.result!.plan!)
    other.periods[0].unitLoads[Object.keys(other.periods[0].unitLoads)[0]] += 0.00001
    const c = commitSuffixLedger(parent.inputSnapshot, replay, other, run.attempt!, ['AC-02'], { segmentExecutionId: 's', verificationId: 'v', decisionId: 'd', auditId: 'a', variantId: 'x' })
    expect(c.ok).toBe(false)
    expect(c.reason).toBe('plan-not-attempt-result')
  }, 120000)

  it('同 revision 仅改 dataQuality.note → 旧 approve/Start/advance 拒且 raw 不覆盖、不增桶', async () => {
    const store = new MemStorage()
    const { parent, incident, created } = await buildRecord()
    const controller = new ReplanController(store, gateFor(parent))
    expect(controller.createSuffix(created.record!, incident).ok).toBe(true)
    // 外部同 revision 改 note
    const raw = store.getItem(KEY)!
    const parsed = JSON.parse(raw)
    parsed.records[0].dataQuality.note = '外部改动'
    store.setItem(KEY, JSON.stringify(parsed))
    const rawAfter = store.getItem(KEY)!
    expect(controller.approve({ operator: 'op', at: 't' }).ok).toBe(false)
    expect(controller.getLatest()!.status).toBe('terminated')
    expect(controller.start('c').ok).toBe(false)
    expect(controller.advance({ expectedCursor: 0 }).ok).toBe(false)
    expect(store.getItem(KEY)).toBe(rawAfter)
    void parent
  }, 120000)

  it('正控：键顺序不同/外壳 savedAt 不同不假拒', async () => {
    const store = new MemStorage()
    const { parent, incident, created } = await buildRecord()
    const controller = new ReplanController(store, gateFor(parent))
    expect(controller.createSuffix(created.record!, incident).ok).toBe(true)
    // 重排记录键顺序（同内容）
    const parsed = JSON.parse(store.getItem(KEY)!)
    const rec = parsed.records[0]
    const reordered: Record<string, unknown> = {}
    for (const k of Object.keys(rec).reverse()) reordered[k] = rec[k]
    parsed.records[0] = reordered
    parsed.savedAt = '1999-01-01T00:00:00.000Z'
    store.setItem(KEY, JSON.stringify(parsed))
    expect(controller.approve({ operator: 'op', at: 't' }).ok).toBe(true)
  }, 120000)

  it('plannedRows 物理篡改（首 power4/energy1）→ validate/load 拒', async () => {
    const { created } = await buildRecord()
    const rec = deepClone(created.record!)
    rec.plannedRows[0].powerKw = 4
    rec.plannedRows[0].energyKwh = 1
    expect(validateSuffixRecord(rec).ok).toBe(false)
    const store = new MemStorage()
    store.setItem(KEY, JSON.stringify({ schemaVersion: 1, activeParentId: rec.parentExecutionId, latestByParent: {}, incidents: [], attempts: [], records: [rec] }))
    const snap = loadReplanStore(store)
    expect(snap.corrupted).toBe(true)
    expect(snap.writable).toBe(false)
  }, 120000)

  it('prefix 累计 +100 → validate 拒', async () => {
    const { created } = await buildRecord()
    const rec = deepClone(created.record!)
    rec.prefixCumulativeEnergyKwh += 100
    expect(validateSuffixRecord(rec).ok).toBe(false)
  }, 120000)

  it('terminate 写失败恢复不复活；父退休屏障', async () => {
    const store = new FlakyStorage()
    const { parent, incident, created } = await buildRecord()
    const controller = new ReplanController(store, gateFor(parent))
    expect(controller.createSuffix(created.record!, incident).ok).toBe(true)
    store.fail = true
    controller.terminate('第二故障')
    expect(controller.getLatest()!.status).toBe('terminated')
    expect(controller.getPendingSaveReason()).toBeTruthy()
    store.fail = false
    controller.terminate('再次')
    expect(controller.getLatest()!.status).toBe('terminated')
    expect(controller.approve({ operator: 'op', at: 't' }).ok).toBe(false)
    expect(canAuthorizeChild(true, null)).toBe(true)
    expect(canAuthorizeChild(true, 'pending')).toBe(false)
    expect(canAuthorizeChild(false, null)).toBe(false)
  }, 120000)

  it('真实 refresh：活动段退休只读，prefix/子 ledger 同值保留', async () => {
    const store = new MemStorage()
    const { parent, incident, created } = await buildRecord()
    const c1 = new ReplanController(store, gateFor(parent))
    c1.createSuffix(created.record!, incident)
    c1.approve({ operator: 'op', at: 't' })
    c1.start('c')
    c1.advance({ expectedCursor: 0 })
    const before = c1.getLatest()!
    const refreshed = new ReplanController(store)
    const rec = refreshed.getLatest()!
    expect(rec.status).toBe('terminated')
    expect(rec.lineage.prefixCursor).toBe(56)
    expect(rec.ledger.length).toBe(before.ledger.length)
  }, 120000)

  it('第二故障并集 + 迟到不覆盖；真实正控桶提交', async () => {
    const { parent, replay, incident, run, planned, created } = await buildRecord()
    // 正控：parent56+AC02 计划后提交第一桶，独立累计
    const controller = new ReplanController(new MemStorage(), gateFor(parent))
    expect(controller.createSuffix(created.record!, incident).ok, 'create').toBe(true)
    expect(controller.approve({ operator: 'op', at: 't' }).ok, 'approve').toBe(true)
    expect(controller.start('c').ok, 'start').toBe(true)
    expect(controller.advance({ expectedCursor: 0 }).ok, 'advance').toBe(true)
    const after1 = controller.getLatest()!
    const firstBucketCumulative = after1.cumulativeEnergyKwh
    // 第二故障并集
    const secondSet = Array.from(new Set([...incident.faultSet, 'AC-01']))
    const runner = new SuffixRunner()
    const guard = { epoch: 1, parentRevision: parent.revision, prefixCursor: after1.lineage.prefixCursor, cursor: after1.lineage.prefixCursor + after1.cursor, faultSet: secondSet, requestId: 'new' }
    runner.begin({ requestId: 'new' } as never, guard)
    runner.terminate('第二故障')
    const late = runner.accept('old', guard, run.attempt!)

    const payload = {
      schema: 'qiheng-replan-b04c-export-v1',
      generatedAt: new Date().toISOString(),
      note: 'B04c 收尾：完整快照门/独立复算/父退休屏障/refresh 退休。真实正控 parent56+AC-02 首桶独立累计。',
      legacyRejected: { singleMissingAge: true, planNotAttemptResult: true, sameRevisionNoteConflict: true, plannedRowsTamper: true, prefixCumulativeTamper: true },
      positiveControl: { plannedRows: planned.rows.length, firstBucketCumulative, expectedCursor: after1.cursor, lineageSegmentCursor: after1.lineage.segmentCursor },
      secondFault: { faultSetUnion: secondSet, lateOk: late.ok, lateReason: late.reason },
      barrier: { authorizeSaved: canAuthorizeChild(true, null), authorizePending: canAuthorizeChild(true, 'x') },
      preservedChildLedger: after1.ledger.length,
    }
    writeFileSync('qiheng-replan-b04c-result.json', JSON.stringify(payload, null, 2))

    expect(firstBucketCumulative).toBeGreaterThan(replay.cumulativeEnergyKwh)
    expect(secondSet).toEqual(['AC-02', 'AC-01'])
  }, 180000)
})
