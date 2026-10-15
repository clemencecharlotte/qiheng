import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import HistoryTrend from './HistoryTrend'
import type { ObservationClockApi } from './useObservationClock'

const api = {
  effectiveIndex: 1, hoverIndex: null, range: null, state: { brushStart: null },
  hover: () => {}, lockIndex: () => {}, beginBrush: () => {}, moveBrush: () => {}, endBrush: () => {}, cancelBrush: () => {},
} as unknown as ObservationClockApi

describe('M23 B r07 · HistoryTrend 对象/单位分离 + 手机同快照', () => {
  it('对象标签旁置，数值单位取 valueUnit(kWh)，对象名不出现在数值单位', () => {
    const html = renderToStaticMarkup(
      <HistoryTrend unit="kWh" objectLabel="STATION" metricLabel="每桶完整功率积分" api={api}
        points={[{ label: '08:15', value: 86.1, grade: 'pass', coverage: '96/96' },
                 { label: '08:30', value: null, grade: 'invalid' }]} />,
    )
    expect(html).toContain('kWh')            // 数值单位
    expect(html).not.toContain('kWh STATION')
    expect(html).toContain('STATION')         // 对象名旁置可见
    expect(html).toContain('data-testid="trend-obsbar"')
    expect(html).toContain('前一桶'); expect(html).toContain('后一桶'); expect(html).toContain('取消探查')
  })
  it('缺值呈现「未观测（不补 0）」', () => {
    const html = renderToStaticMarkup(
      <HistoryTrend unit="kWh" metricLabel="每桶完整功率积分" api={{ ...api, effectiveIndex: 1 } as ObservationClockApi}
        points={[{ label: '00:00', value: 1, grade: 'pass' }, { label: '00:15', value: null, grade: 'invalid' }]} />)
    expect(html).toContain('未观测（不补 0）')
  })
  it('空数据显式空态且前后禁用', () => {
    const html = renderToStaticMarkup(<HistoryTrend unit="kWh" metricLabel="x" api={api} points={[]} />)
    expect(html).toContain('暂无数据')
    expect(html).toContain('disabled=""')
  })
})
