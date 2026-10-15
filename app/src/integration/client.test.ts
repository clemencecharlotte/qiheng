import { describe, expect, it } from 'vitest'
import { createDataClient, DataApiError } from './client'

function fakeFetch(routes: Record<string, { status: number; body: unknown }>, calls: Array<{ url: string; init?: RequestInit }> = []) {
  const impl = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string }).url)
    calls.push({ url, init })
    const rec = routes[url]
    if (!rec) throw new Error('no route: ' + url)
    return {
      ok: rec.status >= 200 && rec.status < 300,
      status: rec.status,
      text: async () => JSON.stringify(rec.body),
    } as unknown as Response
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('M06 data client', () => {
  it('health parses typed payload from fixed base', async () => {
    const { impl } = fakeFetch({ '/api/qh-data/health': { status: 200, body: { status: 'ok', schemaVersion: 1 } } })
    const c = createDataClient({ fetchImpl: impl })
    const h = await c.health()
    expect(h.schemaVersion).toBe(1)
  })

  it('importBatch posts csv with correct content-type and query', async () => {
    const { impl, calls } = fakeFetch({
      '/api/qh-data/batches?format=csv&filename=a.csv': { status: 201, body: { batchId: 'b1', idempotent: false, counts: { valid: 2, isolated: 0, rejected: 0 } } },
    })
    const c = createDataClient({ fetchImpl: impl })
    const r = await c.importBatch('a,b\n1,2', { format: 'csv', filename: 'a.csv' })
    expect(r.batchId).toBe('b1')
    expect(calls[0].init?.method).toBe('POST')
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBe('text/csv')
  })

  it('token header only added when provided; base never arbitrary', async () => {
    const { impl, calls } = fakeFetch({
      '/api/qh-data/batches?limit=50&offset=0': { status: 200, body: { items: [], total: 0 } },
    })
    const c = createDataClient({ fetchImpl: impl, token: 'cap-123' })
    await c.listBatches()
    expect(calls[0].url.startsWith('/api/qh-data')).toBe(true)
    expect((calls[0].init?.headers as Record<string, string>)['X-QH-Capability']).toBe('cap-123')
  })

  it('maps http error to DataApiError(code)', async () => {
    const { impl } = fakeFetch({ '/api/qh-data/health': { status: 401, body: { error: 'unauthorized' } } })
    const c = createDataClient({ fetchImpl: impl })
    await expect(c.health()).rejects.toMatchObject({ name: 'DataApiError', status: 401, code: 'unauthorized' })
  })

  it('maps network failure to DataApiError(0, network_error)', async () => {
    const impl = (async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    const c = createDataClient({ fetchImpl: impl })
    await expect(c.health()).rejects.toBeInstanceOf(DataApiError)
    await expect(c.health()).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })
})
