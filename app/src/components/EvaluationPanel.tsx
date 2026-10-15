import { useState } from 'react'
import {
  EVAL_MANIFEST,
  PLAN_VARIANT_LABEL,
  exportEvaluationJson,
  runSyntheticEvaluation,
  type EvaluationCase,
  type EvaluationResult,
} from '../domain/evaluation'

type Status = 'idle' | 'done' | 'error'

function downloadText(name: string, content: string, mime: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    throw new Error('当前环境不支持浏览器下载')
  }
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

function metricText(value: number | null, suffix = ''): string {
  return value === null ? 'null' : `${value}${suffix}`
}

export default function EvaluationPanel() {
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState<EvaluationResult | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const run = () => {
    try {
      const next = runSyntheticEvaluation()
      setResult(next)
      setStatus('done')
      setFeedback(
        `已完成（同步计算 ${next.cases.length} 例）：开发配对 ${next.aggregates[0].pairedCases}/${next.aggregates[0].totalCases}，留出配对 ${next.aggregates[1].pairedCases}/${next.aggregates[1].totalCases}。`,
      )
      setDownloadError(null)
    } catch (error) {
      setStatus('error')
      setResult(null)
      setFeedback(error instanceof Error ? error.message : '评测运行失败')
    }
  }

  const download = () => {
    if (!result) return
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const name = `qiheng-evaluation-${stamp}.json`
    try {
      downloadText(name, exportEvaluationJson(result), 'application/json')
      setDownloadError(null)
      setFeedback(`已生成文件 ${name}（${result.cases.length} 例，含全部失败例与 null 指标）。`)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : '未知错误')
    }
  }

  return (
    <section className="panel eval-panel">
      <div className="panel-head">
        <h2>同条件合成评测</h2>
        <span className="tag warn">合成 · 不发布 · 不影响当前场景与审批</span>
      </div>

      <div className="eval-actions">
        <button type="button" className="btn primary eval-run" onClick={run}>
          运行评测（同步 {EVAL_MANIFEST.computeBudget.cases} 例）
        </button>
        <button
          type="button"
          className="btn"
          onClick={download}
          disabled={!result}
        >
          下载评测 JSON
        </button>
        <span className="hint">
          开发 {EVAL_MANIFEST.devSeeds.length} seed / 留出 {EVAL_MANIFEST.holdoutSeeds.length} seed × 3 场景
        </span>
      </div>

      {feedback ? (
        <p
          className={status === 'error' ? 'neg' : 'ok-text'}
          role="status"
          aria-live="polite"
        >
          {feedback}
        </p>
      ) : (
        <p className="hint">
          尚未运行。评测只读取平台自有合成数据，固定 manifest 种子；旧规则基线仅作历史对照，不参与配对收益。
        </p>
      )}
      {downloadError ? (
        <p className="neg" role="status">
          下载失败：{downloadError}
        </p>
      ) : null}

      {result ? (
        <details className="eval-details">
          <summary>展开评测结果（成功与失败全部保留）</summary>

          <table className="period-table eval-table">
            <caption>分开发 / 留出汇总（配对差值只在双方均通过独立复验的样本上计算）</caption>
            <thead>
              <tr>
                <th>分组</th>
                <th>总例数</th>
                <th>合法配对数</th>
                <th>保守基线可执行</th>
                <th>建议可执行</th>
                <th>平均估算耗电差 kWh</th>
                <th>平均切换差</th>
              </tr>
            </thead>
            <tbody>
              {result.aggregates.map((a) => (
                <tr key={a.split}>
                  <td>{a.split === 'dev' ? '开发' : '留出'}</td>
                  <td>{a.totalCases}</td>
                  <td>
                    {a.pairedCases} / {a.totalCases}
                  </td>
                  <td>
                    {a.conservativeVerifiedCases} / {a.totalCases}
                  </td>
                  <td>
                    {a.recommendationVerifiedCases} / {a.totalCases}
                  </td>
                  <td>{metricText(a.meanEnergyDeltaKwh)}</td>
                  <td>{metricText(a.meanSwitchDelta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            耗电差 = 建议 − 保守基线（负值表示建议估算耗电更低）；{PLAN_VARIANT_LABEL.legacy}不参与该差值。
          </p>

          <div className="table-wrap short">
            <table className="period-table eval-table">
              <caption>逐例明细（not_found 指标为 null，不填 0）</caption>
              <thead>
                <tr>
                  <th>用例</th>
                  <th>场景</th>
                  <th>seed</th>
                  <th>旧基线违规</th>
                  <th>保守基线</th>
                  <th>保守违规</th>
                  <th>建议</th>
                  <th>建议违规</th>
                  <th>建议翻转(开/停)</th>
                  <th>配对</th>
                  <th>耗电差 kWh</th>
                </tr>
              </thead>
              <tbody>
                {result.cases.map((c: EvaluationCase) => (
                  <tr key={c.id}>
                    <td className="mono">{c.id}</td>
                    <td>{c.scenarioLabel}</td>
                    <td className="mono">{c.seed}</td>
                    <td>{metricText(c.legacyBaseline.metrics.violationCount)}</td>
                    <td>{c.conservativeBaseline.metrics.status}</td>
                    <td>{metricText(c.conservativeBaseline.metrics.violationCount)}</td>
                    <td>{c.recommendation.metrics.status}</td>
                    <td>{metricText(c.recommendation.metrics.violationCount)}</td>
                    <td>{metricText(c.recommendation.metrics.unitStateFlips)}</td>
                    <td>{c.pair.eligible ? '计入' : '排除'}</td>
                    <td>{metricText(c.pair.energyDeltaKwh)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="hint">
            翻转口径 = 逐台机组开机/停机各计 1（不是“启动次数”），耗电降低可与状态翻转增加并存，
            逐机明细见下载 JSON 的 perUnitFlips；runtimeUnitMinutes 为机组·分钟（运行时长，非求解耗时）。
            求解耗时 timingsMs 为单次本机合成读数，易变，不参与确定性判定，也不外推为工业 SLA。
          </p>
          <p className="hint">
            失败例原因示例：{result.cases.find((c) => c.pair.reason.includes('无'))?.pair.reason ?? '—'}；
            留出集不可批准，评测不自动执行设备。
          </p>
        </details>
      ) : null}
    </section>
  )
}