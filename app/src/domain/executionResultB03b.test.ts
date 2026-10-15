import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  EXECUTION_STORE_KEY,
  ExecutionController,
  admitPassportCandidate,
  advanceExecution,
  exportExecutionJson,
  loadExecutionStore,
  manualApprove,
  rejectExecution,
  retireExecution,
  saveExecutionEnvelope,
  startExecution,
  validateStoredEnvelope,
  type ExecutionEnvelope,
  type StorageLike,
} from './execution'
import { sealPortfolioPassport } from './passport'
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

async function round(fixtureId: Parameters<typeof buildPortfolioFixture>[0], epoch: number) {
  const fixture = buildPortfolioFixture(fixtureId)
  const inputCanonical = canonicalPortfolioInput(fixture).id
  const attempts = []
  for (const s of PORTFOLIO_STRATEGIES) attempts.push(await runPortfolioCandidate(fixture, s, epoch))
  return sealPortfolioPassport({
    epoch,
    inputSnapshot: attempts[0].inputSnapshot,
    inputCanonical,
    attempts,
    status: 'complete',
    startedAt: '2026-10-04T00:00:00.000Z',
    scenarioId: fixtureId,
    scenarioLabel: fixtureId,
  }).passport!
}

describe('B03b 执行结果导出（正常/拒绝/退休）', () => {
  it('写出 qiheng-execution-b03b-result.json', async () => {
    const p1 = await round('p_capacity_rise', 1)
    const legalId = p1.attempts.find((a) => a.verification.ok === true)!.candidateId
    const admitted = admitPassportCandidate(p1, legalId, 101, '2026-10-04T00:00:00.000Z')
    expect(admitted.ok, admitted.reason ?? '').toBe(true)
    const approved = manualApprove(admitted.envelope!, { operator: '张三-合成', approvedAt: '2026-10-04T00:00:01.000Z' })
    let cur: ExecutionEnvelope = startExecution(approved.envelope!, { commandId: 'start-1', startedAt: '2026-10-04T00:00:02.000Z' }).envelope!
    let guard = 0
    while (cur.status === 'executing' && guard < 200) {
      const r = advanceExecution(cur, { commandId: `adv-${cur.cursor}`, executionId: cur.executionId, executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: cur.cursor, at: 't' })
      if (!r.ok || !r.envelope) break
      cur = r.envelope
      guard += 1
    }
    expect(cur.status).toBe('completed')

    const p4 = await round('p_over_capacity', 2)
    const rejectNoSolution = admitPassportCandidate(p4, p4.attempts[0].candidateId, 102, 't')
    const rejectUnknown = admitPassportCandidate(p1, 'not-exist', 103, 't')
    const rejectCanceledStatus = admitPassportCandidate({ ...deepClone(p1), status: 'canceled' }, legalId, 104, 't')
    const rejectBadSource = admitPassportCandidate({ ...deepClone(p1), inputSource: 'official-unverified' }, legalId, 105, 't')
    const rejectBadRule = admitPassportCandidate({ ...deepClone(p1), ruleVersion: 'unsupported' }, legalId, 106, 't')

    // 错 binding：顶层改 passportId + link.auditId 空 → Start 拒
    const a2 = manualApprove(admitted.envelope!, { operator: 'op', approvedAt: 't' }).envelope!
    const tamperTop = deepClone(a2)
    tamperTop.passportId = 'forged'
    const startAfterTamper = startExecution(tamperTop, { commandId: 'c', startedAt: 't' })
    const linkEmpty = deepClone(a2)
    linkEmpty.decisionAuditLink!.auditId = ''
    const startAfterEmptyAudit = startExecution(linkEmpty, { commandId: 'c', startedAt: 't' })

    // approve 后 reject，旧 Start 拒
    const rej = rejectExecution(a2, { operator: 'op', reason: '驳回', at: 't' })
    const startAfterReject = startExecution(rej.envelope!, { commandId: 'c2', startedAt: 't' })

    // 假账本
    const fake = deepClone(cur)
    fake.ledger[0].powerKw = 1
    fake.ledger[0].energyKwh = 1
    fake.ledger[0].cumulativeEnergyKwh = 1
    fake.modelEnergyKwh = 1
    const fakeCheck = validateStoredEnvelope(fake)
    const fakeStore = new MemStorage()
    fakeStore.setItem(EXECUTION_STORE_KEY, JSON.stringify({ schemaVersion: 1, envelopes: [fake] }))
    const fakeLoaded = loadExecutionStore(fakeStore)

    // 退休 prefix
    const a3 = manualApprove(admitted.envelope!, { operator: 'op', approvedAt: 't' }).envelope!
    let r3 = startExecution(a3, { commandId: 's', startedAt: 't' }).envelope!
    r3 = advanceExecution(r3, { commandId: 'a0', executionId: r3.executionId, executionEpoch: r3.executionEpoch, verificationId: r3.binding.verificationId, expectedCursor: 0, at: 't' }).envelope!
    const retired = retireExecution(r3, '输入/规则变化，需重新送审').envelope!

    // 刷新退休
    const store = new MemStorage()
    saveExecutionEnvelope(a2, store)
    const refreshed = new ExecutionController(store).getLatest()!

    const payload = {
      schema: 'qiheng-execution-b03b-export-v1',
      generatedAt: new Date().toISOString(),
      note: 'B03b：严格 admission（结构门+受支持版本+复验）、强 binding、假账本重放、controller 刷新/storage/变化退休。仅合成模拟。',
      normal: {
        executionId: cur.executionId,
        status: cur.status,
        binding: cur.binding,
        receipt: { strategy: cur.receipt.strategy, modelVersion: cur.receipt.modelVersion, objectiveVersion: cur.receipt.objectiveVersion, hasSolution: cur.receipt.constraints.hasSolution, complete: cur.receipt.constraints.complete, passed: cur.receipt.constraints.passed },
        ledgerLength: cur.ledger.length,
        modelEnergyKwh: cur.modelEnergyKwh,
        envelopeBytes: exportExecutionJson(cur).length,
      },
      reject: {
        noSolution: rejectNoSolution.reason,
        unknownCandidate: rejectUnknown.reason,
        canceledStatus: rejectCanceledStatus.reason,
        badSource: rejectBadSource.reason,
        badRule: rejectBadRule.reason,
        startAfterTopTamper: startAfterTamper.reason,
        startAfterEmptyAudit: startAfterEmptyAudit.reason,
        startAfterReject: { ok: startAfterReject.ok, reason: startAfterReject.reason },
      },
      fakeLedger: { validateOk: fakeCheck.ok, reason: fakeCheck.reason, loadedCorrupted: fakeLoaded.corrupted, rawPreserved: Boolean(fakeLoaded.raw) },
      retire: { status: retired.status, prefixLedgerLength: retired.ledger.length, reason: retired.retiredReason, advanceAfterOk: advanceExecution(retired, { commandId: 'x', executionId: retired.executionId, executionEpoch: retired.executionEpoch, verificationId: retired.binding.verificationId, expectedCursor: retired.cursor, at: 't' }).ok },
      refresh: { status: refreshed.status, reason: refreshed.retiredReason, prefixLedgerLength: refreshed.ledger.length },
    }
    writeFileSync('qiheng-execution-b03b-result.json', JSON.stringify(payload, null, 2))

    expect(payload.normal.ledgerLength).toBe(96)
    expect(payload.reject.noSolution).toBeTruthy()
    expect(payload.reject.canceledStatus).toContain('complete')
    expect(payload.fakeLedger.validateOk).toBe(false)
    expect(payload.fakeLedger.loadedCorrupted).toBe(true)
    expect(payload.retire.prefixLedgerLength).toBe(1)
    expect(payload.refresh.status).toBe('retired')
  }, 300000)
})
