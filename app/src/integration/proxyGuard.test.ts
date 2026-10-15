import { describe, expect, it } from 'vitest'
import { authorizeProxyRequest, type ProxyPolicy } from './proxyGuard'

const PUBLIC = 'https://4202-a1db149b692927f8.code.cosmoplat.cn'
const policy: ProxyPolicy = {
  origins: [PUBLIC, 'http://127.0.0.1:4202', 'http://localhost:4202'],
  hosts: ['4202-a1db149b692927f8.code.cosmoplat.cn', '127.0.0.1:4202', 'localhost:4202'],
}
const pubHeaders = { origin: PUBLIC, host: '4202-a1db149b692927f8.code.cosmoplat.cn' }

describe('M06b proxy guard', () => {
  it('GET health without origin is allowed', () => {
    expect(authorizeProxyRequest('GET', '/api/qh-data/health', {}, policy)).toEqual({ ok: true, rest: '/health' })
  })

  it('POST with exact public origin + host is allowed (browser same-origin)', () => {
    const r = authorizeProxyRequest('POST', '/api/qh-data/batches?format=csv', pubHeaders, policy)
    expect(r).toEqual({ ok: true, rest: '/batches?format=csv' })
  })

  it('POST missing / null / foreign origin is rejected', () => {
    expect(authorizeProxyRequest('POST', '/api/qh-data/batches', { host: pubHeaders.host }, policy)).toMatchObject({ ok: false, status: 403, error: 'origin_not_allowed' })
    expect(authorizeProxyRequest('POST', '/api/qh-data/batches', { origin: 'null', host: pubHeaders.host }, policy)).toMatchObject({ ok: false, status: 403 })
    expect(authorizeProxyRequest('POST', '/api/qh-data/batches', { origin: 'https://evil.example', host: pubHeaders.host }, policy)).toMatchObject({ ok: false, status: 403 })
  })

  it('POST with bad host is rejected', () => {
    expect(authorizeProxyRequest('POST', '/api/qh-data/batches', { origin: PUBLIC, host: 'evil.example' }, policy)).toMatchObject({ ok: false, status: 403, error: 'host_not_allowed' })
  })

  it('rejects /api/qh-dataevil and double prefix', () => {
    expect(authorizeProxyRequest('GET', '/api/qh-dataevil/health', {}, policy)).toMatchObject({ ok: false, status: 404, error: 'bad_path' })
    expect(authorizeProxyRequest('GET', '/api/qh-data/api/qh-data/health', {}, policy)).toMatchObject({ ok: false, status: 404, error: 'bad_path' })
  })

  it('rejects unknown routes and wrong methods', () => {
    expect(authorizeProxyRequest('GET', '/api/qh-data/secret', {}, policy)).toMatchObject({ ok: false, status: 404, error: 'route_not_allowed' })
    expect(authorizeProxyRequest('POST', '/api/qh-data/health', pubHeaders, policy)).toMatchObject({ ok: false, status: 405, error: 'method_not_allowed' })
    expect(authorizeProxyRequest('DELETE', '/api/qh-data/batches', pubHeaders, policy)).toMatchObject({ ok: false, status: 405 })
  })

  it('rejects non-data paths', () => {
    expect(authorizeProxyRequest('GET', '/api/other/health', {}, policy)).toMatchObject({ ok: false, status: 404, error: 'not_data_path' })
  })

  it('allows read-only /events and /events/{id}', () => {
    expect(authorizeProxyRequest('GET', '/api/qh-data/events?limit=5', {}, policy)).toEqual({ ok: true, rest: '/events?limit=5' })
    expect(authorizeProxyRequest('GET', '/api/qh-data/events/abc123', {}, policy)).toEqual({ ok: true, rest: '/events/abc123' })
    // 事件只读：POST 不接受
    expect(authorizeProxyRequest('POST', '/api/qh-data/events', pubHeaders, policy)).toMatchObject({ ok: false, status: 405 })
  })
})
