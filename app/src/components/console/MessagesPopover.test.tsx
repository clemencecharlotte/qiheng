import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MessagesPopover from './MessagesPopover'
import { consoleDataBus } from '../../integration/consoleDataBus'
import type { ConsoleDataState } from '../../integration/consoleData'

function state(over: Partial<ConsoleDataState>): ConsoleDataState {
  return { status: 'ready', reason: '', batches: [], events: [], sourceState: null, error: null, ...over }
}

describe('M10 MessagesPopover', () => {
  it('unconfigured -> honest note, no fake unread', () => {
    consoleDataBus.publish(state({ status: 'unconfigured' }))
    const html = renderToStaticMarkup(<MessagesPopover onGovernance={() => {}} />)
    expect(html).toContain('未配置')
    expect(html).not.toMatch(/未读\s*\d/)
  })

  it('ready without events -> empty, not synthetic', () => {
    consoleDataBus.publish(state({ status: 'ready', events: [] }))
    const html = renderToStaticMarkup(<MessagesPopover onGovernance={() => {}} />)
    expect(html).toContain('暂无真实治理事件')
  })

  it('ready with real events -> lists them with loaded-range note', () => {
    consoleDataBus.publish(state({
      status: 'ready',
      events: [{ eventId: 'e1', sourceId: 's1', batchId: 'b1', type: 'rows_rejected', severity: 'warn',
        occurredAt: 't', receivedAt: 't', ruleVersion: 'v1', reasons: null, detail: 'd' }],
    }))
    const html = renderToStaticMarkup(<MessagesPopover onGovernance={() => {}} />)
    expect(html).toContain('拒绝')
    expect(html).toContain('当前已加载范围')
  })
})
