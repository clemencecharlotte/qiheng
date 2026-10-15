import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  ExecutionController,
  loadExecutionStore,
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
function uuid(): string {
  return `cmd-${Math.random().toString(16).slice(2, 10)}`
}

/** 直接改持久 raw（不经过 save），模拟外部同 ID 写入。 */
function tamper(store: MemStorage, mutate: (env: ExecutionEnvelope) => void): ExecutionEnvelope {
  const snap = loadExecutionStore(store)
  const env = deepClone(snap.envelopes[0])
  mutate(env)
  store.setItem('qiheng.execution.store.v1', JSON.stringify({ schemaVersion: 1, envelopes: [env] }))
  return env
}

async function base(status: 'verified' | 'approved' | 'executing') {
  const store = new MemStorage()
  const controller = new ExecutionController(store)
  const p = await passport()
  controller.setBusinessContext({ businessKey: 'normal|qa-b03c' })
  expect(controller.admit(p, idOf(p), 301, 't').ok).toBe(true)
  if (status !== 'verified') expect(controller.approve({ operator: 'op', approvedAt: 't' }).ok).toBe(true)
  if (status === 'executing') {
    expect(controller.start({ commandId: uuid(), startedAt: 't' }).ok).toBe(true)
    const cur = controller.getLatest()!
    expect(controller.advance({ commandId: uuid(), executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: 0, at: 't' }).ok).toBe(true)
  }
  return { store, controller }
}

describe('B03d 完整预期快照门（保合法正控制）', () => {
  it('verified：同 rev 仅改 businessKey → approve 拒、二次仍拒、raw 不覆盖', async () => {
    const { store, controller } = await base('verified')
    const before = controller.getLatest()!
    tamper(store, (e) => {
      e.businessKey = 'surge|qa-b03c'
    })
    const rawAfterTamper = store.getItem('qiheng.execution.store.v1')!
    const r1 = controller.approve({ operator: 'op', approvedAt: 't2' })
    expect(r1.ok).toBe(false)
    expect(controller.getLatest()!.status).toBe('retired')
    const r2 = controller.approve({ operator: 'op', approvedAt: 't3' })
    expect(r2.ok).toBe(false)
    expect(store.getItem('qiheng.execution.store.v1')).toBe(rawAfterTamper)
    expect(controller.getLatest()!.ledger).toHaveLength(before.ledger.length)
  }, 60000)

  it('approved：同 rev 仅改 businessKey → Start/advance 拒、raw 不覆盖', async () => {
    const { store, controller } = await base('approved')
    tamper(store, (e) => {
      e.businessKey = 'surge|qa-b03c'
    })
    const rawAfterTamper = store.getItem('qiheng.execution.store.v1')!
    expect(controller.start({ commandId: uuid(), startedAt: 't' }).ok).toBe(false)
    expect(controller.getLatest()!.status).toBe('retired')
    expect(controller.start({ commandId: uuid(), startedAt: 't2' }).ok).toBe(false)
    expect(store.getItem('qiheng.execution.store.v1')).toBe(rawAfterTamper)
  }, 60000)

  it('executing：同 rev 仅改 businessKey → advance 拒、prefix 不增加、raw 不覆盖', async () => {
    const { store, controller } = await base('executing')
    const before = controller.getLatest()!
    tamper(store, (e) => {
      e.businessKey = 'surge|qa-b03c'
    })
    const rawAfterTamper = store.getItem('qiheng.execution.store.v1')!
    expect(controller.advance({ commandId: uuid(), executionEpoch: before.executionEpoch, verificationId: before.binding.verificationId, expectedCursor: before.cursor, at: 't' }).ok).toBe(false)
    expect(controller.getLatest()!.status).toBe('retired')
    expect(controller.advance({ commandId: uuid(), executionEpoch: before.executionEpoch, verificationId: before.binding.verificationId, expectedCursor: before.cursor, at: 't2' }).ok).toBe(false)
    expect(controller.getLatest()!.ledger).toHaveLength(before.ledger.length)
    expect(store.getItem('qiheng.execution.store.v1')).toBe(rawAfterTamper)
  }, 60000)

  it('approved：同 rev 同 businessKey 但改 approval 元数据 → 完整门拒（非单字段补丁）', async () => {
    const { store, controller } = await base('approved')
    tamper(store, (e) => {
      e.decisionAuditLink = { ...e.decisionAuditLink!, operator: '外部伪造' }
    })
    const r = controller.start({ commandId: uuid(), startedAt: 't' })
    expect(r.ok).toBe(false)
    expect(controller.getLatest()!.status).toBe('retired')
  }, 60000)

  it('控制：未改动的相同快照命令仍成功', async () => {
    const { controller } = await base('approved')
    expect(controller.start({ commandId: uuid(), startedAt: 't' }).ok).toBe(true)
    const cur = controller.getLatest()!
    expect(controller.advance({ commandId: uuid(), executionEpoch: cur.executionEpoch, verificationId: cur.binding.verificationId, expectedCursor: 0, at: 't' }).ok).toBe(true)
  }, 60000)

  it('写出 qiheng-execution-b03d-result.json', async () => {
    const p = await passport()
    const { store, controller } = await base('executing')
    const before = controller.getLatest()!
    tamper(store, (e) => {
      e.businessKey = 'surge|qa-b03c'
    })
    const rawAfterTamper = store.getItem('qiheng.execution.store.v1')!
    const adv1 = controller.advance({ commandId: uuid(), executionEpoch: before.executionEpoch, verificationId: before.binding.verificationId, expectedCursor: before.cursor, at: 't' })
    const adv2 = controller.advance({ commandId: uuid(), executionEpoch: before.executionEpoch, verificationId: before.binding.verificationId, expectedCursor: before.cursor, at: 't2' })

    const control = new ExecutionController(new MemStorage())
    control.setBusinessContext({ businessKey: 'normal|qa-b03c' })
    control.admit(p, idOf(p), 302, 't')
    const appr = control.approve({ operator: 'op', approvedAt: 't' })
    const st = control.start({ commandId: uuid(), startedAt: 't' })
    const c0 = control.getLatest()!
    const ad = control.advance({ commandId: uuid(), executionEpoch: c0.executionEpoch, verificationId: c0.binding.verificationId, expectedCursor: 0, at: 't' })

    const payload = {
      schema: 'qiheng-execution-b03d-export-v1',
      generatedAt: new Date().toISOString(),
      note: 'B03d 完整预期快照门：命令捕获的旧 envelope 与最新持久同 ID 必须完整受保护内容一致，否则内存永久停权、不覆盖变化 raw。该 guard 不等于跨标签事务。',
      tamper: {
        businessKeyOnly: {
          beforeCursor: before.cursor,
          adv1: { ok: adv1.ok, reason: adv1.reason },
          adv2: { ok: adv2.ok, reason: adv2.reason },
          finalStatus: controller.getLatest()!.status,
          prefixLength: controller.getLatest()!.ledger.length,
          modelEnergyKwh: controller.getLatest()!.modelEnergyKwh,
          rawUnchanged: store.getItem('qiheng.execution.store.v1') === rawAfterTamper,
        },
      },
      control: { approveOk: appr.ok, startOk: st.ok, advanceOk: ad.ok, cursor: control.getLatest()!.cursor, modelEnergyKwh: control.getLatest()!.modelEnergyKwh },
    }
    writeFileSync('qiheng-execution-b03d-result.json', JSON.stringify(payload, null, 2))

    expect(payload.tamper.businessKeyOnly.adv1.ok).toBe(false)
    expect(payload.tamper.businessKeyOnly.adv2.ok).toBe(false)
    expect(payload.tamper.businessKeyOnly.finalStatus).toBe('retired')
    expect(payload.tamper.businessKeyOnly.prefixLength).toBe(before.ledger.length)
    expect(payload.tamper.businessKeyOnly.rawUnchanged).toBe(true)
    expect(payload.control.advanceOk).toBe(true)
  }, 60000)
})
