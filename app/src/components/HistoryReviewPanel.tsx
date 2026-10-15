import type { HistoryReviewResult } from '../domain/chain'

const STATUS_LABEL: Record<HistoryReviewResult['status'], string> = {
  trusted: '全部通过（只读回看）',
  review: '部分待复核（统计需谨慎）',
  blocked: '存在无效桶（本回放统计被禁用）',
}

const STATUS_CLASS: Record<HistoryReviewResult['status'], string> = {
  trusted: 'ok',
  review: 'warn',
  blocked: 'bad',
}

interface Props {
  review: HistoryReviewResult
  fixtureLabel: string
}

export default function HistoryReviewPanel({ review, fixtureLabel }: Props) {
  return (
    <section className="panel" data-evidence="history-verdict" tabIndex={-1}>
      <div className="panel-head">
        <h2>回放安全核查</h2>
        <span className={`tag ${STATUS_CLASS[review.status]}`}>
          {STATUS_LABEL[review.status]}
        </span>
      </div>
      {/* r40 ④·5：非必要常驻边界说明收进用户主动开启的披露（内容仍在 DOM，
          render.test 的「合成回放夹具」文案合同不受影响；风险禁用原因不在此列、保持常驻）。 */}
      <details className="qh-panel-note">
        <summary>回放口径与边界说明</summary>
        <p className="hint">
          「合成回放夹具 · {fixtureLabel}」是只读分钟数据；两台离心机
          C-01/C-02 不生成调度方案、不提供批准按钮。invalid 只禁用本回放数据的可信统计与自动动作，
          不影响任何合成调度场景的可行性或可否批准。
        </p>
      </details>
      <div className="checks-grid">
        <div className={`check-item ${review.counts.pass > 0 ? '' : 'fail'}`}>
          <span>质量通过桶</span>
          <strong className="ok-text">{review.counts.pass}</strong>
        </div>
        <div className={`check-item ${review.counts.review > 0 ? 'fail' : ''}`}>
          <span>待复核桶</span>
          <strong className={review.counts.review > 0 ? 'neg' : 'ok-text'}>
            {review.counts.review}
          </strong>
        </div>
        <div className={`check-item ${review.counts.invalid > 0 ? 'fail' : ''}`}>
          <span>无效桶</span>
          <strong className={review.counts.invalid > 0 ? 'neg' : 'ok-text'}>
            {review.counts.invalid}
          </strong>
        </div>
      </div>
      <div className="detail-grid">
        <div>
          <h4>回放侧依据</h4>
          <ul className="plain-list">
            {review.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>回放转人工动作</h4>
          <ul className="plain-list">
            {review.manualActions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="hint">
        可信完整桶能量 {review.energyIntegralTrustedKwh.toFixed(3)} kWh /
        观测部分积分 {review.observedPartialEnergyKwh.toFixed(3)} kWh（功率覆盖{' '}
        {review.observedCoveredMinutes}/{review.observedExpectedMinutes} 分钟）。
      </p>
    </section>
  )
}