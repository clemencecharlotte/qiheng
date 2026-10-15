import { describe, expect, it } from 'vitest'
import { createConsoleData } from './consoleData'
import type { BatchSummary, EventList, HealthInfo, SourceState } from './contracts'

function batch(id: string, sourceId = 's1'): BatchSummary {
  return { id, sourceId, entity: 'e', format: 'csv', filename: '', ruleVersion: 'v1', receivedAt: 't',
    totalRows: 1, validRows: 1, isolatedRows: 0, rejectedRows: 0, status: 'ok', unordered: false, note: '' }
}
function source(id: string): SourceState {
  return { sourceId: id, configured: true, sourceObservedAt: 'o', receivedAt: 'r', heartbeatAt: 'h',
    status: 'unconfigured', observationCount: 1, ruleVersion: 'v1' }
}
function events(): EventList {
  return { items: [], total: 0, limit: 50, offset: 0 }
}

const HEALTH: HealthInfo = { status: 'ok', service: 'qh', schemaVersion: 2, time: 't', ruleVersion: 'v' }

function client(over: Partial<{
  health: () => Promise<HealthInfo>
  listBatches: () => Promise<{ items: BatchSummary[]; total: number }>
  listEvents: () => Promise<EventList>
  getSourceState: (id: string) => Promise<SourceState>
}> = {}) {
  return {
    health: () => Promise.resolve(HEALTH),
    listBatches: () => Promise.resolve({ items: [batch('b1')], total: 1 }),
    listEvents: () => Promise.resolve(events()),
    getSourceState: (id: string) => Promise.resolve(source(id)),
    ...over,
  }
}

describe('M10 consoleData', () => {
  it('ready with loaded batches + source time split', async () => {
    const c = createConsoleData(client())
    await c.load()
    const s = c.get()
    expect(s.status).toBe('ready')
    expect(s.batches).toHaveLength(1)
    expect(s.sourceState?.sourceId).toBe('s1')
    expect(s.reason).toContain('离线')
  })

  it('network failure -> offline; api failure -> error', async () => {
    const net = createConsoleData(client({ health: () => Promise.reject({ status: 0, code: 'network_error' }) }))
    await net.load()
    expect(net.get().status).toBe('offline')
    const api = createConsoleData(client({ health: () => Promise.reject({ status: 500, code: 'internal_error' }) }))
    await api.load()
    expect(api.get().status).toBe('error')
  })

  it('latest-wins + StrictMode replay + dispose', async () => {
    let n = 0
    let resolveOld!: (v: HealthInfo) => void
    const old = new Promise<HealthInfo>((r) => (resolveOld = r))
    const c = client({ health: () => { n += 1; return n === 1 ? old : Promise.resolve(HEALTH) } })
    const f1 = createConsoleData(c)
    const p1 = f1.load()
    f1.dispose()
    const f2 = createConsoleData(c)
    await f2.load()
    expect(f2.get().status).toBe('ready')
    resolveOld(HEALTH)
    await p1
    expect(f1.get().status).toBe('loading') // 旧代次未写回
  })
})
