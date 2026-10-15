/**
 * 气衡 M07/M08 · 治理事件读取控制器（纯逻辑，无 React）。
 *
 * latest-wins：并发/快速切换筛选时只采纳**最后一次**请求的结果，旧响应丢弃。
 * 失效：任何新查询（setFilters/next/prev/refresh/load）或新选择都会作废在途旧响应；
 *       结果为空时清空/失效关联详情，绝不把旧证据当新查询结果。
 * 详情：显式 idle / loading / ready / error；失败可 retry；dispose 后不再写回。
 */
import type { DataClient } from './client'
import type { BatchSummary, EventQuery, GovernanceEvent, QualityReport } from './contracts'

export type RelatedStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface EventsRelated {
  status: RelatedStatus
  event: GovernanceEvent | null
  batch: BatchSummary | null
  quality: QualityReport | null
  error: string | null
}

export interface EventsState {
  loading: boolean
  error: string | null
  items: GovernanceEvent[]
  total: number
  limit: number
  offset: number
  filters: EventQuery
  related: EventsRelated
}

export interface EventsFeed {
  get: () => EventsState
  subscribe: (cb: () => void) => () => void
  load: () => Promise<void>
  setFilters: (f: EventQuery) => void
  /** 受控查询：同时设置筛选与 offset（offset 缺省回到首页）；不做 offset 清零假设。 */
  setQuery: (q: EventQuery) => void
  next: () => Promise<void>
  prev: () => Promise<void>
  refresh: () => Promise<void>
  select: (event: GovernanceEvent) => void
  selectById: (eventId: string) => void
  retryRelated: () => void
  clearRelated: () => void
  dispose: () => void
}

const IDLE_RELATED: EventsRelated = { status: 'idle', event: null, batch: null, quality: null, error: null }

export function createEventsFeed(
  client: Pick<DataClient, 'listEvents' | 'getBatch' | 'getQuality' | 'getEvent'>,
  opts: { limit?: number; filters?: EventQuery } = {},
): EventsFeed {
  const limit = opts.limit ?? 10
  let listSeq = 0
  let relatedSeq = 0
  let lookupId: string | null = null
  let disposed = false
  let state: EventsState = {
    loading: false, error: null, items: [], total: 0, limit, offset: 0,
    filters: opts.filters ?? {}, related: IDLE_RELATED,
  }
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  function resetRelated() {
    relatedSeq += 1
    state = { ...state, related: IDLE_RELATED }
  }

  async function load(): Promise<void> {
    const my = ++listSeq
    resetRelated() // 新查询使旧详情/在途详情失效
    state = { ...state, loading: true, error: null }
    emit()
    try {
      const res = await client.listEvents({ limit: state.limit, offset: state.offset, ...state.filters })
      if (disposed || my !== listSeq) return
      state = { ...state, loading: false, items: res.items, total: res.total }
      emit()
    } catch {
      if (disposed || my !== listSeq) return
      state = { ...state, loading: false, error: '治理事件加载失败，请重试。' }
      emit()
    }
  }

  async function select(event: GovernanceEvent): Promise<void> {
    lookupId = null
    const my = ++relatedSeq
    if (!event.batchId) {
      // 无 batchId（如服务错误）：仍是明确 ready 详情，不关联批次
      state = { ...state, related: { status: 'ready', event, batch: null, quality: null, error: null } }
      emit()
      return
    }
    state = { ...state, related: { status: 'loading', event, batch: null, quality: null, error: null } }
    emit()
    try {
      const [batch, quality] = await Promise.all([
        client.getBatch(event.batchId),
        client.getQuality(event.batchId),
      ])
      if (disposed || my !== relatedSeq) return // latest-wins
      state = { ...state, related: { status: 'ready', event, batch, quality, error: null } }
      emit()
    } catch {
      if (disposed || my !== relatedSeq) return
      state = { ...state, related: { status: 'error', event, batch: null, quality: null, error: '关联批次加载失败，请重试。' } }
      emit()
    }
  }

  async function selectById(eventId: string): Promise<void> {
    lookupId = eventId
    const my = ++relatedSeq
    state = { ...state, related: { status: 'loading', event: null, batch: null, quality: null, error: null } }
    emit()
    try {
      const event = await client.getEvent(eventId)
      if (disposed || my !== relatedSeq) return
      await select(event)
    } catch (e) {
      if (disposed || my !== relatedSeq) return
      const status = (e as { status?: number } | null)?.status
      const msg =
        status === 0 ? '无法连接只读数据服务（network）。'
          : status === 404 ? '事件不存在或已失效（404）。'
            : status === 503 ? '治理事件服务暂不可用（503），请重试。'
              : `事件加载失败（${status ?? 'error'}），请重试。`
      state = { ...state, related: { status: 'error', event: null, batch: null, quality: null, error: msg } }
      emit()
    }
  }

  return {
    get: () => state,
    subscribe: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    load,
    setFilters: (f) => {
      state = { ...state, filters: f, offset: 0 }
      emit()
      void load()
    },
    setQuery: (q) => {
      // 受控查询：offset 从查询显式读取（缺省首页），筛选里不带 offset 以免遮蔽 state.offset。
      const nextOffset = q.offset !== undefined && q.offset !== null ? Math.max(0, q.offset) : 0
      const { offset: _drop, ...rest } = q
      void _drop
      state = { ...state, filters: rest, offset: nextOffset }
      emit()
      void load()
    },
    next: () => {
      state = { ...state, offset: state.offset + state.limit }
      return load()
    },
    prev: () => {
      state = { ...state, offset: Math.max(0, state.offset - state.limit) }
      return load()
    },
    refresh: () => load(),
    select: (event) => void select(event),
    selectById: (eventId) => void selectById(eventId),
    retryRelated: () => {
      // lookup 失败重试：重读“当前 id”（同一查找），否则重选当前事件。
      if (lookupId) { void selectById(lookupId); return }
      const e = state.related.event
      if (e) void select(e)
    },
    clearRelated: () => { lookupId = null; resetRelated(); emit() },
    dispose: () => {
      disposed = true
      listSeq += 1
      relatedSeq += 1
    },
  }
}
