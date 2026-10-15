import { describe, expect, it } from 'vitest'
import {
  PASSPORT_ENVELOPE_VERSION,
  PASSPORT_STORE_KEY,
  assertFiniteDeep,
  byteLength,
  exportPassportJson,
  loadPassportStore,
  makeUnfinishedAttempt,
  newPassportId,
  resolvePassportRef,
  savePassport,
  sealPortfolioPassport,
  type StorageLike,
} from './passport'
import {
  buildPortfolioFixture,
  canonicalPortfolioInput,
  deepClone,
  runPortfolioCandidate,
  snapshotToFixture,
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

async function realAttempts(fixtureId: Parameters<typeof buildPortfolioFixture>[0], epoch: number) {
  const f = buildPortfolioFixture(fixtureId)
  const list = []
  for (const s of ['milp_weighted', 'lab_energy_first', 'lab_switch_first', 'conservative_rule'] as const) {
    list.push(await runPortfolioCandidate(f, s, epoch))
  }
  return list
}

function canonicalOf(c: { inputSnapshot: Parameters<typeof snapshotToFixture>[0] }): string {
  return canonicalPortfolioInput(snapshotToFixture(c.inputSnapshot)).id
}

describe('passport B02b 封存校验', () => {
  it('正常一轮：合法 4，深冻结，重生成新 ID', async () => {
    const attempts = await realAttempts('p_capacity_rise', 1)
    const inputCanonical = canonicalOf(attempts[0])
    const a = sealPortfolioPassport({
      epoch: 1,
      inputSnapshot: attempts[0].inputSnapshot,
      inputCanonical,
      attempts,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    const b = sealPortfolioPassport({
      epoch: 1,
      inputSnapshot: attempts[0].inputSnapshot,
      inputCanonical,
      attempts,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    expect(a.ok, a.reason ?? '').toBe(true)
    expect(b.ok).toBe(true)
    expect(a.passport!.summary.legal).toBe(4)
    expect(a.passport!.passportId).not.toBe(b.passport!.passportId)
    expect(Object.isFrozen(a.passport)).toBe(true)
    expect(a.passport!.authorization).toContain('尚未授权执行')
    expect(a.passport!.sourceCollectionTime).toBe('unknown')
    expect(a.passport!.dataQuality.status).toBe('not_evaluated')
    expect(newPassportId(1)).not.toBe(newPassportId(1))
  }, 60000)

  it('① 顶层 P2/epoch2 装 P1 batch1 → 拒绝混封', async () => {
    const p1 = await realAttempts('p_capacity_rise', 1)
    const p2 = await realAttempts('p_oscillate', 2)
    const sealed = sealPortfolioPassport({
      epoch: 2,
      inputSnapshot: p2[0].inputSnapshot,
      inputCanonical: canonicalOf(p2[0]),
      attempts: p1,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    expect(sealed.ok).toBe(false)
    expect(sealed.reason).toContain('拒绝混封')
  }, 60000)

  it('② 负荷 +0.00001 不改 canonical → 复验与 B01 判定均不绿', async () => {
    const attempts = await realAttempts('p_capacity_rise', 1)
    const tampered = deepClone(attempts)
    const pid = tampered[0].plan!.periods[0]
    const key = Object.keys(pid.unitLoads)[0]
    pid.unitLoads[key] = (pid.unitLoads[key] ?? 0) + 0.00001
    const sealed = sealPortfolioPassport({
      epoch: 1,
      inputSnapshot: tampered[0].inputSnapshot,
      inputCanonical: canonicalOf(tampered[0]),
      attempts: tampered,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    expect(sealed.ok, sealed.reason ?? '').toBe(true)
    const rec = sealed.passport!.attempts[0]
    expect(rec.verification.identity.ok).toBe(false)
    expect(rec.verification.ok).toBe(false)
    expect(rec.b01Verdict.legal).toBe(false)
    expect(rec.verification.b01RejectReasons.join(';')).toContain('canonical-id-mismatch')
  }, 60000)

  it('③ metrics.energyKwh=1 → 不改原声明，复算展示，判不合法', async () => {
    const attempts = await realAttempts('p_capacity_rise', 1)
    const tampered = deepClone(attempts)
    tampered[0].metrics.energyKwh = 1
    const sealed = sealPortfolioPassport({
      epoch: 1,
      inputSnapshot: tampered[0].inputSnapshot,
      inputCanonical: canonicalOf(tampered[0]),
      attempts: tampered,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    const rec = sealed.passport!.attempts[0]
    expect(rec.verification.ok).toBe(false)
    expect(rec.verification.declaredMetrics.energyKwh).toBe(1)
    expect(rec.verification.declaredMatchesRecomputed).toBe(false)
    expect(rec.verification.recomputedMetrics!.totalEnergyKwh).toBeGreaterThan(1)
    expect(rec.metrics.energyKwh).toBe(rec.verification.recomputedMetrics!.totalEnergyKwh)
  }, 60000)

  it('④ 复验回执含 hasSolution/complete/verifierVersion/ruleVersion', async () => {
    const attempts = await realAttempts('p_capacity_rise', 1)
    const sealed = sealPortfolioPassport({
      epoch: 1,
      inputSnapshot: attempts[0].inputSnapshot,
      inputCanonical: canonicalOf(attempts[0]),
      attempts,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    const c = sealed.passport!.attempts[0].verification.constraints!
    expect(c.hasSolution).toBe(true)
    expect(c.complete).toBe(true)
    expect(c.verifierVersion).toBeTruthy()
    expect(c.ruleVersion).toBeTruthy()
  }, 60000)

  it('有限性：NaN 计划拒绝封存；诊断 Infinity 以标记保留', async () => {
    const attempts = await realAttempts('p_capacity_rise', 1)
    const tampered = deepClone(attempts)
    tampered[0].plan!.periods[0].energyKwh = NaN
    const sealed = sealPortfolioPassport({
      epoch: 1,
      inputSnapshot: tampered[0].inputSnapshot,
      inputCanonical: canonicalOf(tampered[0]),
      attempts: tampered,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    expect(sealed.ok).toBe(false)
    expect(sealed.reason).toContain('非有限')
    expect(assertFiniteDeep({ a: [1, Infinity] })).toContain('Infinity')
    expect(assertFiniteDeep({ a: 1 })).toBeNull()
    void byteLength('气衡')
  }, 60000)

  it('生命周期：未完成策略以 not_run 补齐，取消护照仍 4 行', async () => {
    const partial = await runPortfolioCandidate(buildPortfolioFixture('p_capacity_rise'), 'lab_energy_first', 5)
    const draft = {
      epoch: 5,
      inputCanonical: partial.inputIdentity,
      inputSnapshot: partial.inputSnapshot,
    }
    const attempts = [
      partial,
      makeUnfinishedAttempt(draft, 'milp_weighted'),
      makeUnfinishedAttempt(draft, 'lab_switch_first'),
      makeUnfinishedAttempt(draft, 'conservative_rule'),
    ]
    const sealed = sealPortfolioPassport({
      epoch: 5,
      inputSnapshot: partial.inputSnapshot,
      inputCanonical: partial.inputIdentity,
      attempts,
      status: 'canceled',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    expect(sealed.ok).toBe(true)
    expect(sealed.passport!.attempts).toHaveLength(4)
    expect(sealed.passport!.summary.notRun).toBe(3)
    expect(sealed.passport!.status).toBe('canceled')
  }, 60000)

  it('证据引用只指向封存护照内部', async () => {
    const attempts = await realAttempts('p_capacity_rise', 1)
    const sealed = sealPortfolioPassport({
      epoch: 1,
      inputSnapshot: attempts[0].inputSnapshot,
      inputCanonical: canonicalOf(attempts[0]),
      attempts,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    const p = sealed.passport!
    expect(resolvePassportRef(p, p.references.input).found).toBe(true)
    expect(resolvePassportRef(p, p.references.candidates[0].ref).found).toBe(true)
    expect(resolvePassportRef(p, 'qp-other#candidate:x').found).toBe(false)
  }, 60000)
})

describe('passport B02b 存储严格校验', () => {
  async function onePassport(epoch = 1) {
    const attempts = await realAttempts('p_capacity_rise', epoch)
    return sealPortfolioPassport({
      epoch,
      inputSnapshot: attempts[0].inputSnapshot,
      inputCanonical: canonicalOf(attempts[0]),
      attempts,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    }).passport!
  }

  it('保存/读取往返；读取深复制冻结；重复 ID 拒绝', async () => {
    const store = new MemStorage()
    const p = await onePassport()
    const first = savePassport(p, store)
    expect(first.ok).toBe(true)
    const loaded = loadPassportStore(store)
    expect(loaded.corrupted).toBe(false)
    expect(loaded.writable).toBe(true)
    expect(loaded.passports).toHaveLength(1)
    expect(Object.isFrozen(loaded.passports[0])).toBe(true)
    const again = loadPassportStore(store)
    expect(again.passports[0].passportId).toBe(p.passportId)
    expect(again.passports[0]).not.toBe(loaded.passports[0])
    expect(savePassport(p, store).ok).toBe(false)
  }, 60000)

  it('重复 ID / 最小伪 shape / 95 桶：保留原文、writable=false、拒绝覆写', async () => {
    const p = await onePassport()
    const dup = new MemStorage()
    dup.setItem(
      PASSPORT_STORE_KEY,
      JSON.stringify({ schemaVersion: PASSPORT_ENVELOPE_VERSION, passports: [p, p] }),
    )
    const dupSnap = loadPassportStore(dup)
    expect(dupSnap.corrupted).toBe(true)
    expect(dupSnap.writable).toBe(false)
    expect(dupSnap.raw).toBeTruthy()
    expect(savePassport(p, dup).ok).toBe(false)

    const fake = new MemStorage()
    fake.setItem(
      PASSPORT_STORE_KEY,
      JSON.stringify({
        schemaVersion: PASSPORT_ENVELOPE_VERSION,
        passports: [{ schema: p.schema, envelopeVersion: PASSPORT_ENVELOPE_VERSION, passportId: 'x', inputSnapshot: {}, attempts: [], references: {}, summary: {} }],
      }),
    )
    expect(loadPassportStore(fake).writable).toBe(false)

    const short = deepClone(p)
    short.inputSnapshot.points = short.inputSnapshot.points.slice(0, 95)
    const shortStore = new MemStorage()
    shortStore.setItem(
      PASSPORT_STORE_KEY,
      JSON.stringify({ schemaVersion: PASSPORT_ENVELOPE_VERSION, passports: [short] }),
    )
    const shortSnap = loadPassportStore(shortStore)
    expect(shortSnap.corrupted).toBe(true)
    expect(shortSnap.writable).toBe(false)
  }, 60000)

  it('未知 schema / 缺 list / 坏 JSON：保留原文、不回退', () => {
    for (const raw of [
      '{not-json',
      JSON.stringify({ schemaVersion: 999, passports: [] }),
      JSON.stringify({ schemaVersion: PASSPORT_ENVELOPE_VERSION }),
    ]) {
      const store = new MemStorage()
      store.setItem(PASSPORT_STORE_KEY, raw)
      const snap = loadPassportStore(store)
      expect(snap.corrupted).toBe(true)
      expect(snap.writable).toBe(false)
      expect(snap.raw).toBe(raw)
    }
  })

  it('无存储环境：只读未持久化', () => {
    const snap = loadPassportStore(null)
    expect(snap.writable).toBe(false)
    expect(snap.warnings.join()).toContain('未持久化')
  })
})

describe('passport B02c 拒绝证据可保存（合法身份 vs 拒绝证据一致性）', () => {
  async function one(epoch: number) {
    const attempts = await realAttempts('p_capacity_rise', epoch)
    return { attempts, inputCanonical: canonicalOf(attempts[0]) }
  }

  it('真实 MILP 首桶 load+0.00001：seal 成功，save/load/export 保留原值与原因', async () => {
    const { attempts, inputCanonical } = await one(11)
    const tampered = deepClone(attempts)
    const pid = tampered[0].plan!.periods[0]
    const key = Object.keys(pid.unitLoads)[0]
    pid.unitLoads[key] = (pid.unitLoads[key] ?? 0) + 0.00001
    const sealed = sealPortfolioPassport({
      epoch: 11,
      inputSnapshot: tampered[0].inputSnapshot,
      inputCanonical,
      attempts: tampered,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    expect(sealed.ok, sealed.reason ?? '').toBe(true)
    expect(sealed.passport!.attempts[0].verification.ok).toBe(false)
    expect(sealed.passport!.attempts[0].evidenceConsistency.status).toBe('rejected')
    const store = new MemStorage()
    expect(savePassport(sealed.passport!, store).ok).toBe(true)
    const loaded = loadPassportStore(store)
    expect(loaded.corrupted).toBe(false)
    expect(loaded.passports).toHaveLength(1)
    const rec = loaded.passports[0].attempts[0]
    expect(rec.canonicalId).toBe(tampered[0].canonicalId)
    expect(rec.verification.ok).toBe(false)
    expect(rec.verification.b01RejectReasons.join(';')).toContain('canonical-id-mismatch')
    expect(exportPassportJson(loaded.passports[0])).toContain(tampered[0].canonicalId)
  }, 60000)

  it('缺末桶的 rejected 计划可作为证据保存', async () => {
    const { attempts, inputCanonical } = await one(12)
    const tampered = deepClone(attempts)
    tampered[1].plan!.periods = tampered[1].plan!.periods.slice(0, 95)
    const sealed = sealPortfolioPassport({
      epoch: 12,
      inputSnapshot: tampered[0].inputSnapshot,
      inputCanonical,
      attempts: tampered,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    expect(sealed.ok, sealed.reason ?? '').toBe(true)
    expect(sealed.passport!.attempts[1].verification.evaluated).toBe(true)
    expect(sealed.passport!.attempts[1].verification.ok).toBe(false)
    const store = new MemStorage()
    expect(savePassport(sealed.passport!, store).ok).toBe(true)
    expect(loadPassportStore(store).passports).toHaveLength(1)
  }, 60000)

  it('95 桶伪 PASS：存储拒绝、保留原文', async () => {
    const { attempts, inputCanonical } = await one(13)
    const sealed = sealPortfolioPassport({
      epoch: 13,
      inputSnapshot: attempts[0].inputSnapshot,
      inputCanonical,
      attempts,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    const forged = deepClone(sealed.passport!)
    const att = forged.attempts[0]
    att.planOrNull = { ...att.planOrNull!, periods: att.planOrNull!.periods.slice(0, 95) }
    att.verification.ok = true
    const raw = JSON.stringify({
      schemaVersion: PASSPORT_ENVELOPE_VERSION,
      passports: [forged],
    })
    const store = new MemStorage()
    store.setItem(PASSPORT_STORE_KEY, raw)
    const snap = loadPassportStore(store)
    expect(snap.corrupted).toBe(true)
    expect(snap.writable).toBe(false)
    expect(snap.raw).toBe(raw)
  }, 60000)

  it('metrics 声明 1 的 rejected 记录仍可保存', async () => {
    const { attempts, inputCanonical } = await one(14)
    const tampered = deepClone(attempts)
    tampered[0].metrics.energyKwh = 1
    const sealed = sealPortfolioPassport({
      epoch: 14,
      inputSnapshot: tampered[0].inputSnapshot,
      inputCanonical,
      attempts: tampered,
      status: 'complete',
      startedAt: '2026-10-04T00:00:00.000Z',
    })
    expect(sealed.ok).toBe(true)
    expect(sealed.passport!.attempts[0].verification.ok).toBe(false)
    const store = new MemStorage()
    expect(savePassport(sealed.passport!, store).ok).toBe(true)
    expect(loadPassportStore(store).passports).toHaveLength(1)
  }, 60000)
})
