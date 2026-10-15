/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest'

/**
 * M09 接线回归：治理事件详情在 error 时的“重试”按钮必须真正接上 onRetryRelated。
 * 用 JSX runtime 捕获真实渲染元素，断言按钮的 onClick === 传入的回调。
 */
type CapturedEl = { type: unknown; props: Record<string, unknown> }
const captured = vi.hoisted(() => [] as CapturedEl[])

vi.mock('react/jsx-runtime', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, (...a: unknown[]) => unknown>
  const wrap = (fn: (...a: unknown[]) => unknown) => (type: unknown, props: unknown, key?: unknown) => {
    captured.push({ type, props: (props || {}) as Record<string, unknown> })
    return fn(type, props, key)
  }
  return { ...actual, jsx: wrap(actual.jsx), jsxs: wrap(actual.jsxs) }
})
vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, (...a: unknown[]) => unknown>
  const wrap = (fn: (...a: unknown[]) => unknown) => (type: unknown, props: unknown, ...rest: unknown[]) => {
    captured.push({ type, props: (props || {}) as Record<string, unknown> })
    return fn(type, props, ...rest)
  }
  return { ...actual, jsxDEV: wrap(actual.jsxDEV) }
})

import { renderToString } from 'react-dom/server'
import { GovernanceEventsView } from './GovernanceEventsPanel'
import type { EventsState } from '../integration/eventsFeed'
import type { GovernanceEvent } from '../integration/contracts'

const E1: GovernanceEvent = {
  eventId: 'e1', sourceId: 's', batchId: 'b1', type: 'rows_rejected', severity: 'warn',
  occurredAt: 't', receivedAt: 't', ruleVersion: 'v1', reasons: null, detail: 'd',
}
const STATE: EventsState = {
  loading: false, error: null, limit: 10, offset: 0, total: 0, filters: {}, items: [],
  related: { status: 'error', event: E1, batch: null, quality: null, error: '关联批次加载失败' },
}

describe('M09 governance detail retry wiring', () => {
  it('retry button onClick is wired to onRetryRelated', () => {
    captured.length = 0
    const onRetryRelated = vi.fn()
    const noop = () => {}
    renderToString(
      <GovernanceEventsView
        enabled
        state={STATE}
        filters={{ type: '', severity: '', sourceId: '' }}
        now={0}
        onFilterChange={noop} onApply={noop} onReset={noop} onRefresh={noop}
        onPrev={noop} onNext={noop} onSelect={noop}
        onRetryRelated={onRetryRelated}
      />,
    )
    const retry = captured.find((e) => e.props['data-testid'] === 'qge-detail-retry')
    expect(retry, '缺少详情重试按钮').toBeTruthy()
    expect(typeof retry?.props.onClick).toBe('function')
    ;(retry?.props.onClick as () => void)()
    expect(onRetryRelated).toHaveBeenCalledTimes(1)
  })
})
