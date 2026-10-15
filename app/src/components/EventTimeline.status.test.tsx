import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import EventTimeline from './EventTimeline'
import type { TimelineEvent } from '../domain/events'

const ev = (id: string, status: string): TimelineEvent => ({
  id, time: '12:00', source: 'synthetic_history' as TimelineEvent['source'],
  category: 'data_quality', status, reason: 'r', title: 't', detail: 'd', evidenceRefs: [], locate: null, synthetic: true,
})

describe('M25 r13 C · EventTimeline 按真实 status 消费 StatusBadge（列表+详情）', () => {
  it('状态格用 StatusBadge 且按 status 颜色（拒绝 severe / 通过 normal / 未知 unknown）', () => {
    const html = renderToStaticMarkup(<EventTimeline events={[ev('e1', '质量通过'), ev('e2', '拒绝'), ev('e3', '未知')]} />)
    expect(html).toContain('u-status--normal')  // 通过
    expect(html).toContain('u-status--severe')  // 拒绝
    expect(html).toContain('u-status--unknown') // 未知（不绿）
    expect(html).toContain('tag muted')         // 类别为中性，不以类别色表状态
  })
})
