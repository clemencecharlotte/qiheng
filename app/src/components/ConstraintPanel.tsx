import { verifyPlanConstraints, type VerifyContext } from '../domain/constraints'
import StatusBadge from './console/StatusBadge'
import type { PlanResult, ViolationType } from '../domain/types'

interface Props {
  baseline: PlanResult
  recommendation: PlanResult
  context: VerifyContext
}

const TYPE_LABEL: Record<ViolationType, string> = {
  supply_shortage: '供气不足',
  min_load: '最小稳定负载',
  start_stop_interval: '最小启停间隔',
  missing_params: '关键参数缺失',
  plan_completeness: '计划完整性',
  unknown_unit: '未知/重复机组',
  ineligible_unit: '不合格机组',
  invalid_load: '非法负载',
  load_mismatch: '负载/供气不符',
}

/** 计数直接取独立复验器结果，确保新增原因不会在 UI 遗漏。 */
function countByType(
  verified: ReturnType<typeof verifyPlanConstraints>,
): Record<ViolationType, number> {
  return verified.byType
}

export default function ConstraintPanel({ baseline, recommendation, context }: Props) {
  const baseVerified = verifyPlanConstraints(baseline, context)
  const recVerified = verifyPlanConstraints(recommendation, context)
  const baseCounts = countByType(baseVerified)
  const recCounts = countByType(recVerified)
  const types = Object.keys(TYPE_LABEL) as ViolationType[]

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>硬约束检查结果</h2>
        <span className="hint">
          独立逐时段复验（对照真实序列、共享初态、候选资格与场景故障）：计划完整性 / 供气能力 / 最小稳定负载 / 最小启停间隔 / 机组资格与负载一致性
        </span>
      </div>
      <div className="constraint-grid">
        <div className="constraint-col">
          <h3>基线</h3>
          <StatusBadge
            tone={baseVerified.passed ? 'normal' : 'severe'}
            label={`独立复验：${baseVerified.passed ? '通过' : `未通过（${baseVerified.violationCount} 项）`} · 仅作对照`}
          />
          {types.map((t) => (
            <div className="constraint-row" key={t}>
              <span>{TYPE_LABEL[t]}</span>
              <strong className={baseCounts[t] ? 'neg' : 'ok-text'}>
                {baseCounts[t] ?? 0} 项
              </strong>
            </div>
          ))}
        </div>
        <div className="constraint-col">
          <h3>建议</h3>
          {recommendation.feasible ? (
            <>
              <StatusBadge
                tone={recVerified.passed ? 'normal' : 'severe'}
                label={`独立复验：${recVerified.passed ? '通过' : `未通过（${recVerified.violationCount} 项）`}`}
              />
              {types.map((t) => (
                <div className="constraint-row" key={t}>
                  <span>{TYPE_LABEL[t]}</span>
                  <strong className={recCounts[t] ? 'neg' : 'ok-text'}>
                    {recCounts[t] ?? 0} 项
                  </strong>
                </div>
              ))}
            </>
          ) : (
            <p className="neg">
              无满足全部硬约束的可行方案，不输出自动启停建议（详见对比面板原因）。
            </p>
          )}
        </div>
      </div>
      {baseline.exclusionNotes.length > 0 ? (
        <div className="exclusion-notes">
          <h3>机组排除说明</h3>
          <ul className="reason-list">
            {baseline.exclusionNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}