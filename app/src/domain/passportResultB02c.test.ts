import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  PORTFOLIO_STRATEGIES,
  buildPortfolioFixture,
  canonicalPortfolioInput,
  deepClone,
  runPortfolioCandidate,
} from './portfolio'
import {
  PASSPORT_ENVELOPE_VERSION,
  PASSPORT_STORE_KEY,
  exportPassportJson,
  loadPassportStore,
  savePassport,
  sealPortfolioPassport,
  validateStoredPassport,
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

describe('B02c 拒绝证据可留存（窄回归，不跑旧矩阵）', () => {
  it('写出 qiheng-passport-b02c-result.json', async () => {
    const fixture = buildPortfolioFixture('p_capacity_rise')
    const inputCanonical = canonicalPortfolioInput(fixture).id
    const attempts = []
    for (const s of PORTFOLIO_STRATEGIES) attempts.push(await runPortfolioCandidate(fixture, s, 21))

    // ① 真实 MILP 首桶 load+0.00001、原 canonical 不改 → 拒绝证据，可保存
    const tampered = deepClone(attempts)
    const pid = tampered[0].plan!.periods[0]
    const key = Object.keys(pid.unitLoads)[0]
    pid.unitLoads[key] = (pid.unitLoads[key] ?? 0) + 0.00001
    const rejSealed = sealPortfolioPassport({
      epoch: 21,
      inputSnapshot: tampered[0].inputSnapshot,
      inputCanonical,
      attempts: tampered,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
      scenarioId: 'p_capacity_rise',
      scenarioLabel: 'P1｜容量内分段抬升（拒绝证据）',
    })
    expect(rejSealed.ok, rejSealed.reason ?? '').toBe(true)
    const rejStore = new MemStorage()
    const rejSave = savePassport(rejSealed.passport!, rejStore)
    const rejLoaded = loadPassportStore(rejStore)
    const rejRec = rejLoaded.passports[0]?.attempts[0]

    // ② metrics 声明 1 的 rejected 仍可保存
    const metricTampered = deepClone(attempts)
    metricTampered[0].metrics.energyKwh = 1
    const metricSealed = sealPortfolioPassport({
      epoch: 21,
      inputSnapshot: metricTampered[0].inputSnapshot,
      inputCanonical,
      attempts: metricTampered,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    const metricStore = new MemStorage()
    const metricSave = savePassport(metricSealed.passport!, metricStore)

    // ③ 缺末桶 rejected 计划可留证
    const shortPlan = deepClone(attempts)
    shortPlan[1].plan!.periods = shortPlan[1].plan!.periods.slice(0, 95)
    const shortSealed = sealPortfolioPassport({
      epoch: 21,
      inputSnapshot: shortPlan[0].inputSnapshot,
      inputCanonical,
      attempts: shortPlan,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    const shortStore = new MemStorage()
    const shortSave = savePassport(shortSealed.passport!, shortStore)

    // ④ 95 桶伪 PASS：存储拒绝、保留原文
    const forged = deepClone(rejSealed.passport!)
    const att = forged.attempts[0]
    att.planOrNull = { ...att.planOrNull!, periods: att.planOrNull!.periods.slice(0, 95) }
    att.verification.ok = true
    const forgedRaw = JSON.stringify({ schemaVersion: PASSPORT_ENVELOPE_VERSION, passports: [forged] })
    const forgedStore = new MemStorage()
    forgedStore.setItem(PASSPORT_STORE_KEY, forgedRaw)
    const forgedSnap = loadPassportStore(forgedStore)

    const payload = {
      schema: 'qiheng-passport-b02c-export-v1',
      generatedAt: new Date().toISOString(),
      note: 'B02c 窄收尾：区分“合法候选身份”与“拒绝证据一致性”。rejected 记录保留原 claimed canonical/原计划/原声明与真实拒绝回执；95 桶伪 PASS 仍拒。旧 b02/b02b 结果未覆盖。',
      rejectedEvidence: {
        sealOk: rejSealed.ok,
        verificationOk: rejSealed.passport!.attempts[0].verification.ok,
        evidenceStatus: rejSealed.passport!.attempts[0].evidenceConsistency.status,
        canonicalMatched: rejSealed.passport!.attempts[0].evidenceConsistency.canonicalMatched,
        originalCanonicalId: rejSealed.passport!.attempts[0].canonicalId,
        rejectReasons: rejSealed.passport!.attempts[0].verification.b01RejectReasons,
        save: rejSave,
        reloadedCorrupted: rejLoaded.corrupted,
        reloadedCount: rejLoaded.passports.length,
        reloadedOriginalCanonicalId: rejRec?.canonicalId ?? null,
        reloadedRejectReasons: rejRec?.verification.b01RejectReasons ?? null,
        exportContainsOriginalCanonical: rejLoaded.passports[0]
          ? exportPassportJson(rejLoaded.passports[0]).includes(rejSealed.passport!.attempts[0].canonicalId)
          : null,
      },
      metricsOneRejected: {
        sealOk: metricSealed.ok,
        verificationOk: metricSealed.passport!.attempts[0].verification.ok,
        declaredEnergy: metricSealed.passport!.attempts[0].verification.declaredMetrics.energyKwh,
        recomputedEnergy: metricSealed.passport!.attempts[0].verification.recomputedMetrics?.totalEnergyKwh ?? null,
        save: metricSave,
      },
      missingBucketRejected: {
        sealOk: shortSealed.ok,
        evaluated: shortSealed.passport!.attempts[1].verification.evaluated,
        verificationOk: shortSealed.passport!.attempts[1].verification.ok,
        save: shortSave,
      },
      pseudoPass95: {
        rawStoreCorrupted: forgedSnap.corrupted,
        writable: forgedSnap.writable,
        rawPreserved: forgedSnap.raw === forgedRaw,
      },
      guard: {
        validateRejectedOriginal: validateStoredPassport(rejSealed.passport!),
        validateForged: validateStoredPassport(forged),
      },
    }
    writeFileSync('qiheng-passport-b02c-result.json', JSON.stringify(payload, null, 2))

    expect(rejSave.ok, rejSave.error ?? '').toBe(true)
    expect(rejLoaded.corrupted).toBe(false)
    expect(rejRec?.canonicalId).toBe(rejSealed.passport!.attempts[0].canonicalId)
    expect(rejRec?.verification.b01RejectReasons.join(';')).toContain('canonical-id-mismatch')
    expect(metricSave.ok, metricSave.error ?? '').toBe(true)
    expect(shortSave.ok, shortSave.error ?? '').toBe(true)
    expect(forgedSnap.corrupted).toBe(true)
    expect(forgedSnap.writable).toBe(false)
  }, 300000)
})
