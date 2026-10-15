import {
  verifyPlanConstraints,
  type ConstraintVerification,
  type VerifyContext,
} from '../domain/constraints'
import type { PlanResult } from '../domain/types'
import './SummaryPanel.css'

interface Props {
  baseline: PlanResult
  recommendation: PlanResult
  context: VerifyContext
}

function planLabel(plan: PlanResult): string {
  return plan.planType === 'baseline' ? '基线（规则）' : '建议（优化）'
}

interface Verdict {
  label: string
  tone: 'ok' | 'warn' | 'bad'
  note: string
}

function baselineVerdict(plan: PlanResult, v: ConstraintVerification): Verdict {
  const passed = plan.feasible && v.passed
  return {
    label: passed ? '约束复验通过' : '约束未通过 · 仅作对照',
    tone: passed ? 'ok' : 'warn',
    note: passed
      ? '基线对照方案通过独立硬约束复验。'
      : !plan.feasible || plan.periods.length === 0
        ? '基线未形成完整可行方案；覆盖时段不代表约束可行，基线仅作对照。'
        : `独立硬约束复验未通过 ${v.violationCount} 项；覆盖时段不代表约束可行，基线仅作对照。`,
  }
}

function recommendationVerdict(plan: PlanResult, v: ConstraintVerification): Verdict {
  if (!plan.feasible) {
    return {
      label: '无可行建议',
      tone: 'bad',
      note: '存在无满足全部硬约束的时段，不输出自动启停建议。',
    }
  }
  return {
    label: v.passed ? '可行 · 约束复验通过' : '约束未通过',
    tone: v.passed ? 'ok' : 'bad',
    note: v.passed
      ? '建议方案经独立硬约束复验通过。'
      : plan.periods.length === 0
        ? '建议方案未覆盖输入窗口，独立复验未通过，不得批准。'
        : `建议方案独立复验发现 ${v.violationCount} 项违规，不得批准。`,
  }
}

function hasMetrics(plan: PlanResult): boolean {
  return plan.periods.length > 0 && (plan.planType === 'baseline' || plan.feasible)
}

function finiteMetric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function coverageText(plan: PlanResult, total: number): string {
  if (total === 0) return '—'
  return plan.periods.length > 0 ? `${plan.periods.length} / ${total}` : '未生成'
}

function energyText(plan: PlanResult): string {
  return hasMetrics(plan) && finiteMetric(plan.totalEnergyKwh)
    ? plan.totalEnergyKwh.toFixed(1)
    : '—'
}

function switchesText(plan: PlanResult): string {
  return hasMetrics(plan) && finiteMetric(plan.totalSwitches)
    ? `${plan.totalSwitches} 次`
    : '—'
}

function ConstraintStatus({
  plan,
  verification,
  verdict,
}: {
  plan: PlanResult
  verification: ConstraintVerification
  verdict: Verdict
}) {
  return (
    <div className="summary-panel__constraint">
      <span className={`summary-panel__verdict summary-panel__verdict--${verdict.tone}`}>
        {verdict.label}
      </span>
      {plan.feasible && plan.periods.length > 0 ? (
        <span className="summary-panel__constraint-count">
          独立复验 {verification.violationCount} 项违规
        </span>
      ) : null}
    </div>
  )
}

function PlanExplanation({ plan, verdict }: { plan: PlanResult; verdict: Verdict }) {
  return (
    <div className="summary-panel__explanation">
      <h3>{planLabel(plan)} · 复验说明</h3>
      <p>{verdict.note}</p>
      {!plan.feasible ? (
        <>
          <h4>不可行原因</h4>
          {plan.infeasibleReasons.length > 0 ? (
            <ul>
              {plan.infeasibleReasons.map((reason, index) => (
                <li key={`${index}:${reason}`}>{reason}</li>
              ))}
            </ul>
          ) : (
            <p>未提供具体原因；不可行状态不代表零违规或可以执行。</p>
          )}
        </>
      ) : null}
    </div>
  )
}

export default function SummaryPanel({ baseline, recommendation, context }: Props) {
  const baselineVerification = verifyPlanConstraints(baseline, context)
  const recommendationVerification = verifyPlanConstraints(recommendation, context)
  const baselineStatus = baselineVerdict(baseline, baselineVerification)
  const recommendationStatus = recommendationVerdict(recommendation, recommendationVerification)
  const coverageTotal = context.series.points.length

  return (
    <section className="panel summary-panel">
      <header className="summary-panel__head">
        <h2>基线与建议对比</h2>
        <p className="summary-panel__scope">
          同一输入窗口 · {coverageTotal} 个时段
          {finiteMetric(context.series.stepMinutes) && context.series.stepMinutes > 0
            ? ` · 每时段 ${context.series.stepMinutes} 分钟`
            : ''}
        </p>
      </header>

      <div className="summary-panel__metrics">
        <div className="summary-metric">
          <span className="k">覆盖时段 · 基线</span>
          <span className="v">{coverageText(baseline, coverageTotal)}<small>/ {coverageTotal}</small></span>
        </div>
        <div className="summary-metric">
          <span className="k">覆盖时段 · 建议</span>
          <span className="v">{coverageText(recommendation, coverageTotal)}<small>/ {coverageTotal}</small></span>
        </div>
        <div className="summary-metric">
          <span className="k">估算耗电 · 建议</span>
          <span className="v">{energyText(recommendation)}<small>kWh</small></span>
        </div>
        <div className="summary-metric">
          <span className="k">独立复验 · 建议</span>
          <span className="v" style={{ fontSize: 14, lineHeight: '28px' }}>{recommendationStatus.label}</span>
        </div>
      </div>
      <a className="fn-ref" href="#app-notes" aria-label="口径注 2·3：非生产实测；模型推算">2·3</a>
      <table className="summary-panel__table">
        <caption className="summary-panel__sr-only">
          基线与建议在同一输入窗口的覆盖时段、估算耗电、切换次数与独立约束复验结果
        </caption>
        <colgroup>
          <col className="summary-panel__metric-column" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">比较项</th>
            <th scope="col">{planLabel(baseline)}</th>
            <th scope="col">{planLabel(recommendation)}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">覆盖时段</th>
            <td data-comparison-plan="baseline"><strong>{coverageText(baseline, coverageTotal)}</strong></td>
            <td data-comparison-plan="recommendation"><strong>{coverageText(recommendation, coverageTotal)}</strong></td>
          </tr>
          <tr>
            <th scope="row">估算耗电量<span className="summary-panel__unit">kWh（估算）</span></th>
            <td data-comparison-plan="baseline"><strong>{energyText(baseline)}</strong></td>
            <td data-comparison-plan="recommendation"><strong>{energyText(recommendation)}</strong></td>
          </tr>
          <tr>
            <th scope="row">切换次数</th>
            <td data-comparison-plan="baseline"><strong>{switchesText(baseline)}</strong></td>
            <td data-comparison-plan="recommendation"><strong>{switchesText(recommendation)}</strong></td>
          </tr>
          <tr>
            <th scope="row">约束状态</th>
            <td data-comparison-plan="baseline">
              <ConstraintStatus plan={baseline} verification={baselineVerification} verdict={baselineStatus} />
            </td>
            <td data-comparison-plan="recommendation">
              <ConstraintStatus plan={recommendation} verification={recommendationVerification} verdict={recommendationStatus} />
            </td>
          </tr>
        </tbody>
      </table>

      <p className="summary-panel__note">
        可行状态来自独立硬约束复验，非覆盖时段数；估算耗电为模型推算，非实测能耗。
        — 表示无可用指标，不按零值比较。
      </p>
      <details className="summary-panel__details">
        <summary>复验说明与不可行原因</summary>
        <div className="summary-panel__explanations">
          <PlanExplanation plan={baseline} verdict={baselineStatus} />
          <PlanExplanation plan={recommendation} verdict={recommendationStatus} />
        </div>
      </details>
    </section>
  )
}
