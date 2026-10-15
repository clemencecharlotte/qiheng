import { describe, expect, it } from 'vitest'
import { createIngressSelection } from './ingressSelection'
import type { BatchSummary, ObservationList, QualityReport } from './contracts'

function batch(id: string): BatchSummary {
  return { id, sourceId: 's1', entity: 'e', format: 'json', filename: '', ruleVersion: 'v1',
    receivedAt: 't', totalRows: 1, validRows: 1, isolatedRows: 0, rejectedRows: 0, status: 'ok', unordered: false, note: '' }
}
function quality(id: string): QualityReport {
  return { batchId: id, ruleVersion: 'v1', status: 'ok', unordered: false, note: '', counts: { total: 1, valid: 1, isolated: 0, rejected: 0 }, rejectReasons: [], isolateReasons: [], rejections: [] }
}
function obs(id: string): ObservationList {
  return { items: [], total: 0, ...(id ? {} : {}) } as ObservationList
}
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('M08 ingress selection (latest-wins)', () => {
  it('A then B: B applied, late A discarded', async () => {
    const dA = deferred<QualityReport>(); const dB = deferred<QualityReport>()
    const sel = createIngressSelection({
      getBatch: (id) => Promise.resolve(batch(id)),
      getQuality: (id) => (id === 'bA' ? dA.promise : dB.promise),
      getObservations: () => Promise.resolve(obs('x')),
    })
    sel.select('bA')
    sel.select('bB')
    dB.resolve(quality('bB'))
    await Promise.resolve(); await Promise.resolve()
    dA.resolve(quality('bA'))
    await Promise.resolve(); await Promise.resolve()
    expect(sel.get().status).toBe('ready')
    expect(sel.get().batchId).toBe('bB')
    expect(sel.get().batch?.id).toBe('bB')
  })

  it('error -> retry recovers; clear resets; dispose blocks late write', async () => {
    let n = 0
    const sel = createIngressSelection({
      getBatch: (id) => Promise.resolve(batch(id)),
      getQuality: (id) => { n += 1; return n === 1 ? Promise.reject(new Error('x')) : Promise.resolve(quality(id)) },
      getObservations: () => Promise.resolve(obs('x')),
    })
    sel.select('b1')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(sel.get().status).toBe('error')
    sel.retry()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(sel.get().status).toBe('ready')
    sel.clear()
    expect(sel.get().status).toBe('idle')
    expect(sel.get().batchId).toBeNull()

    const d = deferred<QualityReport>()
    const sel2 = createIngressSelection({
      getBatch: (id) => Promise.resolve(batch(id)),
      getQuality: () => d.promise,
      getObservations: () => Promise.resolve(obs('x')),
    })
    sel2.select('b9')
    sel2.dispose()
    d.resolve(quality('b9'))
    await Promise.resolve(); await Promise.resolve()
    expect(sel2.get().status).toBe('loading')
  })

  it('StrictMode replay: fresh controller after dispose reaches ready; old ignored', async () => {
    const dOld = deferred<QualityReport>()
    let n = 0
    const c = {
      getBatch: (id: string) => Promise.resolve(batch(id)),
      getQuality: () => { n += 1; return n === 1 ? dOld.promise : Promise.resolve(quality('fresh')) },
      getObservations: () => Promise.resolve(obs('x')),
    }
    const s1 = createIngressSelection(c)
    s1.select('bOld')
    s1.dispose()
    const s2 = createIngressSelection(c)
    s2.select('bFresh')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(s2.get().status).toBe('ready')
    expect(s2.get().batchId).toBe('bFresh')
    dOld.resolve(quality('old'))
    await Promise.resolve(); await Promise.resolve()
    expect(s1.get().status).not.toBe('ready') // 旧代次永久失效
  })
})
