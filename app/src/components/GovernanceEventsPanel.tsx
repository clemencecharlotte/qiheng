import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createDataClient, type DataClient } from '../integration/client'
import { readEnv } from '../integration/env'
import { createEventsFeed, type EventsState } from '../integration/eventsFeed'
import { describeAge } from '../integration/state'
import type { EventSeverity, GovernanceEvent, GovernanceEventType } from '../integration/contracts'
import NoteRef from './console/NoteRef'
import './GovernanceEventsPanel.css'

const TYPE_LABEL: Record<GovernanceEventType, string> = {
  import_completed: '导入完成',
  rows_isolated: '隔离',
  rows_rejected: '拒绝',
  service_error: '服务错误',
}
const TYPES: GovernanceEventType[] = ['import_completed', 'rows_isolated', 'rows_rejected', 'service_error']
const SEVERITIES: EventSeverity[] = ['info', 'warn', 'error']

interface FilterInputs {
  type: string
  severity: string
  sourceId: string
}

export interface GovernanceEventsViewProps {
  enabled: boolean
  state: EventsState
  filters: FilterInputs
  now: number
  onFilterChange: (patch: Partial<FilterInputs>) => void
  onApply: () => void
  onReset: () => void
  onRefresh: () => void
  onPrev: () => void
  onNext: () => void
  onSelect: (event: GovernanceEvent) => void
  onRetryRelated: () => void
  onOpenBatch?: (batchId: string) => void
  /** 受控查询输入校验失败的明确提示（未应用，不导航）。 */
  queryError?: string | null
}

/** 纯展示视图（无副作用，便于 SSR 测试）。 */
export function GovernanceEventsView(props: GovernanceEventsViewProps) {
  const { enabled, state, filters, now, onFilterChange, onApply, onReset, onRefresh, onPrev, onNext, onSelect, onRetryRelated, onOpenBatch } = props
  const related = state.related
  const activeId = related.status !== 'idle' ? related.event?.eventId : undefined

  return (
    <section className="qh-gov-events" id="qh-gov-events" aria-labelledby="qh-gov-events-h">
      <header className="qge-hd">
        <div>
          <p className="qge-eyebrow">Governance events / 治理事件</p>
          <h3 id="qh-gov-events-h" tabIndex={-1}>真实治理事件（只读）</h3>
        </div>
        <button type="button" className="qge-refresh" onClick={onRefresh} disabled={state.loading} data-testid="qge-refresh">
          {state.loading ? '加载中…' : '刷新'}
        </button>
      </header>

      {!enabled ? (
        <p className="qge-muted" data-testid="qge-empty">治理事件服务未配置。设置独立候选后显示。</p>
      ) : (
        <>
          <div className="qge-filters">
            <label className="qge-field">
              <span>类型</span>
              <select value={filters.type} onChange={(e) => onFilterChange({ type: e.target.value })} data-testid="qge-type">
                <option value="">全部</option>
                {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="qge-field">
              <span>级别</span>
              <select value={filters.severity} onChange={(e) => onFilterChange({ severity: e.target.value })} data-testid="qge-severity">
                <option value="">全部</option>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="qge-field">
              <span>来源</span>
              <input
                value={filters.sourceId}
                placeholder="sourceId"
                onChange={(e) => onFilterChange({ sourceId: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') onApply() }}
                data-testid="qge-source"
              />
            </label>
            <button type="button" className="qge-apply" onClick={onApply} data-testid="qge-apply">查询</button>
            <button type="button" className="qge-reset" onClick={onReset} data-testid="qge-reset">重置</button>
          </div>

          {props.queryError ? (
            <p className="qge-error" role="alert" data-testid="qge-query-error">{props.queryError}</p>
          ) : null}

          {state.error ? (
            <p className="qge-error" role="alert" data-testid="qge-error">
              {state.error}
              <button type="button" onClick={onRefresh} data-testid="qge-retry">重试</button>
            </p>
          ) : null}

          {state.items.length === 0 && !state.error ? (
            <p className="qge-muted" data-testid="qge-none">{state.loading ? '加载中…' : '无匹配事件。'}</p>
          ) : (
            <ul className="qge-list">
              {state.items.map((e) => (
                <li key={e.eventId}>
                  <button
                    type="button"
                    className={activeId === e.eventId ? 'qge-item active' : 'qge-item'}
                    onClick={() => onSelect(e)}
                    data-testid="qge-item"
                  >
                    <span className={`qge-sev qge-sev-${e.severity}`}>{e.severity}</span>
                    <span className="qge-type">{TYPE_LABEL[e.type]}</span>
                    <span className="qge-src">{e.sourceId ?? '—'}</span>
                    <span className="qge-time">{e.receivedAt}（{describeAge(now, e.receivedAt)}）</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="qge-page">
            <button type="button" onClick={onPrev} disabled={state.offset <= 0 || state.loading} data-testid="qge-prev">上一页</button>
            <span data-testid="qge-range">
              {state.total === 0 ? '0' : `${state.offset + 1}–${Math.min(state.offset + state.limit, state.total)}`} / {state.total}
            </span>
            <button
              type="button"
              onClick={onNext}
              disabled={state.offset + state.limit >= state.total || state.loading}
              data-testid="qge-next"
            >下一页</button>
          </div>

          {related.status === 'loading' ? (
            <p className="qge-muted" data-testid="qge-detail-loading">事件详情加载中…</p>
          ) : related.status === 'error' ? (
            <p className="qge-error" role="alert" data-testid="qge-detail-error">
              {related.error}
              <button type="button" onClick={onRetryRelated} data-testid="qge-detail-retry">重试</button>
            </p>
          ) : related.status === 'ready' && related.event ? (
            <div className="qge-detail" data-testid="qge-detail">
              <h4>事件详情 · {TYPE_LABEL[related.event.type]}</h4>
              <p>{related.event.detail ?? '（无补充说明）'}</p>
              <p className="qge-muted">
                规则版本 {related.event.ruleVersion ?? '—'}；发生 {related.event.occurredAt}；接收 {related.event.receivedAt}
              </p>
              {related.event.reasons && related.event.reasons.length > 0 ? (
                <ul className="qge-reasons">
                  {related.event.reasons.map((r) => <li key={r.reason}>{r.reason} × {r.c}</li>)}
                </ul>
              ) : null}
              {related.event.batchId ? (
                <div className="qge-related">
                  <p>关联批次：<code>{related.event.batchId}</code></p>
                  {onOpenBatch ? (
                    <button
                      type="button"
                      className="qge-link"
                      data-testid="qge-open-batch"
                      onClick={() => onOpenBatch(related.event?.batchId as string)}
                    >
                      打开关联批次
                    </button>
                  ) : null}
                  {related.quality ? (
                    <ul className="qge-counts">
                      <li><b>{related.quality.counts.valid}</b><span>有效</span></li>
                      <li><b>{related.quality.counts.isolated}</b><span>隔离</span></li>
                      <li><b>{related.quality.counts.rejected}</b><span>拒绝</span></li>
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="qge-muted">该事件不关联批次（如服务错误）。</p>
              )}
            </div>
          ) : null}

          <p className="qge-note">
            治理事件<NoteRef note="governance" />
          </p>
        </>
      )}
    </section>
  )
}

export interface GovernanceQuery {
  sourceId: string | null
  type: GovernanceEventType | null
  severity: EventSeverity | null
  offset: number | null
}

export interface GovernanceEventsPanelProps {
  client?: DataClient
  enabled?: boolean
  limit?: number
  clock?: () => number
  /** 受控查询（canonical route）：Back/Forward/refresh/参数移除都驱动输入与实际 GET。 */
  query?: Partial<GovernanceQuery>
  /** 受控对象定位：URL eventId（bounded）。 */
  initialEventId?: string | null
  /** 查询/重置/分页回写 canonical route（唯一写入方在 App）；事件选择由 onLocate 回写。 */
  onQueryChange?: (patch: Partial<GovernanceQuery>) => void
  onLocate?: (eventId: string | null) => void
  /** 打开关联批次（event→batch）。 */
  onOpenBatch?: (batchId: string) => void
}

const SOURCE_TOKEN = /^[A-Za-z0-9_-]{1,64}$/
const OFFSET_MAX = 1_000_000

/**
 * 输入草稿 → 受控查询（纯函数，可 runtime 窄测）。
 * 合法才产生 patch；非法给出明确错误且不导航（未知/非法/越界一律拒绝）。
 */
export function validateGovernanceDraft(draft: FilterInputs): {
  patch: Partial<GovernanceQuery> | null
  error: string | null
} {
  const sourceId = draft.sourceId.trim()
  if (sourceId && !SOURCE_TOKEN.test(sourceId)) {
    return { patch: null, error: '来源标识格式非法：仅限 1–64 位字母 / 数字 / 下划线 / 连字符。' }
  }
  if (draft.type && !TYPES.includes(draft.type as GovernanceEventType)) {
    return { patch: null, error: `类型取值非法「${draft.type}」。` }
  }
  if (draft.severity && !SEVERITIES.includes(draft.severity as EventSeverity)) {
    return { patch: null, error: `级别取值非法「${draft.severity}」。` }
  }
  return {
    patch: {
      sourceId: sourceId || null,
      type: (draft.type || null) as GovernanceEventType | null,
      severity: (draft.severity || null) as EventSeverity | null,
      offset: null,
    },
    error: null,
  }
}

export default function GovernanceEventsPanel({ client, enabled, limit = 10, clock = Date.now, query, initialEventId = null, onQueryChange, onLocate, onOpenBatch }: GovernanceEventsPanelProps) {
  const env = readEnv()
  const baseUrl = env.VITE_QH_DATA_BASE
  const isEnabled = enabled ?? (env.VITE_QH_DATA_ENABLED !== '0' && Boolean(baseUrl))
  const dataClient = useMemo(
    () => client ?? createDataClient({ baseUrl: baseUrl ?? '/api/qh-data' }),
    [client, baseUrl],
  )
  const [feed, setFeed] = useState(() => createEventsFeed(dataClient, { limit }))
  const state = useSyncExternalStore(feed.subscribe, feed.get, feed.get)

  const qSourceId = query?.sourceId ?? null
  const qType = query?.type ?? null
  const qSeverity = query?.severity ?? null
  const qOffset = query?.offset ?? null

  // 输入草稿（未应用）：由 canonical route 驱动；查询未应用前不写回 URL。
  const [filters, setFilters] = useState<FilterInputs>({ type: '', severity: '', sourceId: '' })
  const [draftError, setDraftError] = useState<string | null>(null)

  // StrictMode 可重入：每次 setup 新建控制器，cleanup 只废弃本次实例；旧代次响应永久失效。
  // 不能复用 setFeed 后仍被 cleanup dispose 的同一对象。
  useEffect(() => {
    const f = createEventsFeed(dataClient, { limit })
    setFeed(f)
    if (isEnabled) void f.load()
    return () => f.dispose()
  }, [dataClient, limit, isEnabled])

  // canonical route → 输入草稿：Back/Forward/refresh 与同页参数移除都真实驱动输入。
  useEffect(() => {
    setFilters({ type: qType ?? '', severity: qSeverity ?? '', sourceId: qSourceId ?? '' })
    setDraftError(null)
  }, [qType, qSeverity, qSourceId])

  // canonical route → 实际 GET：查询/分页统一走受控 setQuery（offset 不被清零假设）。
  useEffect(() => {
    if (!isEnabled) return
    feed.setQuery({
      sourceId: qSourceId ?? undefined,
      type: qType ?? undefined,
      severity: qSeverity ?? undefined,
      offset: qOffset ?? 0,
    })
  }, [feed, isEnabled, qSourceId, qType, qSeverity, qOffset])

  // URL 受控对象定位：eventId / 查询变化时重新选中对应事件；无 eventId 时清空详情。
  // （setQuery 的 resetRelated 会清旧详情，这里按合法 eventId 重建，不被擦掉。）
  useEffect(() => {
    if (initialEventId) feed.selectById(initialEventId)
    else feed.clearRelated()
  }, [initialEventId, feed, qSourceId, qType, qSeverity, qOffset])

  const onApply = () => {
    const { patch, error } = validateGovernanceDraft(filters)
    if (!patch) {
      setDraftError(error)
      return
    }
    setDraftError(null)
    onQueryChange?.(patch)
  }
  const onReset = () => {
    setDraftError(null)
    onQueryChange?.({ sourceId: null, type: null, severity: null, offset: null })
  }
  const onPrev = () => onQueryChange?.({ offset: Math.max(0, (qOffset ?? 0) - limit) })
  const onNext = () => onQueryChange?.({ offset: Math.min(OFFSET_MAX, (qOffset ?? 0) + limit) })

  return (
    <GovernanceEventsView
      enabled={isEnabled}
      state={state}
      filters={filters}
      now={clock()}
      queryError={draftError}
      onFilterChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
      onApply={onApply}
      onReset={onReset}
      onRefresh={() => void feed.refresh()}
      onPrev={onPrev}
      onNext={onNext}
      onSelect={(e) => { feed.select(e); onLocate?.(e.eventId) }}
      onRetryRelated={() => feed.retryRelated()}
      onOpenBatch={onOpenBatch}
    />
  )
}
