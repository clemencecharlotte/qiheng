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
  it('首桶保留16槽、限制柱宽，单点不画伪连线', () => {
    const html = renderToStaticMarkup(<HistoryTrend unit="kWh" metricLabel="能量" api={{ ...api, effectiveIndex: 0 } as ObservationClockApi}
      points={Array.from({ length: 32 }, (_, i) => ({ label: `${i}:00`, value: 80 + i, grade: 'pass' as const }))} />)
    expect(html).toContain('1/16')
    expect(html).not.toContain('class="trend-curve"')
    expect(html).toContain('<circle')
    const bar = html.match(/<rect[^>]*width="([\d.]+)"[^>]*fill="var\(--success\)"/)
    expect(bar).not.toBeNull()
    expect(Number(bar![1])).toBeLessThanOrEqual(28)
    expect(html).not.toContain('1:00：')
  })
  it('数据集不足16时只分配真实槽位，null不跨接', () => {
    const html = renderToStaticMarkup(<HistoryTrend unit="kWh" metricLabel="能量" api={{ ...api, effectiveIndex: 2 } as ObservationClockApi}
      points={[{ label: '00:00', value: 2, grade: 'pass' }, { label: '00:15', value: null, grade: 'invalid' }, { label: '00:30', value: 4, grade: 'pass' }]} />)
    expect(html).toContain('3/3')
    expect(html).not.toContain('class="trend-curve"')
  })
})
