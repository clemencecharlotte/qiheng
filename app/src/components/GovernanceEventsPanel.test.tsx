import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import GovernanceEventsPanel, { GovernanceEventsView, validateGovernanceDraft, type GovernanceEventsViewProps } from './GovernanceEventsPanel'
import type { EventsState } from '../integration/eventsFeed'
import type { GovernanceEvent } from '../integration/contracts'

const noop = () => {}

const E1: GovernanceEvent = {
  eventId: 'e1', sourceId: 'synth-air-1', batchId: 'b1', type: 'import_completed', severity: 'info',
  occurredAt: '2026-10-07T08:00:00.000Z', receivedAt: '2026-10-07T08:00:01.000Z', ruleVersion: 'v1',
  reasons: [{ reason: 'valid', c: 2 }], detail: '批次导入完成：有效 2 / 隔离 0 / 拒绝 0',
}
const E2: GovernanceEvent = {
  eventId: 'e2', sourceId: 'synth-air-1', batchId: 'b2', type: 'rows_rejected', severity: 'warn',
  occurredAt: '2026-10-07T08:05:00.000Z', receivedAt: '2026-10-07T08:05:01.000Z', ruleVersion: 'v1',
  reasons: [{ reason: 'non_finite_value', c: 1 }], detail: '拒绝 1 行',
}
const ERRSVC: GovernanceEvent = { ...E2, eventId: 'e3', type: 'service_error', batchId: null, detail: '服务错误：ValueError' }

function baseState(over: Partial<EventsState> = {}): EventsState {
  return {
    loading: false, error: null, limit: 10, offset: 0, total: 2, filters: {}, items: [E1, E2],
    related: { status: 'idle', event: null, batch: null, quality: null, error: null },
    ...over,
  }
}

function view(over: Partial<GovernanceEventsViewProps> = {}) {
  return renderToStaticMarkup(
    <GovernanceEventsView
      enabled
      state={baseState()}
      filters={{ type: '', severity: '', sourceId: '' }}
      now={Date.UTC(2026, 9, 7, 12, 0, 0)}
      onFilterChange={noop} onApply={noop} onReset={noop} onRefresh={noop}
      onPrev={noop} onNext={noop} onSelect={noop} onRetryRelated={noop}
      {...over}
    />,
  )
}

describe('M08 GovernanceEventsView', () => {
  it('disabled -> unconfigured empty', () => {
    expect(view({ enabled: false })).toContain('data-testid="qge-empty"')
  })

  it('lists events + filters + pagination; never claims live', () => {
    const html = view()
    expect((html.match(/data-testid="qge-item"/g) || []).length).toBe(2)
    expect(html).toContain('导入完成')
    expect(html).toContain('拒绝')
    expect(html).toContain('data-testid="qge-range"')
    expect(html).not.toContain('>live<')
    expect(html).toContain('data-qh-note-ref="qh-note-governance"')
    expect(html).not.toContain('**')
  })

  it('no result -> empty, and detail stays idle (no stale evidence)', () => {
    const html = view({ state: baseState({ items: [], total: 0 }) })
    expect(html).toContain('无匹配事件')
    expect(html).not.toContain('data-testid="qge-detail"')
  })

  it('error + retry, empty states', () => {
    expect(view({ state: baseState({ items: [], error: '加载失败', total: 0 }) })).toContain('data-testid="qge-retry"')
  })

  it('related ready with batch -> counts', () => {
    const html = view({
      state: baseState({
        related: { status: 'ready', event: E2, batch: null, quality: { batchId: 'b2', ruleVersion: 'v1', status: 'partial', unordered: false, note: '', counts: { total: 3, valid: 1, isolated: 1, rejected: 1 }, rejectReasons: [], isolateReasons: [], rejections: [] }, error: null },
      }),
    })
    expect(html).toContain('data-testid="qge-detail"')
    expect(html).toContain('b2')
    expect(html).toContain('non_finite_value')
  })

  it('related ready without batchId (service error) -> no batch block', () => {
    const html = view({
      state: baseState({ related: { status: 'ready', event: ERRSVC, batch: null, quality: null, error: null } }),
    })
    expect(html).toContain('该事件不关联批次')
    expect(html).toContain('ValueError')
  })

  it('related loading / error are explicit distinct states, error has retry button', () => {
    expect(view({ state: baseState({ related: { status: 'loading', event: E1, batch: null, quality: null, error: null } }) }))
      .toContain('data-testid="qge-detail-loading"')
    const err = view({ state: baseState({ related: { status: 'error', event: E1, batch: null, quality: null, error: '加载失败' } }) })
    expect(err).toContain('data-testid="qge-detail-error"')
    expect(err).toContain('data-testid="qge-detail-retry"')
  })
})

describe('M08 GovernanceEventsPanel (default, no env)', () => {
  it('renders without network', () => {
    expect(renderToStaticMarkup(<GovernanceEventsPanel />)).toContain('治理事件')
  })
})

describe('M10 r03 governance related-batch action', () => {
  it('related ready with batch -> 打开关联批次 action present', () => {
    const html = view({
      state: baseState({
        related: { status: 'ready', event: E2, batch: null, quality: { batchId: 'b2', ruleVersion: 'v1', status: 'ok', unordered: false, note: '', counts: { total: 1, valid: 1, isolated: 0, rejected: 0 }, rejectReasons: [], isolateReasons: [], rejections: [] }, error: null },
      }),
      onOpenBatch: () => {},
    })
    expect(html).toContain('data-testid="qge-open-batch"')
  })
})

describe('M10 r04 受控查询草稿校验（纯 runtime）', () => {
  it('合法来源/类型/级别 → patch；offset 重置首页', () => {
    const { patch, error } = validateGovernanceDraft({ type: 'rows_rejected', severity: 'warn', sourceId: 'synth-air-2' })
    expect(error).toBeNull()
    expect(patch).toEqual({ sourceId: 'synth-air-2', type: 'rows_rejected', severity: 'warn', offset: null })
  })
  it('空草稿 → 全清空', () => {
    const { patch } = validateGovernanceDraft({ type: '', severity: '', sourceId: '' })
    expect(patch).toEqual({ sourceId: null, type: null, severity: null, offset: null })
  })
  it('非法来源 token / 未知枚举 → 拒绝且无 patch', () => {
    expect(validateGovernanceDraft({ type: '', severity: '', sourceId: 'bad source!' }).patch).toBeNull()
    expect(validateGovernanceDraft({ type: '', severity: '', sourceId: 'x'.repeat(65) }).patch).toBeNull()
    expect(validateGovernanceDraft({ type: 'bogus', severity: '', sourceId: '' }).error).toContain('类型取值非法')
    expect(validateGovernanceDraft({ type: '', severity: 'fatal', sourceId: '' }).error).toContain('级别取值非法')
  })
  it('queryError 渲染为明确提示', () => {
    const html = view({ queryError: '来源标识格式非法：仅限 1–64 位字母 / 数字 / 下划线 / 连字符。' })
    expect(html).toContain('data-testid="qge-query-error"')
    expect(html).toContain('来源标识格式非法')
  })
})
