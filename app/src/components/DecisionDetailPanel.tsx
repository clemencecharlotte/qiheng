import { useEffect, useRef, useState } from 'react'
import type { DecisionChainResult } from '../domain/chain'
import type { ConstraintVerification } from '../domain/constraints'
import type { ScenarioRun } from '../domain/engine'
import { RULE_VERSION } from '../domain/audit'
import type { EffectiveDecision } from '../domain/approval'
import type { LabRun } from '../domain/lab'
import type { DecisionOutcome, ScenarioId } from '../domain/types'

const VIOLATION_LABEL: Record<
  keyof ConstraintVerification['byType'],
  string
> = {
  supply_shortage: '供气不足',
  min_load: '低于最小稳定负载',
  start_stop_interval: '启停间隔不足',
  missing_params: '关键参数缺失',
  plan_completeness: '计划完整性',
  unknown_unit: '未知/重复机组',
  ineligible_unit: '不合格机组',
  invalid_load: '非法负载',
  load_mismatch: '负载/供气不符',
}

interface Props {
  scenario: ScenarioId
  scenarioLabel: string
  run: ScenarioRun
  scheduleChain: DecisionChainResult
  verification: ConstraintVerification
  baselineVerification: ConstraintVerification
  approval: EffectiveDecision
  /** 完整 run 身份：身份改变即清空未提交的处置输入并关闭确认。 */
  runIdentity: string
  /** 提交时必须回传“打开确认时”的快照身份，供 App 做提交端核验。 */
  onSubmit: (
    action: 'approve' | 'reject',
    reason: string,
    expectedRunIdentity: string,
  ) => DecisionOutcome
  /** 受控会话理由草稿（仅本会话内存）：提供时不再用组件本地 state。 */
  draft?: string
  onDraftChange?: (value: string) => void
}

export default function DecisionDetailPanel({
  scenario: _scenario,
  scenarioLabel,
  run,
  scheduleChain,
  verification,
  baselineVerification,
  approval,
  runIdentity,
  onSubmit,
  draft,
  onDraftChange,
}: Props) {
  const currentDecision =
    approval.status === 'effective' ? approval.decision : null
  const currentAuditId = approval.auditEvent?.id ?? null
  const historicalDecision =
    approval.status !== 'effective' ? approval.decision : null
  const lab = (run as LabRun).lab
  const identitySummary = lab
    ? `${lab.fixtureLabel} · ${lab.preference === 'energy_first' ? '能量优先' : '切换优先'} · ${lab.fingerprint}`
    : `旧版示例 · ${run.series.scenarioLabel} · seed=${run.series.seed}`
  // 受控草稿：提供 draft 时由 App 持有（仅本会话）；否则退回本地 state。
  const [localReason, setLocalReason] = useState('')
  const reason = draft !== undefined ? draft : localReason
  const setReason = (value: string) => {
    if (onDraftChange) onDraftChange(value)
    else setLocalReason(value)
  }
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null)
  const [outcome, setOutcome] = useState<DecisionOutcome | null>(null)
  // 打开确认时捕获的完整身份快照，提交时回传供 App 核验。
  const [confirmSnapshot, setConfirmSnapshot] = useState<string | null>(null)

  const approveRef = useRef<HTMLButtonElement>(null)
  const rejectRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const approvable = scheduleChain.safety.verdict === 'allow'
  const blockReasons = approvable ? [] : scheduleChain.safety.reasons
  const candidateRef = run.evaluation.candidates.map((u) => u.id).join('+') || '无'
  const coverageTotal = run.series.points.length
  const coverageCount = run.recommendation.periods.length
  const infeasibleCount = run.recommendation.infeasiblePeriods.length

  // 完整 run 身份（来源/场景/夹具/偏好/初态/时刻/机组参数/完整计划）改变时，
  // 清空未提交的处置输入、回执与错误，并关闭确认框。
  // 身份改变：清回执/错误/确认；草稿由 App 按身份清理，挂载时不在此清合法草稿。
  useEffect(() => {
    setOutcome(null)
    setError('')
    setConfirming(null)
    setConfirmSnapshot(null)
  }, [runIdentity])

  useEffect(() => {
    if (!confirming) return
    confirmRef.current?.focus()
  }, [confirming])

  const openConfirm = (action: 'approve' | 'reject') => {
    if (action === 'approve' && !approvable) {
      setError('当前版本不可批准：安全审查拒绝时业务侧同步阻断，不进入确认。')
      return
    }
    if (reason.trim().length < 2) {
      setError('请先填写处置理由（至少 2 个字符），再进行确认。')
      return
    }
    setError('')
    setConfirmSnapshot(runIdentity)
    setConfirming(action)
  }

  const closeConfirm = () => {
    const trigger =
      confirming === 'approve' ? approveRef.current : rejectRef.current
    setConfirming(null)
    setConfirmSnapshot(null)
    // 归还合法焦点：触发器可用则回触发器，禁用则落到可见的结果标题。
    if (trigger && !trigger.disabled) trigger.focus()
    else headingRef.current?.focus()
  }

  const commit = () => {
    if (!confirming) return
    if (reason.trim().length < 2) {
      setError('请填写处置理由（至少 2 个字符）。')
      setConfirming(null)
      return
    }
    const result = onSubmit(
      confirming,
      reason.trim(),
      confirmSnapshot ?? runIdentity,
    )
    setOutcome(result)
    setReason('')
    setError('')
    setConfirmSnapshot(null)
    const trigger =
      confirming === 'approve' ? approveRef.current : rejectRef.current
    setConfirming(null)
    if (trigger && !trigger.disabled) trigger.focus()
    else headingRef.current?.focus()
  }

  return (
    <section className="panel decision-detail">
      <div className="panel-head">
        <h2 ref={headingRef} tabIndex={-1}>
          决策详情（{scenarioLabel}）
        </h2>
        <span className={`tag ${approvable ? 'ok' : 'bad'}`}>
          {approvable ? '复验通过 · 可人工评审' : '复验未通过 · 禁止批准/执行'}
        </span>
      </div>

      <div className="decision-identity" role="group" aria-label="候选身份与版本">
        <div className="decision-identity-item">
          <span>来源</span>
          <strong>合成调度示例</strong>
        </div>
        <div className="decision-identity-item decision-identity-wide">
          <span>当前完整身份</span>
          <strong className="mono">{identitySummary}</strong>
          <details className="identity-details">
            <summary>展开完整身份原文</summary>
            <p className="mono identity-full">{runIdentity}</p>
          </details>
        </div>
        <div className="decision-identity-item">
          <span>候选机组</span>
          <strong className="mono">{candidateRef}</strong>
        </div>
        <div className="decision-identity-item">
          <span>规则版本</span>
          <strong className="mono">{RULE_VERSION}</strong>
        </div>
        <div className="decision-identity-item">
          <span>方案可行</span>
          <strong>{run.recommendation.feasible ? '是' : '否（无可行建议）'}</strong>
        </div>
      </div>

      <div className="decision-facets">
        <div className={`facet${verification.passed ? ' ok' : ' fail'}`}>
          <h3>硬约束（独立复验）</h3>
          <p>
            {verification.hasSolution
              ? verification.passed
                ? '通过全部可复算硬约束'
                : `未通过：${verification.violationCount} 项违规`
              : '无可复验方案（无解）'}
          </p>
          <ul className="plain-list">
            {(Object.keys(VIOLATION_LABEL) as Array<keyof typeof VIOLATION_LABEL>).map(
              (k) => (
                <li key={k}>
                  {VIOLATION_LABEL[k]}：{verification.byType[k]} 项
                </li>
              ),
            )}
          </ul>
          <p className="hint">
            对照基线独立复验：{baselineVerification.hasSolution ? `${baselineVerification.violationCount} 项违规` : '无解'}（仅对照，不作为批准依据）。
          </p>
        </div>

        <div className="facet">
          <h3>需求覆盖</h3>
          <p>
            建议覆盖 {coverageCount}/{coverageTotal} 时段；无解时段 {infeasibleCount} 个。
          </p>
          <p className="hint">
            覆盖时段数不等于约束通过，可行性以上方独立复验为准。
          </p>
        </div>

        <div className="facet">
          <h3>质量（不参与本判定）</h3>
          <p>
            本卡只依据「合成调度来源」自身输入；合成回放夹具的数据质量分级不参与调度可行性或审批。
          </p>
        </div>

        <div
          className={`facet${
            currentDecision ? (currentDecision.action === 'approve' ? ' ok' : ' fail') : ''
          }`}
        >
          <h3>人审状态（处置）</h3>
          {currentDecision ? (
            <>
              <p>
                当前有效{currentDecision.action === 'approve' ? '批准' : '驳回'}：
                {currentDecision.reason}
              </p>
              <p className="hint">
                记录时间 {currentDecision.createdAt}
                {currentAuditId ? ` · 关联审计 ${currentAuditId}` : ''}
              </p>
            </>
          ) : historicalDecision ? (
            <>
              <p className="neg">存在历史处置记录，但不作为当前有效处置。</p>
              <p className="hint">{approval.reason}</p>
              <p className="hint">
                历史记录：{historicalDecision.action === 'approve' ? '曾批准' : '曾驳回'}：
                {historicalDecision.reason}（{historicalDecision.createdAt}）
              </p>
            </>
          ) : (
            <p>待值班员处置。</p>
          )}
        </div>
      </div>

      {!approvable ? (
        <div className="decision-block" id="decision-disabled-reason" role="status">
          <strong>不可批准原因（常驻可读）：</strong>
          <ul>
            {blockReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="decision-form">
        <p className="demo-warning">
          批准只记录「合成演示」状态，不调用真实 PLC/SCADA，不下发任何设备指令。
        </p>
        <label className="field">
          <span>处置理由（必填，至少 2 个字符）</span>
          <textarea
            value={reason}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            placeholder="填写批准或驳回的真实理由，例如：夜间负荷低，同意保留 2# 机运行。"
            aria-describedby={!approvable ? 'decision-disabled-reason' : undefined}
          />
        </label>
        {error ? <p className="neg">{error}</p> : null}
        <div className="decision-actions">
          <button
            type="button"
            ref={approveRef}
            className="btn approve"
            disabled={!approvable}
            aria-describedby={!approvable ? 'decision-disabled-reason' : undefined}
            onClick={() => openConfirm('approve')}
          >
            {approvable ? '批准建议' : '已阻断：不可批准'}
          </button>
          <button
            type="button"
            ref={rejectRef}
            className="btn reject"
            onClick={() => openConfirm('reject')}
          >
            驳回建议
          </button>
        </div>
      </div>

      {outcome ? (
        <div
          className={`decision-outcome${outcome.written ? '' : ' blocked'}`}
          role="status"
        >
          <strong>
            {outcome.stale
              ? '确认已过期，未写入、未记审计（方案身份已变化）'
              : outcome.written
                ? `已记录${outcome.action === 'approve' ? '批准' : '驳回'}（仅演示状态）`
                : outcome.decisionId
                  ? '未重复写入（同一上下文已存在相同有效处置）'
                  : '批准被阻断，未写入决策记录'}
          </strong>
          <p>理由：{outcome.reason}</p>
          {outcome.auditId ? (
            <p className="mono">
              审计 ID：{outcome.auditId}
              {outcome.decisionId ? ` · 决策 ID：${outcome.decisionId}` : ''}
            </p>
          ) : null}
          {outcome.blockReason ? <p className="neg">阻断原因：{outcome.blockReason}</p> : null}
        </div>
      ) : null}

      {confirming ? (
        <div
          className="dialog-backdrop"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              closeConfirm()
            }
          }}
        >
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-dialog-title"
          >
            <h3 id="decision-dialog-title">
              确认{confirming === 'approve' ? '批准' : '驳回'}「{scenarioLabel}」建议？
            </h3>
            <dl className="context-facts">
              <div>
                <dt>来源</dt>
                <dd>合成调度示例</dd>
              </div>
              <div>
                <dt>事件 / 场景</dt>
                <dd>{scenarioLabel}</dd>
              </div>
              <div>
                <dt>候选</dt>
                <dd className="mono">{candidateRef}</dd>
              </div>
              <div>
                <dt>版本</dt>
                <dd className="mono">
                  {identitySummary} · {RULE_VERSION}
                </dd>
              </div>
            </dl>
            <p className="demo-warning">
              只记录合成演示，不下发设备。关闭或 Esc 不提交，不会改变任何设备或控制回路。
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                ref={confirmRef}
                className={`btn ${confirming === 'approve' ? 'approve' : 'reject'}`}
                onClick={commit}
              >
                确认{confirming === 'approve' ? '批准' : '驳回'}
              </button>
              <button type="button" className="btn ghost" onClick={closeConfirm}>
                取消（Esc）
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}