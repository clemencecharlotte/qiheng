import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  PORTFOLIO_STRATEGIES,
  buildPortfolioFixture,
  canonicalPortfolioInput,
  runPortfolioCandidate,
} from './portfolio'
import {
  byteLength,
  exportPassportJson,
  loadPassportStore,
  makeUnfinishedAttempt,
  savePassport,
  sealPortfolioPassport,
  type StorageLike,
} from './passport'

class MemStorage implements StorageLike {
  map = new Map<string, string>()
  getItem(k: string): string | null {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v)
  }
}

describe('B02b 护照导出（正常 / 真实无解 / 取消）', () => {
  it('各输入各自护照，写出 qiheng-passport-b02b-result.json', async () => {
    const norm = buildPortfolioFixture('p_capacity_rise')
    const normCanonical = canonicalPortfolioInput(norm).id
    const normAttempts = []
    for (const s of PORTFOLIO_STRATEGIES) normAttempts.push(await runPortfolioCandidate(norm, s, 1))
    const normal = sealPortfolioPassport({
      epoch: 1,
      inputSnapshot: normAttempts[0].inputSnapshot,
      inputCanonical: normCanonical,
      attempts: normAttempts,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
      scenarioId: 'p_capacity_rise',
      scenarioLabel: 'P1｜容量内分段抬升',
    })
    expect(normal.ok, normal.reason ?? '').toBe(true)

    const over = buildPortfolioFixture('p_over_capacity')
    const overCanonical = canonicalPortfolioInput(over).id
    const overAttempts = []
    for (const s of PORTFOLIO_STRATEGIES) overAttempts.push(await runPortfolioCandidate(over, s, 2))
    const noSolution = sealPortfolioPassport({
      epoch: 2,
      inputSnapshot: overAttempts[0].inputSnapshot,
      inputCanonical: overCanonical,
      attempts: overAttempts,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
      scenarioId: 'p_over_capacity',
      scenarioLabel: 'P4｜明确超容量 32.5',
    })
    expect(noSolution.ok, noSolution.reason ?? '').toBe(true)

    // 取消故事：P1 仅 1 策略完成，其余 3 明确 not_run，仍 4 行。
    const one = await runPortfolioCandidate(norm, 'lab_energy_first', 3)
    const cancelDraft = { epoch: 3, inputCanonical: normCanonical, inputSnapshot: one.inputSnapshot }
    const cancelAttempts = PORTFOLIO_STRATEGIES.map((s) =>
      s === 'lab_energy_first' ? one : makeUnfinishedAttempt(cancelDraft, s),
    )
    const canceled = sealPortfolioPassport({
      epoch: 3,
      inputSnapshot: one.inputSnapshot,
      inputCanonical: normCanonical,
      attempts: cancelAttempts,
      status: 'canceled',
      startedAt: '2026-10-04T00:00:00.000Z',
      scenarioId: 'p_capacity_rise',
      scenarioLabel: 'P1｜容量内分段抬升（生成中取消）',
    })
    expect(canceled.ok, canceled.reason ?? '').toBe(true)

    const store = new MemStorage()
    expect(savePassport(normal.passport!, store).ok).toBe(true)
    expect(savePassport(noSolution.passport!, store).ok).toBe(true)
    expect(savePassport(canceled.passport!, store).ok).toBe(true)
    const reloaded = loadPassportStore(store)
    expect(reloaded.corrupted).toBe(false)
    expect(reloaded.passports).toHaveLength(3)

    const payload = {
      schema: 'qiheng-passport-b02b-export-v1',
      generatedAt: new Date().toISOString(),
      note: '一次真实规划=一份不可变护照；正常/无解各自输入；取消保留 4 策略 attempt。尚未授权执行；非 holdout/预测。',
      normal: normal.passport,
      noSolution: noSolution.passport,
      cancelStory: canceled.passport,
      storeReloadedCount: reloaded.passports.length,
      bytes: {
        normal: byteLength(exportPassportJson(normal.passport!)),
        noSolution: byteLength(exportPassportJson(noSolution.passport!)),
        cancel: byteLength(exportPassportJson(canceled.passport!)),
      },
      stories: {
        normal: {
          legal: normal.passport!.summary.legal,
          rejected: normal.passport!.summary.rejected,
          notRun: normal.passport!.summary.notRun,
        },
        noSolution: {
          legal: noSolution.passport!.summary.legal,
          notRun: noSolution.passport!.summary.notRun,
          note: 'P4 需求 32.5>32，四策略均无合法方案，not_run，不做绿色 PASS。',
        },
        canceled: {
          attempted: canceled.passport!.summary.attempted,
          legal: canceled.passport!.summary.legal,
          notRun: canceled.passport!.summary.notRun,
          note: '生成中取消：1 策略完成 + 3 策略显式 not_run，未掉行，未改用新输入。',
        },
      },
    }
    writeFileSync('qiheng-passport-b02b-result.json', JSON.stringify(payload, null, 2))
    expect(payload.normal!.summary.legal).toBe(4)
    expect(payload.noSolution!.summary.notRun).toBe(4)
    expect(payload.cancelStory!.attempts).toHaveLength(4)
    expect(payload.cancelStory!.summary.notRun).toBe(3)
  }, 300000)
})
