import type { SafetyReview } from '../domain/chain'

interface Props {
  safety: SafetyReview
  scenarioLabel: string
}

const CHECK_LABELS: Record<keyof SafetyReview['checks'], string> = {
  recommendationFeasible: '建议可行',
  missingKeyParams: '关键参数完整',
  centrifugalExcluded: '离心机已排除出候选',
}

/**
 * 安全审查（独立复验）：只呈现检查项、拒因与转人工动作。
 * 批准 / 驳回的主动作与确认对话框在「决策详情」中统一处理。
 */
export default function SafetyReviewPanel({ safety, scenarioLabel }: Props) {
  const blocked = safety.verdict === 'reject'

  const checkEntries = Object.entries(safety.checks) as Array<
    [keyof SafetyReview['checks'], boolean]
  >
  const checkPassed = (
    key: keyof SafetyReview['checks'],
    value: boolean,
  ): boolean => {
    if (key === 'missingKeyParams') return !value
    return value
  }

  return (
    <section className="panel" data-evidence="safety-verdict" tabIndex={-1}>
      <div className="panel-head">
        <h2>安全审查（独立复验）</h2>
        <span className={`tag ${blocked ? 'bad' : 'ok'}`}>
          {blocked ? '拒绝批准' : '允许批准'}
        </span>
      </div>
      <p className="hint">
        只依据「合成调度来源 · {scenarioLabel}」自身的输入、硬约束与缺失参数判断；
        合成回放夹具的质量问题不参与本结论。批准 / 驳回的确认在上方「决策详情」中完成。
      </p>
      <div className="checks-grid">
        {checkEntries.map(([key, value]) => {
          const ok = checkPassed(key, value)
          return (
            <div className={`check-item ${ok ? '' : 'fail'}`} key={key}>
              <span>{CHECK_LABELS[key]}</span>
              <strong className={ok ? 'ok-text' : 'neg'}>
                {ok ? '通过' : '不通过'}
              </strong>
            </div>
          )
        })}
      </div>
      <div className="detail-grid">
        <div>
          <h4>具体拒因 / 依据</h4>
          <ul className="plain-list">
            {safety.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>转人工动作</h4>
          <ul className="plain-list">
            {safety.manualActions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      </div>

      </section>
  )
}