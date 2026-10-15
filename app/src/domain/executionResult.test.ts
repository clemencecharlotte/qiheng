import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  admitPassportCandidate,
  advanceExecution,
  exportExecutionJson,
  manualApprove,
  retireExecution,
  startExecution,
  type ExecutionEnvelope,
} from './execution'
import { sealPortfolioPassport } from './passport'
import {
  PORTFOLIO_STRATEGIES,
  buildPortfolioFixture,
  canonicalPortfolioInput,
  runPortfolioCandidate,
} from './portfolio'

async function round(fixtureId: Parameters<typeof buildPortfolioFixture>[0], epoch: number, status: 'complete') {
  const fixture = buildPortfolioFixture(fixtureId)
  const inputCanonical = canonicalPortfolioInput(fixture).id
  const attempts = []
  for (const s of PORTFOLIO_STRATEGIES) attempts.push(await runPortfolioCandidate(fixture, s, epoch))
  const sealed = sealPortfolioPassport({
    epoch,
    inputSnapshot: attempts[0].inputSnapshot,
    inputCanonical,
    attempts,
    status,
    startedAt: '2026-10-04T00:00:00.000Z',
    scenarioId: fixtureId,
    scenarioLabel: fixtureId,
  })
  return sealed.passport!
}

describe('B03 执行结果导出（正常 / 拒绝 / 退休轨迹）', () => {
  it('人工 Start 逐桶至 Completed，模型积分；写出 qiheng-execution-b03-result.json', async () => {
    // 正常轨迹：P1 真实护照 → 送交 → 批准 → Start → 逐桶 Completed
    const p1 = await round('p_capacity_rise', 1, 'complete')
    const legalId = p1.attempts.find((a) => a.verification.ok === true)!.candidateId
    const admitted = admitPassportCandidate(p1, legalId, 101, '2026-10-04T00:00:00.000Z')
    expect(admitted.ok, admitted.reason ?? '').toBe(true)
    const approved = manualApprove(admitted.envelope!, { operator: '张三-合成', approvedAt: '2026-10-04T00:00:01.000Z' })
    expect(approved.ok, approved.reason ?? '').toBe(true)
    let cur: ExecutionEnvelope = startExecution(approved.envelope!, { commandId: 'start-1', startedAt: '2026-10-04T00:00:02.000Z' }).envelope!
    let guard = 0
    while (cur.status === 'executing' && guard < 200) {
      const r = advanceExecution(cur, { commandId: `adv-${cur.cursor}`,
        executionId: cur.executionId,
        executionEpoch: cur.executionEpoch,
        verificationId: cur.binding.verificationId,
        expectedCursor: cur.cursor,
        at: 't',
      })
      if (!r.ok || !r.envelope) break
      cur = r.envelope
      guard += 1
    }
    expect(cur.status).toBe('completed')
    expect(cur.ledger).toHaveLength(cur.plan.periods.length)
    const normalEnergy = cur.modelEnergyKwh

    // 拒绝轨迹：P4 无解候选送执行被拒；未知 candidate 被拒
    const p4 = await round('p_over_capacity', 2, 'complete')
    const rejectNoSolution = admitPassportCandidate(p4, p4.attempts[0].candidateId, 102, 't')
    const rejectUnknown = admitPassportCandidate(p1, 'not-exist', 103, 't')

    // 退休轨迹：批准+Start 一桶后变化退休
    const admitted2 = admitPassportCandidate(p1, legalId, 104, 't').envelope!
    const approved2 = manualApprove(admitted2, { operator: 'op', approvedAt: 't' }).envelope!
    let cur2 = startExecution(approved2, { commandId: 'start-2', startedAt: 't' }).envelope!
    cur2 = advanceExecution(cur2, { commandId: 'adv-0', executionId: cur2.executionId, executionEpoch: cur2.executionEpoch, verificationId: cur2.binding.verificationId, expectedCursor: 0, at: 't' }).envelope!
    const retired = retireExecution(cur2, '输入/规则变化，需重新送审').envelope!

    const payload = {
      schema: 'qiheng-execution-b03-export-v1',
      generatedAt: new Date().toISOString(),
      note: '合成执行链：仅合成模拟，不接 PLC/账号；Start 不加桶；advance 人工逐桶、每人每 index 至多一次、写成功才发布。',
      normal: {
        executionId: cur.executionId,
        status: cur.status,
        passportId: cur.passportId,
        candidateId: cur.candidateId,
        binding: cur.binding,
        receipt: {
          verifierVersion: cur.receipt.verifierVersion,
          hasSolution: cur.receipt.constraints.hasSolution,
          complete: cur.receipt.constraints.complete,
          passed: cur.receipt.constraints.passed,
          recomputedEnergyKwh: cur.receipt.recomputedMetrics.totalEnergyKwh,
        },
        ledgerLength: cur.ledger.length,
        modelEnergyKwh: normalEnergy,
        envelopeBytes: exportExecutionJson(cur).length,
      },
      reject: {
        noSolution: { ok: rejectNoSolution.ok, reason: rejectNoSolution.reason },
        unknownCandidate: { ok: rejectUnknown.ok, reason: rejectUnknown.reason },
      },
      retire: {
        status: retired.status,
        prefixLedgerLength: retired.ledger.length,
        reason: retired.retiredReason,
        advanceAfterRetireOk: advanceExecution(retired, { commandId: 'x', executionId: retired.executionId, executionEpoch: retired.executionEpoch, verificationId: retired.binding.verificationId, expectedCursor: retired.cursor, at: 't' }).ok,
      },
      guarantees: {
        approvedDoesNotAutoStart: 'manualApprove 后状态为 approved，需人工 Start；观察/播放/游标不触发 Start/advance',
        idempotent: '同 commandId 重复 Start/advance 不重复消费/积分；不同 ID 旧 expectedCursor 拒绝',
        noAutoPrefixRerun: '退休保留 prefix；重送需新 epoch/复验/人审，不重跑 prefix',
      },
    }
    writeFileSync('qiheng-execution-b03-result.json', JSON.stringify(payload, null, 2))

    expect(payload.normal.ledgerLength).toBe(96)
    expect(payload.reject.noSolution.ok).toBe(false)
    expect(payload.reject.unknownCandidate.ok).toBe(false)
    expect(payload.retire.status).toBe('retired')
    expect(payload.retire.prefixLedgerLength).toBe(1)
    expect(payload.retire.advanceAfterRetireOk).toBe(false)
  }, 300000)
})
