import { useState } from 'react'
import { resolveEvidenceId, type EvidenceContext, type EvidenceWorkspace } from '../domain/evidence'
import { summarizeQuality } from '../domain/quality'
import { planSummary, RULE_VERSION, type AuditEvent } from '../domain/audit'
import { DATA_SOURCES } from '../domain/sources'

type RoleViewId = 'operator' | 'engineer' | 'auditor'

const ROLE_VIEWS: Array<{ id: RoleViewId; label: string; caption: string }> = [
  { id: 'operator', label: '操作视图', caption: '结论 · 关键数字 · 下一步' },
  { id: 'engineer', label: '技术视图', caption: '约束 · 质量 · 规则异常' },
  { id: 'auditor', label: '审计视图', caption: '来源 · 规则版本 · 证据 ID' },
]

interface Props {
  ctx: EvidenceContext
  auditEvents: AuditEvent[]
  onJump: (workspace: EvidenceWorkspace, target: string) => void
}

function EvidenceChip({
  ctx,
  id,
  onJump,
}: {
  ctx: EvidenceContext
  id: string
  onJump: Props['onJump']
}) {
  const ref = resolveEvidenceId(ctx, id)
  if (!ref) {
    return <span className="chip mono">{id}（无效引用）</span>
  }
  return (
    <button
      type="button"
      className="evidence-link chip-btn"
      onClick={() => onJump(ref.anchor.workspace, ref.anchor.target)}
    >
      <span className="mono">{id}</span>
      <span>{ref.label}</span>
    </button>
  )
}

export default function RoleViews({ ctx, auditEvents, onJump }: Props) {
  const [view, setView] = useState<RoleViewId>('operator')
  const { run, scheduleChain, historyReview, quality, health, scenarioLabel } = ctx
  const summary = summarizeQuality(quality)
  const dispatcher = scheduleChain.roles.find((r) => r.id === 'dispatcher')
  const duty = scheduleChain.roles.find((r) => r.id === 'duty_engineer')
  const invalidBuckets = quality.filter((b) => b.grade === 'invalid').slice(0, 4)
  const reviewBuckets = quality.filter((b) => b.grade === 'review').slice(0, 4)

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>多角色视图（同一计算结果 · 同一证据 ID）</h2>
        <span className="hint">切换角色只改变呈现，不改变底层结论或证据</span>
      </div>

      <div className="role-tabs" role="tablist" aria-label="角色视图">
        {ROLE_VIEWS.map((v) => (
          <button
            type="button"
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            className={`role-tab${view === v.id ? ' active' : ''}`}
            onClick={() => setView(v.id)}
          >
            <span className="role-tab-label">{v.label}</span>
            <span className="role-tab-caption">{v.caption}</span>
          </button>
        ))}
      </div>

      {view === 'operator' ? (
        <div className="role-panel">
          <div className="metric-row">
            <span>调度安全审查（合成调度来源）</span>
            <strong className={scheduleChain.safety.verdict === 'reject' ? 'neg' : 'ok-text'}>
              {scheduleChain.safety.verdict === 'reject' ? '拒绝批准（阻断）' : '允许批准'}
            </strong>
          </div>
          <div className="metric-row">
            <span>回放核查（合成回放来源，只读）</span>
            <strong className={historyReview.status === 'blocked' ? 'neg' : 'ok-text'}>
              {historyReview.status === 'blocked'
                ? '本回放统计被禁用'
                : historyReview.status === 'review'
                  ? '部分待复核'
                  : '全部通过'}
            </strong>
          </div>
          <div className="metric-row">
            <span>基线（同条件）</span>
            <strong>{planSummary(run.baseline)}</strong>
          </div>
          <div className="metric-row">
            <span>建议</span>
            <strong>{planSummary(run.recommendation)}</strong>
          </div>
          <div className="metric-row">
            <span>候选机组</span>
            <strong>{run.evaluation.candidates.map((u) => u.id).join('、') || '无'}</strong>
          </div>
          <div className="role-section">
            <span className="qa-label">建议下一步（值班员）</span>
            <ul className="plain-list">
              {(duty?.actions ?? dispatcher?.actions ?? []).map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
          <div className="chip-list">
            <EvidenceChip ctx={ctx} id="safety-verdict" onJump={onJump} />
            <EvidenceChip ctx={ctx} id="history-verdict" onJump={onJump} />
            <EvidenceChip ctx={ctx} id="role:dispatcher" onJump={onJump} />
            <EvidenceChip ctx={ctx} id="role:duty_engineer" onJump={onJump} />
          </div>
        </div>
      ) : null}

      {view === 'engineer' ? (
        <div className="role-panel">
          <div className="role-section">
            <span className="qa-label">硬约束与无解原因</span>
            <ul className="plain-list">
              {run.recommendation.feasible ? (
                <li>建议通过供气能力、最小稳定负载、最小启停间隔与关键参数完整性复验。</li>
              ) : (
                run.recommendation.infeasibleReasons.map((r) => <li key={r}>{r}</li>)
              )}
              {run.evaluation.eligibility
                .filter((e) => e.missingFields.length > 0)
                .map((e) => (
                  <li key={e.unitId}>
                    {e.unitId} 缺失关键参数：{e.missingFields.join('、')}
                  </li>
                ))}
            </ul>
          </div>
          <div className="role-section">
            <span className="qa-label">数据质量（合成夹具）</span>
            <p className="hint">
              通过 {summary.pass} / 待复核 {summary.review} / 无效 {summary.invalid}；不可信桶不并入合格率/节能统计。
            </p>
            <div className="chip-list">
              {[...invalidBuckets, ...reviewBuckets].map((b) => (
                <EvidenceChip
                  ctx={ctx}
                  id={`quality:${b.machineId}:${b.bucketIndex}`}
                  key={`${b.machineId}-${b.bucketIndex}`}
                  onJump={onJump}
                />
              ))}
              {invalidBuckets.length === 0 && reviewBuckets.length === 0 ? (
                <span className="hint">当前无 review / invalid 桶。</span>
              ) : null}
            </div>
          </div>
          <div className="role-section">
            <span className="qa-label">规则异常提示（非故障预测）</span>
            <div className="chip-list">
              {health.length === 0 ? (
                <span className="hint">未触发演示阈值内的规则异常提示。</span>
              ) : (
                health.map((f) => (
                  <EvidenceChip ctx={ctx} id={`health:${f.id}`} key={f.id} onJump={onJump} />
                ))
              )}
            </div>
          </div>
          <div className="role-section">
            <span className="qa-label">未核实边界</span>
            <ul className="plain-list unknown">
              <li>官方离心机喘振与启停边界未核实，AC-03 与回放 C-01/C-02 均不进调度候选。</li>
              <li>估算耗电为模型推算，非现场实测。</li>
            </ul>
          </div>
        </div>
      ) : null}

      {view === 'auditor' ? (
        <div className="role-panel">
          <div className="metric-row">
            <span>规则版本</span>
            <strong className="mono">{RULE_VERSION}</strong>
          </div>
          <div className="metric-row">
            <span>当前场景</span>
            <strong>{scenarioLabel}</strong>
          </div>
          <div className="metric-row">
            <span>数据来源</span>
            <strong>
              {DATA_SOURCES.synthetic_schedule.label} / {DATA_SOURCES.synthetic_history.label}
            </strong>
          </div>
          <div className="metric-row">
            <span>可信完整桶能量（仅合格且功率齐全桶）</span>
            <strong className="mono">{summary.energyIntegralTrustedKwh.toFixed(3)} kWh</strong>
          </div>
          <div className="metric-row">
            <span>观测部分积分（非完整桶能量）</span>
            <strong className="mono">
              {summary.observedPartialEnergyKwh.toFixed(3)} kWh
              <span className="hint">
                {' '}
                功率覆盖 {summary.observedCoveredMinutes}/{summary.observedExpectedMinutes} 分钟
              </span>
            </strong>
          </div>
          <div className="metric-row">
            <span>本轮审计事件</span>
            <strong className="mono">{auditEvents.length} 条</strong>
          </div>
          <div className="metric-row">
            <span>回放来源核查</span>
            <strong>
              {historyReview.status === 'blocked'
                ? '无效桶：本回放统计被禁用'
                : historyReview.status === 'review'
                  ? '部分待复核'
                  : '全部通过'}
            </strong>
          </div>
          <div className="role-section">
            <span className="qa-label">关键证据 ID</span>
            <div className="chip-list">
              <EvidenceChip ctx={ctx} id="safety-verdict" onJump={onJump} />
              <EvidenceChip ctx={ctx} id="role:safety_reviewer" onJump={onJump} />
              <EvidenceChip ctx={ctx} id="history-verdict" onJump={onJump} />
              <EvidenceChip ctx={ctx} id="role:data_quality" onJump={onJump} />
              {invalidBuckets.map((b) => (
                <EvidenceChip
                  ctx={ctx}
                  id={`quality:${b.machineId}:${b.bucketIndex}`}
                  key={`a-${b.machineId}-${b.bucketIndex}`}
                  onJump={onJump}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}