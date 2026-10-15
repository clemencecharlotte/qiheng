import { describe, expect, it } from 'vitest'
import { mapGovernanceQuery, mergeObjectContext, parseHash, routeHash } from '../domain/router'
import { createEventsFeed } from '../integration/eventsFeed'
import type { EventList } from '../integration/contracts'

/**
 * M10 r05 · 受控查询端到端窄合同（runtime）：
 * 真实组件 patch（{sourceId,type,severity,offset}）→ App 回调适配（mapGovernanceQuery）
 * → navigate 合并（mergeObjectContext）→ canonical hash → parseHash → feed.setQuery → GET 参数。
 * 覆盖 spread 静默丢字段（type/severity/offset 必须真到 GET）。
 */
type PanelPatch = { sourceId?: string | null; type?: string | null; severity?: string | null; offset?: number | null }

function navigateLike(base: ReturnType<typeof parseHash>, patch: PanelPatch) {
  // 复刻 App.navigate 的对象上下文合并：映射为 route 键 + mergeObjectContext + eventId 清除。
  const mapped = mapGovernanceQuery({
    sourceId: patch.sourceId,
    type: (patch.type ?? null) as never,
    severity: (patch.severity ?? null) as never,
    offset: patch.offset,
  })
  // 仅带显式键（与 App 的 hasOwnProperty 口径一致）
  const explicit: Record<string, unknown> = {}
  if (Object.prototype.hasOwnProperty.call(patch, 'sourceId')) explicit.sourceId = mapped.sourceId
  if (Object.prototype.hasOwnProperty.call(patch, 'type')) explicit.eventType = mapped.eventType
  if (Object.prototype.hasOwnProperty.call(patch, 'severity')) explicit.eventSeverity = mapped.eventSeverity
  if (Object.prototype.hasOwnProperty.call(patch, 'offset')) explicit.eventOffset = mapped.eventOffset
  explicit.eventId = null
  const merged = mergeObjectContext(explicit, base, 'events', 'governance')
  const obj = { ...base, ...merged, source: null, t: null, a: null, b: null }
  return parseHash(routeHash(obj))
}

function clientCapturing(calls: Record<string, unknown>[]) {
  return {
    listEvents: (q?: { sourceId?: string; type?: string; severity?: string; offset?: number }) => {
      calls.push((q ?? {}) as Record<string, unknown>)
      const res: EventList = { items: [], total: 0, limit: 10, offset: Number(q?.offset ?? 0) }
      return Promise.resolve(res)
    },
    getBatch: () => Promise.reject(new Error('n/a')),
    getQuality: () => Promise.reject(new Error('n/a')),
    getEvent: () => Promise.reject(new Error('n/a')),
  }
}

describe('M10 r05 受控查询 patch → route → GET', () => {
  const base = parseHash('#/events/governance?mode=legacy&scenario=normal')

  it('查询 synth-air-2 + rows_rejected + warn → URL 与 GET 都带 source/type/severity', async () => {
    const r = navigateLike(base, { sourceId: 'synth-air-2', type: 'rows_rejected', severity: 'warn', offset: null })
    expect(r.sourceId).toBe('synth-air-2')
    expect(r.eventType).toBe('rows_rejected')
    expect(r.eventSeverity).toBe('warn')
    expect(r.normalizedHash).toContain('type=rows_rejected')
    const calls: Record<string, unknown>[] = []
    const feed = createEventsFeed(clientCapturing(calls))
    feed.setQuery({ sourceId: r.sourceId ?? undefined, type: (r.eventType ?? undefined) as never, severity: (r.eventSeverity ?? undefined) as never, offset: r.eventOffset ?? 0 })
    await Promise.resolve(); await Promise.resolve()
    expect(calls.at(-1)).toMatchObject({ sourceId: 'synth-air-2', type: 'rows_rejected', severity: 'warn', offset: 0 })
  })

  it('分页 offset=20 → URL 与 GET 都带 offset=20（不再停在首页）', async () => {
    const page0 = navigateLike(base, { sourceId: 's', type: null, severity: null, offset: null })
    const page1 = navigateLike(page0, { offset: 20 })
    expect(page1.eventOffset).toBe(20)
    expect(page1.normalizedHash).toContain('offset=20')
    const calls: Record<string, unknown>[] = []
    const feed = createEventsFeed(clientCapturing(calls))
    feed.setQuery({ offset: page1.eventOffset ?? 0 })
    await Promise.resolve(); await Promise.resolve()
    expect(calls.at(-1)).toMatchObject({ offset: 20 })
  })

  it('重置（全 null）→ URL 清字段且 GET 不携带过滤', async () => {
    const applied = navigateLike(base, { sourceId: 'synth-air-2', type: 'rows_rejected', severity: 'warn', offset: 20 })
    const reset = navigateLike(applied, { sourceId: null, type: null, severity: null, offset: null })
    expect(reset.normalizedHash).not.toContain('sourceId=')
    expect(reset.normalizedHash).not.toContain('type=')
    expect(reset.normalizedHash).not.toContain('offset=')
    const calls: Record<string, unknown>[] = []
    const feed = createEventsFeed(clientCapturing(calls))
    feed.setQuery({ sourceId: undefined, type: undefined, severity: undefined, offset: 0 })
    await Promise.resolve(); await Promise.resolve()
    const last = calls.at(-1) as Record<string, unknown>
    expect(last.sourceId).toBeUndefined()
    expect(last.type).toBeUndefined()
    expect(last.offset).toBe(0)
  })

  it('offset 0 与 null 均规范化为首页（URL 不携带 offset）', () => {
    expect(navigateLike(base, { offset: 0 }).normalizedHash).not.toContain('offset=')
    expect(navigateLike(base, { offset: null }).normalizedHash).not.toContain('offset=')
  })
})
