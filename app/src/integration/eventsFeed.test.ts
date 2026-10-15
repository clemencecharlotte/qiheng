import { describe, expect, it } from 'vitest'
import { createEventsFeed } from './eventsFeed'
import type { BatchSummary, EventList, GovernanceEvent, QualityReport } from './contracts'

function ev(id: string, batchId: string | null = 'b1', type: GovernanceEvent['type'] = 'import_completed'): GovernanceEvent {
  return {
    eventId: id, sourceId: 's1', batchId, type, severity: 'info',
    occurredAt: '2026-10-07T08:00:00.000Z', receivedAt: '2026-10-07T08:00:00.000Z',
    ruleVersion: 'v1', reasons: null, detail: 'x',
  }
}
function list(ids: string[]): EventList {
  return { items: ids.map((i) => ev(i)), total: ids.length, limit: 10, offset: 0 }
}
function batch(id: string): BatchSummary {
  return { id, sourceId: 's1', entity: 'e', format: 'json', filename: '', ruleVersion: 'v1',
    receivedAt: 't', totalRows: 1, validRows: 1, isolatedRows: 0, rejectedRows: 0, status: 'ok', unordered: false, note: '' }
}
function quality(id: string): QualityReport {
  return { batchId: id, ruleVersion: 'v1', status: 'ok', unordered: false, note: '', counts: { total: 1, valid: 1, isolated: 0, rejected: 0 }, rejectReasons: [], isolateReasons: [], rejections: [] }
}
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function client(over: Partial<{ listEvents: (q?: { offset?: number; sourceId?: string; type?: string; severity?: string }) => Promise<EventList>; getBatch: (id: string) => Promise<BatchSummary>; getQuality: (id: string) => Promise<QualityReport>; getEvent: (id: string) => Promise<GovernanceEvent> }> = {}) {
  return {
    listEvents: () => Promise.resolve(list([])),
    getBatch: (id: string) => Promise.resolve(batch(id)),
    getQuality: (id: string) => Promise.resolve(quality(id)),
    getEvent: (id: string) => Promise.resolve({ ...ev(id), eventId: id }),
    ...over,
  }
}

describe('M08 events feed (list + related)', () => {
  it('latest-wins for list', async () => {
    const d1 = deferred<EventList>(); const d2 = deferred<EventList>()
    const q = [d1.promise, d2.promise]; let i = 0
    const feed = createEventsFeed(client({ listEvents: () => q[i++] }))
    const p1 = feed.load(); const p2 = feed.load()
    d2.resolve(list(['e2'])); await p2
    d1.resolve(list(['e1'])); await p1
    expect(feed.get().items.map((x) => x.eventId)).toEqual(['e2'])
  })

  it('new query invalidates related (no stale detail after filtering to no result)', async () => {
    const feed = createEventsFeed(client())
    feed.select(ev('e1'))
    await Promise.resolve(); await Promise.resolve()
    expect(feed.get().related.status).toBe('ready')
    feed.setFilters({ sourceId: 'none' })
    await Promise.resolve(); await Promise.resolve()
    expect(feed.get().related.status).toBe('idle')
    expect(feed.get().related.event).toBeNull()
  })

  it('late quality for old selection is discarded (A then B, A resolves last)', async () => {
    const dA = deferred<QualityReport>(); const dB = deferred<QualityReport>()
    const feed = createEventsFeed(client({
      getBatch: (id) => Promise.resolve(batch(id)),
      getQuality: (id) => (id === 'bA' ? dA.promise : dB.promise),
    }))
    feed.select(ev('eA', 'bA'))
    feed.select(ev('eB', 'bB'))
    dB.resolve(quality('bB'))
    await Promise.resolve(); await Promise.resolve()
    dA.resolve(quality('bA'))
    await Promise.resolve(); await Promise.resolve()
    expect(feed.get().related.event?.eventId).toBe('eB')
  })

  it('service_error without batchId -> ready detail, no batch', async () => {
    const feed = createEventsFeed(client())
    feed.select(ev('err', null, 'service_error'))
    await Promise.resolve()
    expect(feed.get().related.status).toBe('ready')
    expect(feed.get().related.event?.eventId).toBe('err')
    expect(feed.get().related.batch).toBeNull()
  })

  it('related error can retry', async () => {
    let n = 0
    const feed = createEventsFeed(client({
      getQuality: (id) => {
        n += 1
        return n === 1 ? Promise.reject(new Error('x')) : Promise.resolve(quality(id))
      },
    }))
    feed.select(ev('e1', 'b1'))
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(feed.get().related.status).toBe('error')
    feed.retryRelated()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(feed.get().related.status).toBe('ready')
  })

  it('dispose prevents late write-back', async () => {
    const d = deferred<QualityReport>()
    const feed = createEventsFeed(client({ getQuality: () => d.promise }))
    feed.select(ev('e1', 'b1'))
    feed.dispose()
    d.resolve(quality('b1'))
    await Promise.resolve(); await Promise.resolve()
    expect(feed.get().related.status).toBe('loading') // 未被迟到响应改写
  })

  it('StrictMode replay: fresh feed after dispose loads to ready; disposed feed ignored', async () => {
    const dOld = deferred<EventList>()
    let n = 0
    const c = client({ listEvents: () => { n += 1; return n === 1 ? dOld.promise : Promise.resolve(list(['fresh'])) } })
    const f1 = createEventsFeed(c)
    const p1 = f1.load()
    f1.dispose()                     // 模拟 StrictMode 第一次 cleanup
    const f2 = createEventsFeed(c)   // 第二次 setup 新建
    await f2.load()
    expect(f2.get().items.map((x) => x.eventId)).toEqual(['fresh'])
    dOld.resolve(list(['old']))
    await p1
    expect(f1.get().items).toEqual([]) // 旧代次永久失效
    expect(f2.get().items[0].eventId).toBe('fresh')
  })
})

describe('M10 r02 selectById', () => {
  it('ok -> selects that exact event', async () => {
    const feed = createEventsFeed(client({ getEvent: (id) => Promise.resolve({ ...ev(id), eventId: id }) }))
    feed.selectById('eX')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(feed.get().related.status).toBe('ready')
    expect(feed.get().related.event?.eventId).toBe('eX')
  })
  it('404 -> explicit error, no stale detail', async () => {
    const feed = createEventsFeed(client({ getEvent: () => Promise.reject({ status: 404, code: 'event_not_found' }) }))
    feed.selectById('missing')
    await Promise.resolve(); await Promise.resolve()
    expect(feed.get().related.status).toBe('error')
    expect(feed.get().related.event).toBeNull()
  })
})

describe('M10 r03 selectById status + retry', () => {
  it('503 -> 503 message; retryRelated re-reads same id', async () => {
    let calls = 0
    const feed = createEventsFeed(client({
      getEvent: (id) => { calls += 1; return calls === 1 ? Promise.reject({ status: 503 }) : Promise.resolve({ ...ev(id), eventId: id }) },
    }))
    feed.selectById('e503')
    await Promise.resolve(); await Promise.resolve()
    expect(feed.get().related.status).toBe('error')
    expect(feed.get().related.error).toContain('503')
    feed.retryRelated()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(calls).toBe(2)
    expect(feed.get().related.status).toBe('ready')
  })
  it('network(0) -> network message', async () => {
    const feed = createEventsFeed(client({ getEvent: () => Promise.reject({ status: 0 }) }))
    feed.selectById('x')
    await Promise.resolve(); await Promise.resolve()
    expect(feed.get().related.error).toContain('network')
  })
})

describe('M10 r04 setQuery 受控 offset', () => {
  it('setQuery 带 offset 时按给定 offset 查询（不清零）', async () => {
    const calls: { offset?: number; sourceId?: string }[] = []
    const feed = createEventsFeed(client({
      listEvents: (q?: { offset?: number; sourceId?: string }) => { calls.push(q ?? {}); return Promise.resolve(list(['e1'])) },
    }))
    feed.setQuery({ sourceId: 's1', offset: 20 })
    await Promise.resolve(); await Promise.resolve()
    expect(calls.at(-1)).toMatchObject({ offset: 20, sourceId: 's1' })
    expect(feed.get().offset).toBe(20)
    expect(feed.get().filters).toEqual({ sourceId: 's1' })
  })
  it('setQuery 缺省 offset 回首页；setFilters 仍清零', async () => {
    const feed = createEventsFeed(client())
    feed.setQuery({ offset: 20 }); await Promise.resolve()
    feed.setQuery({}); await Promise.resolve()
    expect(feed.get().offset).toBe(0)
    feed.setQuery({ offset: 30 }); await Promise.resolve()
    feed.setFilters({ sourceId: 's' }); await Promise.resolve()
    expect(feed.get().offset).toBe(0)
  })
  it('setQuery 的 resetRelated 之后按合法 eventId 重建详情', async () => {
    const feed = createEventsFeed(client())
    feed.setQuery({ sourceId: 's1', offset: 10 })
    feed.selectById('e9')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(feed.get().related.status).toBe('ready')
    expect(feed.get().related.event?.eventId).toBe('e9')
  })
})
