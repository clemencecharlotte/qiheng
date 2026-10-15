import { useMemo, useState } from 'react'
import StatusBadge, { statusTone } from './console/StatusBadge'
import type { EventCategory, TimelineEvent } from '../domain/events'
import type { SourceId } from '../domain/sources'

const CATEGORY_META: Record<EventCategory, { label: string }> = {
  data_quality: { label: '数据质量' },
  health_rule: { label: '健康规则' },
  schedule: { label: '调度结果' },
  safety_review: { label: '安全审查' },
  human_action: { label: '人工处置' },
}

const SOURCE_LABEL: Record<SourceId, string> = {
  synthetic_schedule: '合成调度示例',
  synthetic_history: '合成回放夹具',
}

const CATEGORY_ORDER: Array<'all' | EventCategory> = [
  'all',
  'data_quality',
  'health_rule',
  'schedule',
  'safety_review',
  'human_action',
]

interface Props {
  events: TimelineEvent[]
  /** 固定选中的事件（由工作区持有，用于驱动决策详情）。 */
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  onLocate?: (event: TimelineEvent) => void
}

export default function EventTimeline({
  events,
  selectedId = null,
  onSelect,
  onLocate,
}: Props) {
  const [filter, setFilter] = useState<'all' | EventCategory>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | SourceId>('all')
  const [hoverId, setHoverId] = useState<string | null>(null)

  const visible = useMemo(
    () =>
      events.filter(
        (e) =>
          (filter === 'all' || e.category === filter) &&
          (sourceFilter === 'all' || e.source === sourceFilter),
      ),
    [events, filter, sourceFilter],
  )

  const filterActive = filter !== 'all' || sourceFilter !== 'all'
  const selected = selectedId
    ? events.find((e) => e.id === selectedId) ?? null
    : null
  // 无固定选中时，hover 事件只作为临时预览；有固定选中时 hover 不覆盖。
  const preview =
    !selected && hoverId ? events.find((e) => e.id === hoverId) ?? null : null
  const detailEvent = selected ?? preview
  const isPreview = !selected && Boolean(preview)

  return (
    <section className="panel" data-evidence="event-timeline" tabIndex={-1}>
      <div className="panel-head">
        <h2>事件列表</h2>
        <span className="hint">
          当前显示 {visible.length} / 共 {events.length} 条 · 点击固定详情，悬停其他行只做临时提示
        </span>
      </div>

      <div className="toolbar event-filters">
        <div className="scenario-tabs" role="group" aria-label="按类别过滤">
          {CATEGORY_ORDER.map((c) => (
            <button
              type="button"
              key={c}
              aria-pressed={filter === c}
              className={`scenario-tab${filter === c ? ' active' : ''}`}
              onClick={() => setFilter(c)}
            >
              {c === 'all' ? '全部类别' : CATEGORY_META[c].label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>来源</span>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as 'all' | SourceId)}
          >
            <option value="all">全部来源</option>
            <option value="synthetic_schedule">合成调度示例</option>
            <option value="synthetic_history">合成回放夹具</option>
          </select>
        </label>
        {filterActive ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setFilter('all')
              setSourceFilter('all')
            }}
          >
            清除过滤
          </button>
        ) : null}
      </div>

      <div className="event-layout">
        <div className="event-list-wrap">
          {visible.length === 0 ? (
            <p className="hint event-empty">
              当前过滤条件下没有事件。可清除过滤查看全部 {events.length} 条。
            </p>
          ) : (
            <ul className="timeline event-list">
              {visible.map((e) => {
                const isSelected = selectedId === e.id
                return (
                  <li
                    key={e.id}
                    className={`timeline-item${isSelected ? ' selected' : ''}${
                      hoverId === e.id && !isSelected ? ' hovered' : ''
                    }`}
                    onMouseEnter={() => setHoverId(e.id)}
                    onMouseLeave={() => setHoverId((prev) => (prev === e.id ? null : prev))}
                  >
                    <button
                      type="button"
                      className="event-row"
                      aria-pressed={isSelected}
                      onClick={() => onSelect?.(isSelected ? null : e.id)}
                      onFocus={() => setHoverId(e.id)}
                      onBlur={() => setHoverId((prev) => (prev === e.id ? null : prev))}
                    >
                      <span className="tag muted">{CATEGORY_META[e.category].label}</span>
                      <span className="timeline-time mono">{e.time}</span>
                      <span className="event-source">{SOURCE_LABEL[e.source]}</span>
                      <StatusBadge tone={statusTone(e.status)} label={e.status} />
                      <span className="timeline-title">{e.title}</span>
                      <span className="event-reason">{e.reason}</span>
                      <span className="event-assoc">
                        {e.locate ? '可定位' : '未关联'}
                      </span>
                    </button>
                    {hoverId === e.id && !isSelected && selectedId ? (
                      <span className="event-hover-note">临时提示：点击可固定该事件详情</span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="event-detail" aria-live="polite">
          {detailEvent ? (
            <article className="event-detail-card">
              <header className="event-detail-head">
                <span className="tag muted">{CATEGORY_META[detailEvent.category].label}</span>
                <span className={`tag ${isPreview ? 'warn' : 'ok'}`}>
                  {isPreview ? '临时预览（未固定）' : '已固定详情'}
                </span>
              </header>
              <h3>{detailEvent.title}</h3>
              <dl className="context-facts">
                <div>
                  <dt>来源</dt>
                  <dd>{SOURCE_LABEL[detailEvent.source]}</dd>
                </div>
                <div>
                  <dt>时间</dt>
                  <dd className="mono">{detailEvent.time}</dd>
                </div>
                <div>
                  <dt>处置 / 判定状态</dt>
                  <dd><StatusBadge tone={statusTone(detailEvent.status)} label={detailEvent.status} /></dd>
                </div>
                <div>
                  <dt>原因</dt>
                  <dd>{detailEvent.reason}</dd>
                </div>
              </dl>
              <p className="event-detail-body">{detailEvent.detail}</p>
              <div className="chip-list">
                {detailEvent.evidenceRefs.map((ref) => (
                  <span className="chip mono" key={ref}>
                    {ref}
                  </span>
                ))}
              </div>
              <div className="event-locate">
                {detailEvent.locate ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onLocate?.(detailEvent)}
                  >
                    定位到
                    {detailEvent.locate.kind === 'schedule' ? '合成调度' : '合成回放'}{' '}
                    {detailEvent.locate.label}
                    {detailEvent.locate.kind === 'history'
                      ? `（${detailEvent.locate.machineId}）`
                      : ''}
                  </button>
                ) : (
                  <span className="tag muted">
                    未关联：该事件是复验结论或人工处置，没有可映射的真实时段，不猜测时间或机组
                  </span>
                )}
              </div>
            </article>
          ) : (
            <p className="hint">
              点击左侧任意事件固定详情；未固定时悬停只显示临时预览。定位按钮只在事件能映射到自身来源时轴时可用。
            </p>
          )}
        </div>
      </div>
    </section>
  )
}