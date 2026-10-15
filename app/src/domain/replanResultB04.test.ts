import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  SuffixRunner,
  buildSuffixInput,
  captureIncident,
  classifySuffixOutcome,
  commitSuffixLedger,
  createSuffixExecution,
  replayPrefix,
  retireForIncident,
  runSuffixReplan,
  suffixBindingOk,
  suffixCanonical,
  suffixCumulativeOk,
  ReplanController,
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
    epoch: 1, inputSnapshot: attempts[0].inputSnapshot, inputCanonical, attempts,
    status: 'complete', startedAt: '2026-10-04T00:00:00.000Z', scenarioId: 'p_capacity_rise', scenarioLabel: 'P1',
  }).passport!
  return cached
}
function idOf(p: DecisionPassport): string {
  return p.attempts.find((a) => a.verification.ok === true)!.candidateId
}
async function parentWithPrefix(buckets: number): Promise<ExecutionEnvelope> {
  const c = new ExecutionController(new MemStorage())
  const p = await passport()
  c.setBusinessContext({ businessKey: 'normal|qa-b04b' })
  c.admit(p, idOf(p), 901, 't')
  c.approve({ operator: 'op', approvedAt: 't' })
  c.start({ commandId: 's', startedAt: 't' })
  let cur = c.getLatest()!
  for (let i = 0; i < buckets; i += 1) {
    c.advance({ commandId: `a${i}`, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: cur.cursor, at: 't' })
    cur = c.getLatest()!
  }
  return cur
}

function gateFor(p: ExecutionEnvelope) {
  return {
    getLatest: () => p,
    getPendingSaveReason: () => null,
    loadPersisted: (id: string) => (id === p.executionId ? p : null),
  }
}

const solve = async (input: Parameters<typeof solveFlowMilp>[0]) => {
  const result = await solveFlowMilp(input)
  return { workerState: 'ok' as const, result, error: null }
}
function reqOf(parent: ExecutionEnvelope, faults: string[], epoch: number, requestId: string): SuffixRequest {
  const replay = replayPrefix(parent.inputSnapshot, parent.plan, parent.ledger, parent.cursor, { executionId: parent.executionId, verificationId: parent.binding.verificationId })
  return {
    requestId, epoch, parentPassportId: parent.binding.passportId, parentCandidateId: parent.binding.candidateId,
    parentExecutionId: parent.executionId, parentVerificationId: parent.binding.verificationId,
    parentRevision: parent.revision, businessKey: parent.businessKey, cursor: parent.cursor, faultSet: faults,
    ruleVersion: RULE_VERSION, verifierVersion: VERIFIER_VERSION, inputCanonical: suffixCanonical(parent.inputSnapshot, replay, faults, epoch),
    capturedAt: 't',
  }
}

describe('B04b suffix 结果导出', () => {
  it('写出 qiheng-replan-b04b-result.json（真实成功/无解/拒绝）', async () => {
    // 真实成功：P1 原计划提交到 cursor56，AC-02 故障（剩余≤20 由 AC-01）
    const parent56 = await parentWithPrefix(56)
    const replay56 = replayPrefix(parent56.inputSnapshot, parent56.plan, parent56.ledger, 56, { executionId: parent56.executionId, verificationId: parent56.binding.verificationId })
    expect(replay56.ok, replay56.reason ?? '').toBe(true)
    const incident = captureIncident(parent56, 56, 'AC-02 故障', '2026-10-04T02:00:00.000Z', ['AC-02'])
    const retired = retireForIncident(parent56, incident).envelope!
    const built56 = buildSuffixInput(parent56.inputSnapshot, replay56, ['AC-02'])
    const req56 = reqOf(parent56, ['AC-02'], 902, 'suffix-ok')
    const run56 = await runSuffixReplan(req56, built56.input, solve)
    expect(run56.attempt!.state, run56.attempt!.reasons.join('；')).toBe('ok')
    const planned = commitSuffixLedger(parent56.inputSnapshot, replay56, run56.attempt!.result!.plan!, run56.attempt!, ['AC-02'], { segmentExecutionId: 'pending', verificationId: 'pending', decisionId: '', auditId: '', variantId: 'pending' })
    expect(planned.ok, planned.reason ?? '').toBe(true)

    const controller = new ReplanController(new MemStorage(), gateFor(retired))
    const created = createSuffixExecution(req56, run56.attempt!, planned, replay56, parent56)
    expect(created.ok).toBe(true)
    const createdRec = created.record!
    expect(createdRec.ledger).toHaveLength(0)
    expect(createdRec.cumulativeEnergyKwh).toBe(replay56.cumulativeEnergyKwh)
    expect(createdRec.lineage.prefixCursor).toBe(56)
    expect(createdRec.windowStartIndex + createdRec.lineage.segmentCursor).toBe(56)
    expect(controller.createSuffix(createdRec, incident).ok).toBe(true)
    expect(controller.approve({ operator: '张三-合成', at: 't' }).ok).toBe(true)
    const approvedRec = controller.getLatest()!
    expect(approvedRec.binding.decisionId && approvedRec.binding.auditId).toBeTruthy()
    expect(controller.start('c1').ok).toBe(true)
    controller.advance({ expectedCursor: 0 })
    controller.advance({ expectedCursor: 1 })
    const advanced = controller.getLatest()!
    const ledger = advanced.ledger
    const origUnique = new Set(ledger.map((r) => r.originalIndex)).size === ledger.length
    const boundOk = suffixBindingOk(advanced)
    const lineOk = advanced.lineage.segmentCursor === advanced.cursor

    // 真实无解：cursor3 AC-01 故障（AC-02 容量不足）
    const parent3 = await parentWithPrefix(3)
    const replay3 = replayPrefix(parent3.inputSnapshot, parent3.plan, parent3.ledger, 3, { executionId: parent3.executionId, verificationId: parent3.binding.verificationId })
    const built3 = buildSuffixInput(parent3.inputSnapshot, replay3, ['AC-01'])
    const req3 = reqOf(parent3, ['AC-01'], 903, 'suffix-null')
    const run3 = await runSuffixReplan(req3, built3.input, solve)
    expect(run3.attempt!.state).not.toBe('timeout')
    expect(run3.attempt!.result?.plan ?? null).toBeNull()

    // 拒绝：错时刻(93桶 minute 改动) / AC-01 故障资格用 AC-01 计划 / prefix cursor 不符 / 缺 age / NaN 能量 / 空 faultSet
    const wrongMinute = deepClone(run56.attempt!.result!.plan!)
    wrongMinute.periods[0].minuteOfDay += 15
    const wrongMinuteCommit = commitSuffixLedger(parent56.inputSnapshot, replay56, wrongMinute, run56.attempt!, ['AC-02'], { segmentExecutionId: 's', verificationId: 'v', decisionId: 'd', auditId: 'a', variantId: 'x' })
    const ineligibleCommit = commitSuffixLedger(parent56.inputSnapshot, replay56, run56.attempt!.result!.plan!, run56.attempt!, ['AC-01'], { segmentExecutionId: 's', verificationId: 'v', decisionId: 'd', auditId: 'a', variantId: 'x' })
    const cursorMismatch = replayPrefix(parent56.inputSnapshot, parent56.plan, parent56.ledger, 55)
    const missingAge = replayPrefix({ ...parent56.inputSnapshot, initial: { runningUnitIds: ['AC-01'], minutesSinceChange: {} } }, parent56.plan, parent56.ledger, 56)
    const parent1 = await parentWithPrefix(1)
    const nanLedger = deepClone(parent1.ledger)
    nanLedger[0].energyKwh = NaN
    const nanReplay = replayPrefix(parent1.inputSnapshot, parent1.plan, nanLedger, 1)
    const emptyFault = buildSuffixInput(parent56.inputSnapshot, replay56, [])

    // controller quota：create 写失败不发布
    const boom = new ReplanController(new BoomStorage(), gateFor(retired))
    const boomCreate = boom.createSuffix(createdRec, null)

    // 迟到/第二故障
    const runner = new SuffixRunner()
    const guard = { epoch: 1, parentRevision: parent56.revision, prefixCursor: 56, cursor: 56, faultSet: ['AC-02'], requestId: 'new' }
    runner.begin(req56, guard)
    runner.terminate('第二故障 AC-01')
    const late = runner.accept('old', guard, run56.attempt!)

    // 刷新：按 latest 链指针恢复
    const storeController = new ReplanController(new MemStorage(), gateFor(retired))
    storeController.createSuffix(createdRec, null)
    const refreshed = new ReplanController((storeController as unknown as { storage: StorageLike }).storage)

    const payload = {
      schema: 'qiheng-replan-b04b-export-v1',
      generatedAt: new Date().toISOString(),
      note: 'B04b：真实成功（P1 原计划 cursor56 + AC-02 故障，剩余由 AC-01）与真实无解（cursor3 AC-01 故障）；完整 faultSet/原 prefix；不改需求/初态。',
      incident: { atIndex: incident.atIndex, faultSet: incident.faultSet, reason: incident.reason },
      retired: { status: retired.status, prefixLength: retired.ledger.length },
      success: {
        attemptState: run56.attempt!.state,
        windowStartIndex: replay56.windowStartIndex,
        plannedRows: planned.rows.length,
        prefixCumulativeEnergyKwh: replay56.cumulativeEnergyKwh,
        createdLedgerEmpty: createdRec.ledger.length === 0,
        createdCumulativeIsPrefix: createdRec.cumulativeEnergyKwh === replay56.cumulativeEnergyKwh,
        bindingFiveIds: { segment: approvedRec.binding.segmentExecutionId, verification: approvedRec.binding.verificationId, decision: approvedRec.binding.decisionId, audit: approvedRec.binding.auditId, variant: approvedRec.binding.variantId },
        advancedCursor: advanced.cursor,
        committedRows: ledger.length,
        originalIndexUnique: origUnique,
        bindingOk: boundOk,
        lineageSyncOk: lineOk,
        cumulativeOk: suffixCumulativeOk(advanced),
        committedCumulativeEnergyKwh: advanced.cumulativeEnergyKwh,
      },
      nullStory: { faultSet: ['AC-01'], attemptState: run3.attempt!.state, plan: null, isTimeout: run3.attempt!.state === 'timeout' },
      rejects: {
        wrongMinute: { ok: wrongMinuteCommit.ok, reason: wrongMinuteCommit.reason },
        ineligibleFaultPlan: { ok: ineligibleCommit.ok, reason: ineligibleCommit.reason },
        prefixCursorMismatch: { ok: cursorMismatch.ok, reason: cursorMismatch.reason },
        missingAge: { ok: missingAge.ok, reason: missingAge.reason },
        nanEnergy: { ok: nanReplay.ok, reason: nanReplay.reason },
        emptyFaultSet: { ok: emptyFault.ok, reason: emptyFault.reason },
      },
      controller: { quotaCreateOk: boomCreate.ok, quotaLatestNull: boom.getLatest() === null, refreshStatus: refreshed.getLatest()?.status ?? null, refreshPrefixCursor: refreshed.getLatest()?.lineage.prefixCursor ?? null },
      lateAfterSecondFault: { ok: late.ok, reason: late.reason },
      classification: { watchdog: classifySuffixOutcome('watchdog_terminated', null, null), infeasibleNotTimeout: classifySuffixOutcome('ok', { diagnostics: { state: 'infeasible', timedOut: false } } as never, null) },
    }
    writeFileSync('qiheng-replan-b04b-result.json', JSON.stringify(payload, null, 2))

    expect(payload.success.createdLedgerEmpty).toBe(true)
    expect(payload.success.originalIndexUnique).toBe(true)
    expect(payload.success.bindingOk).toBe(true)
    expect(payload.success.lineageSyncOk).toBe(true)
    expect(payload.rejects.wrongMinute.ok).toBe(false)
    expect(payload.rejects.ineligibleFaultPlan.ok).toBe(false)
    expect(payload.rejects.prefixCursorMismatch.ok).toBe(false)
    expect(payload.rejects.missingAge.ok).toBe(false)
    expect(payload.rejects.nanEnergy.ok).toBe(false)
    expect(payload.rejects.emptyFaultSet.reason).toBe('faultset-empty')
    expect(payload.controller.quotaCreateOk).toBe(false)
    expect(payload.controller.quotaLatestNull).toBe(true)
    expect(payload.lateAfterSecondFault.ok).toBe(false)
  }, 300000)
})
