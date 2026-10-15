import { useState } from 'react'
import { isCurrentRuleVersion } from '../domain/audit'
import type { ApprovalDecision } from '../domain/types'

interface Props {
  scenarioLabel: string
  decisions: ApprovalDecision[]
  onSubmit: (action: 'approve' | 'reject', reason: string) => void
  approvable: boolean
  blockReasons: string[]
}

export default function DecisionPanel({
  scenarioLabel,
  decisions,
  onSubmit,
  approvable,
  blockReasons,
}: Props) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const submit = (action: 'approve' | 'reject') => {
    if (action === 'approve' && !approvable) {
      setError('当前版本不可批准：请先处理上方阻断原因（业务侧已同步阻断）。')
      return
    }
    if (reason.trim().length < 2) {
      setError('请填写处置理由（至少 2 个字符）。')
      return
    }
    onSubmit(action, reason.trim())
    setReason('')
    setError('')
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>值班员决策（{scenarioLabel}）</h2>
        <span className={`tag ${approvable ? 'ok' : 'bad'}`}>
          {approvable ? '复验通过 · 可人工评审' : '复验未通过 · 禁止批准/执行'}
        </span>
      </div>
      <p className="demo-warning">
        批准仅更新本页演示状态，不调用真实 PLC/SCADA，不写入任何现场设备或控制回路。
        批准记录绑定来源 / 场景 / 运行 / 候选版本，不迁移到其他场景。
      </p>
      {!approvable ? (
        <div className="decision-block" role="status">
          <strong>不可批准原因：</strong>
          <ul>
            {blockReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="decision-form">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="填写批准或驳回的理由（必填），例如：夜间负荷低，同意保留 2# 机运行。"
          rows={3}
        />
        {error ? <p className="neg">{error}</p> : null}
        <div className="decision-actions">
          <button
            type="button"
            className="btn approve"
            disabled={!approvable}
            onClick={() => submit('approve')}
          >
            {approvable ? '批准建议' : '已阻断：不可批准'}
          </button>
          <button
            type="button"
            className="btn reject"
            onClick={() => submit('reject')}
          >
            驳回建议
          </button>
        </div>
      </div>
      <div className="decision-log">
        <h3>决策记录（浏览器本地演示状态）</h3>
        {decisions.length === 0 ? (
          <p className="hint">当前场景暂无决策记录。</p>
        ) : (
          <ul>
            {decisions.map((d) => {
              const migrated = d.migrated === true
              const stale = migrated || !isCurrentRuleVersion(d.ruleVersion)
              return (
                <li key={d.id} className={d.action}>
                  <span className={`tag ${d.action === 'approve' ? 'ok' : 'bad'}`}>
                    {d.action === 'approve' ? '历史批准' : '历史驳回'}
                  </span>
                  {migrated ? (
                    <span className="tag warn">旧版迁移 · 须重新审核</span>
                  ) : stale ? (
                    <span className="tag warn">旧规则版本 · 须按现行规则重审</span>
                  ) : null}
                  <span className="decision-reason">{d.reason}</span>
                  <span className="decision-time">{d.createdAt}</span>
                  <span className="decision-bind">
                    绑定：{d.sourceId ?? '—'} · {d.scenario} ·{' '}
                    {d.candidateRef ?? '—'} · {d.ruleVersion ?? '—'}
                    {stale ? '（不自动升级，保留原记录）' : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}