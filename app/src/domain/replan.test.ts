import { describe, expect, it } from 'vitest'
import {
  SuffixRunner,
  advanceSuffix,
  approveSuffix,
  buildSuffixInput,
  captureIncident,
  classifySuffixOutcome,
  commitSuffixLedger,
  createSuffixExecution,
  replayPrefix,
  retireForIncident,
  runSuffixReplan,
  startSuffix,
  suffixCanonical,
  suffixCumulativeOk,
  type SuffixGuard,
} from './replan'
import {
  ExecutionController,
  advanceExecution,
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
async function parentWithPrefix(buckets: number): Promise<ExecutionEnvelope> {
  const controller = new ExecutionController(new MemStorage())
  const p = await passport()
  controller.setBusinessContext({ businessKey: 'normal|qa-b04' })
  controller.admit(p, idOf(p), 401, 't')
  controller.approve({ operator: 'op', approvedAt: 't' })
  controller.start({ commandId: 's', startedAt: 't' })
  let cur = controller.getLatest()!
  for (let i = 0; i < buckets; i += 1) {
    const r = controller.advance({ commandId: `a${i}`, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: cur.cursor, at: 't' })
    cur = controller.getLatest()!
    if (!r.ok) break
  }
  return cur
}
const solve = async (input: Parameters<typeof solveFlowMilp>[0], _rid: string) => {
  const result = await solveFlowMilp(input)
  return { workerState: 'ok' as const, result, error: null }
}

describe('B04 suffix：prefix 重放与原 index', () => {
  it('prefix 重放 OK；index/min/累计一致；lastChange=首时刻−age、翻转记原 minute', async () => {
    const parent = await parentWithPrefix(3)
    const replay = replayPrefix(parent.inputSnapshot, parent.plan, parent.ledger, 3)
    expect(replay.ok, replay.reason ?? '').toBe(true)
    expect(replay.windowStartIndex).toBe(3)
    expect(replay.endMinute).toBe(parent.inputSnapshot.points[2].minuteOfDay)
    expect(replay.nextMinute).toBe(parent.inputSnapshot.points[3].minuteOfDay)
    expect(replay.cumulativeEnergyKwh).toBeCloseTo(parent.ledger[2].cumulativeEnergyKwh, 9)
    // age = 下一原桶时刻 − lastChange
    for (const [id, age] of Object.entries(replay.initial!.minutesSinceChange)) {
      expect(age).toBe(replay.nextMinute! - replay.lastChange[id])
    }
  }, 60000)

  it('坏 prefix（累计篡改/初始缺失）阻断，不填 0', async () => {
    const parent = await parentWithPrefix(2)
    const tampered = deepClone(parent.ledger)
    tampered[0].cumulativeEnergyKwh = 1
    const r = replayPrefix(parent.inputSnapshot, parent.plan, tampered, 2)
    expect(r.ok).toBe(false)
    expect(r.initial).toBeNull()
    const noInit = { ...parent.inputSnapshot, initial: { runningUnitIds: ['AC-01'], minutesSinceChange: { 'AC-01': NaN } } }
    expect(replayPrefix(noInit, parent.plan, parent.ledger, 2).ok).toBe(false)
  }, 60000)

  it('suffix 输入保留原 index/minute/demand，且 faultSet 映射资格', async () => {
    const parent = await parentWithPrefix(3)
    const replay = replayPrefix(parent.inputSnapshot, parent.plan, parent.ledger, 3)
    const built = buildSuffixInput(parent.inputSnapshot, replay, ['AC-01'])
    expect(built.ok, built.reason ?? '').toBe(true)
    const input = built.input!
    expect(input.points[0].index).toBe(3)
    expect(input.points[0].minuteOfDay).toBe(parent.inputSnapshot.points[3].minuteOfDay)
    expect(input.points[0].demand).toBe(parent.inputSnapshot.points[3].demand)
    expect(input.points.length).toBe(96 - 3)
    const ac01 = input.eligibility.find((e) => e.unitId === 'AC-01')!
    expect(ac01.eligible).toBe(false)
    expect(input.candidates.map((u) => u.id)).not.toContain('AC-01')
    expect(input.candidates.map((u) => u.id)).not.toContain('AC-03')
  }, 60000)

  it('无剩余桶不求解', async () => {
    const parent = await parentWithPrefix(3)
    const replay = replayPrefix(parent.inputSnapshot, parent.plan, parent.ledger, 3)
    const empty = buildSuffixInput(
      { ...parent.inputSnapshot, points: parent.inputSnapshot.points.slice(0, 3) },
      replay,
      ['AC-02'],
    )
    expect(empty.ok).toBe(false)
    expect(empty.reason).toBe('no-remaining')
  }, 60000)
})

describe('B04 suffix：attempt 状态与 timeout≠infeasible', () => {
  it('watchdog/无可行为 timeout/infeasible 区分', () => {
    expect(classifySuffixOutcome('watchdog_terminated', null, null)).toBe('timeout')
    expect(classifySuffixOutcome('canceled', null, null)).toBe('canceled')
    expect(classifySuffixOutcome('worker_error', null, 'boom')).toBe('worker_error')
    const infeasible = { diagnostics: { state: 'infeasible', timedOut: false } } as never
    expect(classifySuffixOutcome('ok', infeasible, null)).toBe('infeasible')
    const tl = { diagnostics: { state: 'time_limit_with_incumbent', timedOut: true } } as never
    expect(classifySuffixOutcome('ok', tl, null)).toBe('timeout')
  })
})

describe('B04 suffix：真实求解 / 段 ledger / 无解故事', () => {
  it('成功：原需求、累计=prefix+suffix、originalIndex 唯一', async () => {
    const parent = await parentWithPrefix(56)
    const replay = replayPrefix(parent.inputSnapshot, parent.plan, parent.ledger, 56)
    const built = buildSuffixInput(parent.inputSnapshot, replay, ['AC-02'])
    const req = {
      requestId: 'req-1',
      epoch: 501,
      parentPassportId: parent.binding.passportId,
      parentCandidateId: parent.binding.candidateId,
      parentExecutionId: parent.executionId,
      parentVerificationId: parent.binding.verificationId,
      parentRevision: parent.revision,
      businessKey: parent.businessKey,
      cursor: 3,
      faultSet: [],
      ruleVersion: 'r',
      verifierVersion: 'v',
      inputCanonical: suffixCanonical(parent.inputSnapshot, replay, [], 501),
      capturedAt: 't',
    }
    const run = await runSuffixReplan(req, built.input, solve)
    expect(run.attempt!.state).toBe('ok')
    const binding = { segmentExecutionId: 'seg-1', verificationId: 'qv-seg', decisionId: 'qd-seg', auditId: 'qa-seg', variantId: 'var-1' }
    const ledger = commitSuffixLedger(parent.inputSnapshot, replay, run.attempt!.result!.plan!, run.attempt!, ['AC-02'], binding)
    expect(ledger.ok, ledger.reason ?? '').toBe(true)
    expect(ledger.rows[0].originalIndex).toBe(56)
    expect(ledger.cursor).toBe(96 - 56)
    const orig = ledger.rows.map((r) => r.originalIndex)
    expect(new Set(orig).size).toBe(orig.length)
    expect(ledger.cumulativeEnergyKwh).toBeCloseTo(replay.cumulativeEnergyKwh + run.attempt!.result!.metrics.energyKwh!, 2)
    // 段内 demand 与 parent 原需求一致
    expect(ledger.rows[0].demand).toBe(parent.inputSnapshot.points[56].demand)
  }, 120000)

  it('无解：faultSet=[AC-01] 且需求超出 AC-02 → infeasible（非 timeout）', async () => {
    const parent = await parentWithPrefix(3)
    const replay = replayPrefix(parent.inputSnapshot, parent.plan, parent.ledger, 3)
    const built = buildSuffixInput(parent.inputSnapshot, replay, ['AC-01'])
    const req = {
      requestId: 'req-2', epoch: 502,
      parentPassportId: parent.binding.passportId, parentCandidateId: parent.binding.candidateId,
      parentExecutionId: parent.executionId, parentVerificationId: parent.binding.verificationId,
      parentRevision: parent.revision, businessKey: parent.businessKey, cursor: 3, faultSet: ['AC-01'],
      ruleVersion: RULE_VERSION, verifierVersion: VERIFIER_VERSION,
      inputCanonical: suffixCanonical(parent.inputSnapshot, replay, ['AC-01'], 502), capturedAt: 't',
    }
    const run = await runSuffixReplan(req, built.input, solve)
    expect(['infeasible', 'no_primal']).toContain(run.attempt!.state)
    expect(run.attempt!.state).not.toBe('timeout')
    expect(run.attempt!.result?.plan ?? null).toBeNull()
  }, 120000)
})

describe('B04 suffix：runner 迟到/guard/终止', () => {
  const guard: SuffixGuard = { epoch: 1, parentRevision: 4, prefixCursor: 3, cursor: 3, faultSet: [], requestId: 'req-1' }
  const mkAttempt = () => ({ requestId: 'req-1', state: 'ok' as const, nativeState: 'optimal', reasons: [], result: null, timedOut: false, cancelled: false, error: null })

  it('迟到/旧 requestId 丢弃；guard 不匹配丢弃；终止后拒绝', () => {
    const runner = new SuffixRunner()
    runner.begin({ requestId: 'req-1' } as never, guard)
    expect(runner.accept('req-1', guard, mkAttempt()).ok).toBe(true)
    expect(runner.accept('req-old', guard, mkAttempt()).ok).toBe(false)
    expect(runner.accept('req-1', { ...guard, epoch: 9 }, mkAttempt()).ok).toBe(false)
    runner.terminate('第二故障')
    expect(runner.accept('req-1', guard, mkAttempt()).ok).toBe(false)
    expect(runner.isTerminated()).toBe(true)
  })
})

describe('B04 suffix：故障退休不复活', () => {
  it('captureIncident→retire；旧 advance 拒；prefix 保留', async () => {
    const parent = await parentWithPrefix(2)
    const incident = captureIncident(parent, 2, 'AC-01 故障', '2026-10-04T01:00:00.000Z')
    expect(incident.atIndex).toBe(2)
    const retired = retireForIncident(parent, incident)
    expect(retired.ok).toBe(true)
    expect(retired.envelope!.status).toBe('retired')
    expect(retired.envelope!.ledger).toHaveLength(parent.ledger.length)
    expect(parent.ledger).toHaveLength(2)
  }, 60000)
})

describe('B04 suffix：子段执行生命周期与累计复算', () => {
  it('create→approve→start→advance 至 completed；累计=已提交行；重复 Start 拒', async () => {
    const parent = await parentWithPrefix(56)
    const replay = replayPrefix(parent.inputSnapshot, parent.plan, parent.ledger, 56)
    const built = buildSuffixInput(parent.inputSnapshot, replay, ['AC-02'])
    const req = {
      requestId: 'req-life', epoch: 601,
      parentPassportId: parent.binding.passportId, parentCandidateId: parent.binding.candidateId,
      parentExecutionId: parent.executionId, parentVerificationId: parent.binding.verificationId,
      parentRevision: parent.revision, businessKey: parent.businessKey, cursor: 56, faultSet: ['AC-02'],
      ruleVersion: RULE_VERSION, verifierVersion: VERIFIER_VERSION,
      inputCanonical: suffixCanonical(parent.inputSnapshot, replay, ['AC-02'], 601), capturedAt: 't',
    }
    const run = await runSuffixReplan(req, built.input, solve)
    const binding = { segmentExecutionId: 'seg', verificationId: 'qv', decisionId: 'qd', auditId: 'qa', variantId: 'var' }
    const ledger = commitSuffixLedger(parent.inputSnapshot, replay, run.attempt!.result!.plan!, run.attempt!, ['AC-02'], binding)
    const created = createSuffixExecution(req, run.attempt!, ledger, replay, parent)
    expect(created.ok, created.reason ?? '').toBe(true)
    const rec = created.record!
    expect(rec.lineage.prefixCursor).toBe(56)
    expect(rec.windowStartIndex + rec.lineage.segmentCursor).toBe(56)
    const approved = approveSuffix(rec, { operator: '张三-合成', at: 't' }).record!
    expect(approved.status).toBe('approved')
    expect(approved.decisionId && approved.auditId).toBeTruthy()
    let started = startSuffix(approved, 'c1').record!
    expect(startSuffix(started, 'c2').ok).toBe(false)
    let guard = 0
    while (started.status === 'executing' && guard < 200) {
      started = advanceSuffix(started, { expectedCursor: started.cursor, expectedSegmentExecutionId: started.binding.segmentExecutionId, expectedVerificationId: started.binding.verificationId }).record!
      guard += 1
    }
    expect(started.status).toBe('completed')
    expect(started.cursor).toBe(started.ledger.length)
    expect(suffixCumulativeOk(started)).toBe(true)
    expect(started.cumulativeEnergyKwh).toBeCloseTo(replay.cumulativeEnergyKwh + run.attempt!.result!.metrics.energyKwh!, 2)
  }, 120000)

  it('清故障刷新不复活：退休后旧 advance/Start 拒', async () => {
    const parent = await parentWithPrefix(2)
    const incident = captureIncident(parent, 2, 'AC-02 故障', 't')
    const retired = retireForIncident(parent, incident).envelope!
    const r = advanceExecution(retired, { commandId: 'x', executionId: retired.executionId, executionEpoch: retired.executionEpoch, verificationId: retired.binding.verificationId, expectedCursor: retired.cursor, at: 't' })
    expect(r.ok).toBe(false)
  }, 60000)
})
