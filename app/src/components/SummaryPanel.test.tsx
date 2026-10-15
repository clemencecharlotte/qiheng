import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import SummaryPanel from './SummaryPanel'
import { verifyPlanConstraints } from '../domain/constraints'
import { runScenario } from '../domain/engine'
import type { PlanResult } from '../domain/types'
import { FIXED_SEED, UNITS } from '../domain/units'

const normalRun = runScenario('normal', UNITS, FIXED_SEED)

function renderPlans(
  baseline: PlanResult = normalRun.baseline,
  recommendation: PlanResult = normalRun.recommendation,
  context = normalRun,
): string {
  return renderToString(
    <SummaryPanel baseline={baseline} recommendation={recommendation} context={context} />,
  )
}

function comparisonCell(html: string, metric: string, plan: 'baseline' | 'recommendation'): string {
  const row = html.match(/<tr>[\s\S]*?<\/tr>/g)?.find((entry) =>
    entry.includes(`<th scope="row">${metric}`),
  )
  expect(row, `缺少比较行：${metric}`).toBeDefined()
  const cell = row?.match(new RegExp(`<td data-comparison-plan="${plan}">([\\s\\S]*?)<\\/td>`))
  expect(cell, `缺少比较单元格：${metric}/${plan}`).not.toBeNull()
  return cell![1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

describe('SummaryPanel 同窗口摘要矩阵（SSR 窄验）', () => {
  it('按比较项对齐两方案，标明估算与独立复验，不新增节能率', () => {
    const html = renderPlans()
    expect(html).toContain('<table class="summary-panel__table">')
    expect(html).toContain('<th scope="col">基线（规则）</th>')
    expect(html).toContain('<th scope="col">建议（优化）</th>')
    expect(comparisonCell(html, '覆盖时段', 'baseline')).toBe('96 / 96')
    expect(comparisonCell(html, '覆盖时段', 'recommendation')).toBe('96 / 96')
    expect(comparisonCell(html, '估算耗电量', 'baseline')).toBe(normalRun.baseline.totalEnergyKwh.toFixed(1))
    expect(comparisonCell(html, '切换次数', 'recommendation')).toBe(`${normalRun.recommendation.totalSwitches} 次`)
    expect(comparisonCell(html, '约束状态', 'baseline')).toContain('约束未通过 · 仅作对照')
    expect(comparisonCell(html, '约束状态', 'recommendation')).toContain('可行 · 约束复验通过')
    expect(html).toContain('kWh（估算）')
    expect(html).toContain('非实测能耗')
    expect(html).toContain('非覆盖时段数')
    expect(html).toContain('— 表示无可用指标，不按零值比较。')
    expect(html).not.toContain('节能率')
    expect(html).not.toContain('plan-card')
  })

  it('分母取输入窗口，不固定为 96 个时段', () => {
    const context = { ...normalRun, series: { ...normalRun.series, points: normalRun.series.points.slice(0, 4) } }
    const baseline = { ...normalRun.baseline, periods: normalRun.baseline.periods.slice(0, 4) }
    const recommendation = { ...normalRun.recommendation, periods: normalRun.recommendation.periods.slice(0, 4) }
    const html = renderPlans(baseline, recommendation, context)
    expect(comparisonCell(html, '覆盖时段', 'baseline')).toBe('4 / 4')
    expect(comparisonCell(html, '覆盖时段', 'recommendation')).toBe('4 / 4')
    expect(html).not.toContain('/ 96')
  })

  it('违规项数取独立复验，不信任方案自报数值', () => {
    const baseline = { ...normalRun.baseline, violationCount: 999 }
    const recommendation = { ...normalRun.recommendation, violationCount: 888 }
    const html = renderPlans(baseline, recommendation)
    const verified = verifyPlanConstraints(baseline, normalRun)
    expect(verified.violationCount).toBeGreaterThan(0)
    expect(comparisonCell(html, '约束状态', 'baseline')).toContain(`独立复验 ${verified.violationCount} 项违规`)
    expect(comparisonCell(html, '约束状态', 'recommendation')).toContain('独立复验 0 项违规')
    expect(html).not.toContain('999')
    expect(html).not.toContain('888')
  })

  it('自报可行但缺桶的方案不得显示复验通过', () => {
    const recommendation = { ...normalRun.recommendation, periods: normalRun.recommendation.periods.slice(0, -1) }
    const html = renderPlans(normalRun.baseline, recommendation)
    expect(comparisonCell(html, '覆盖时段', 'recommendation')).toBe('95 / 96')
    expect(comparisonCell(html, '约束状态', 'recommendation')).toContain('约束未通过')
    expect(comparisonCell(html, '约束状态', 'recommendation')).not.toContain('约束复验通过')
    expect(html).toContain('不得批准')
  })

  it('不可行建议保留原因、默认收起说明，不将无解包装成零耗电或零违规', () => {
    const run = runScenario('surge', UNITS, FIXED_SEED)
    const html = renderPlans(run.baseline, run.recommendation, run)
    expect(comparisonCell(html, '覆盖时段', 'recommendation')).toBe('未生成')
    expect(comparisonCell(html, '估算耗电量', 'recommendation')).toBe('—')
    expect(comparisonCell(html, '切换次数', 'recommendation')).toBe('—')
    expect(comparisonCell(html, '约束状态', 'recommendation')).toBe('无可行建议')
    expect(html).toContain('<details class="summary-panel__details">')
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/)
    expect(html).toContain('<summary>复验说明与不可行原因</summary>')
    expect(html).toContain('不输出自动启停建议')
    expect(html).toContain(run.recommendation.infeasibleReasons[0])
  })

  it('不可行方案没有具体原因时仍明确失败，不伪造复验零违规', () => {
    const baseline = { ...normalRun.baseline, feasible: false, infeasibleReasons: [] }
    const recommendation = { ...normalRun.recommendation, feasible: false, infeasibleReasons: [] }
    const html = renderPlans(baseline, recommendation)
    expect(comparisonCell(html, '约束状态', 'baseline')).toBe('约束未通过 · 仅作对照')
    expect(comparisonCell(html, '约束状态', 'recommendation')).toBe('无可行建议')
    expect(comparisonCell(html, '估算耗电量', 'recommendation')).toBe('—')
    expect(html).toContain('未提供具体原因；不可行状态不代表零违规或可以执行。')
    expect(html).not.toContain('项违规')
  })

  it('空计划与空输入不作为完整方案或零值指标', () => {
    const baseline = { ...normalRun.baseline, periods: [], totalEnergyKwh: 0, totalSwitches: 0 }
    const recommendation = { ...normalRun.recommendation, periods: [], totalEnergyKwh: 0, totalSwitches: 0 }
    const html = renderPlans(baseline, recommendation)
    for (const plan of ['baseline', 'recommendation'] as const) {
      expect(comparisonCell(html, '覆盖时段', plan)).toBe('未生成')
      expect(comparisonCell(html, '估算耗电量', plan)).toBe('—')
      expect(comparisonCell(html, '切换次数', plan)).toBe('—')
      expect(comparisonCell(html, '约束状态', plan)).not.toContain('复验通过')
    }
    expect(html).toContain('建议方案未覆盖输入窗口')

    const emptyContext = { ...normalRun, series: { ...normalRun.series, points: [] } }
    const emptyHtml = renderPlans(baseline, recommendation, emptyContext)
    expect(comparisonCell(emptyHtml, '覆盖时段', 'baseline')).toBe('—')
    expect(comparisonCell(emptyHtml, '覆盖时段', 'recommendation')).toBe('—')
    expect(emptyHtml).not.toContain('0 / 0')
  })

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    '空值/非有限/负数指标 %s 显示破折号而不抛错或参与比较',
    (invalid) => {
      const baseline = {
        ...normalRun.baseline,
        totalEnergyKwh: invalid as unknown as number,
        totalSwitches: invalid as unknown as number,
      }
      const recommendation = { ...normalRun.recommendation, totalEnergyKwh: baseline.totalEnergyKwh, totalSwitches: baseline.totalSwitches }
      const html = renderPlans(baseline, recommendation)
      for (const plan of ['baseline', 'recommendation'] as const) {
        expect(comparisonCell(html, '估算耗电量', plan)).toBe('—')
        expect(comparisonCell(html, '切换次数', plan)).toBe('—')
      }
    },
  )

  it('合法零值不被误当空值', () => {
    const recommendation = { ...normalRun.recommendation, totalEnergyKwh: 0, totalSwitches: 0 }
    const html = renderPlans(normalRun.baseline, recommendation)
    expect(comparisonCell(html, '估算耗电量', 'recommendation')).toBe('0.0')
    expect(comparisonCell(html, '切换次数', 'recommendation')).toBe('0 次')
  })
})
