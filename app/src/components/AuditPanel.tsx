import { Fragment, useState } from 'react'
import { DEMO_DECLARATIONS, type AuditExportState, type AuditKind } from '../domain/audit'

const KIND_LABEL: Record<AuditKind, string> = {
  recompute: '重算',
  qa: '问答',
  approve: '批准',
  reject: '驳回',
  export: '导出',
}

export interface AuditExportFeedback {
  format: 'json' | 'csv' | 'html'
  ok: boolean
  fileName: string
  eventCount: number
  reason?: string
}

interface Props {
  state: AuditExportState
  onExport: (format: 'json' | 'csv' | 'html') => void
  feedback?: AuditExportFeedback | null
}

export default function AuditPanel({ state, onExport, feedback }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>审计与导出（本地演示记录）</h2>
        <span className="tag warn">本地演示记录，非生产审计存证</span>
      </div>

      <details className="audit-declarations">
        <summary className="hint">演示口径声明（4 条）</summary>
        <ul className="declaration-list">
          {DEMO_DECLARATIONS.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </details>

      <div className="qa-actions">
        <button type="button" className="btn" onClick={() => onExport('json')}>
          导出 JSON（机器可复核）
        </button>
        <button type="button" className="btn" onClick={() => onExport('csv')}>
          导出 CSV（事件记录）
        </button>
        <button type="button" className="btn" onClick={() => onExport('html')}>
          导出 HTML 演示报告
        </button>
      </div>

      {feedback ? (
        <p
          className={feedback.ok ? 'ok-text' : 'neg'}
          role="status"
          aria-live="polite"
        >
          {feedback.ok
            ? `已生成文件 ${feedback.fileName}（${feedback.eventCount} 条事件，规则版本 ${state.ruleVersion}）。`
            : `导出 ${feedback.format.toUpperCase()} 失败：${feedback.reason ?? '浏览器未生成文件'}。`}
        </p>
      ) : null}

      <div className="table-wrap short">
        <table className="period-table">
          <thead>
            <tr>
              <th>事件 ID</th>
              <th>时间</th>
              <th>类型</th>
              <th>版本</th>
              <th>场景 / 来源</th>
              <th>输入 / 问题</th>
              <th>结论</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {state.events.length === 0 ? (
              <tr>
                <td colSpan={8} className="hint">
                  暂无审计事件。执行重算、提问、批准或导出后会在此记录。
                </td>
              </tr>
            ) : (
              state.events.map((e) => (
                <Fragment key={e.id}>
                  <tr>
                    <td className="mono">{e.id}</td>
                    <td className="mono">{e.at}</td>
                    <td>{KIND_LABEL[e.kind]}</td>
                    <td className="mono">{e.ruleVersion}</td>
                    <td className="mono">
                      {e.scenario}
                      {e.sourceIds.length ? ` · ${e.sourceIds.join('|')}` : ''}
                    </td>
                    <td>{e.inputSummary}</td>
                    <td>{e.conclusion}</td>
                    <td>
                      <button
                        type="button"
                        className="chip-btn"
                        aria-expanded={expanded === e.id}
                        onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                      >
                        {expanded === e.id ? '收起' : '展开'}
                      </button>
                    </td>
                  </tr>
                  {expanded === e.id ? (
                    <tr className="audit-detail-row">
                      <td colSpan={8}>
                        <dl className="context-facts">
                          <div>
                            <dt>来源范围</dt>
                            <dd className="mono">{e.sourceScope}</dd>
                          </div>
                          <div>
                            <dt>来源 ID</dt>
                            <dd className="mono">{e.sourceIds.join('|') || '—'}</dd>
                          </div>
                          <div>
                            <dt>证据 ID</dt>
                            <dd className="mono">{e.evidenceIds.join('|') || '—'}</dd>
                          </div>
                          <div>
                            <dt>操作者动作</dt>
                            <dd>{e.operatorAction}（未记录姓名，不捏造操作者）</dd>
                          </div>
                          {e.beforePlanSummary ? (
                            <div>
                              <dt>处置前</dt>
                              <dd>{e.beforePlanSummary}</dd>
                            </div>
                          ) : null}
                          {e.afterPlanSummary ? (
                            <div>
                              <dt>处置后</dt>
                              <dd>{e.afterPlanSummary}</dd>
                            </div>
                          ) : null}
                          {e.rejectionReason ? (
                            <div>
                              <dt>驳回 / 阻断理由</dt>
                              <dd>{e.rejectionReason}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="hint">
        导出由当前真实状态生成（规则版本 {state.ruleVersion}，事件 {state.events.length} 条），非写死样例；JSON 保留 null 与 sourceScope/sourceIds，不零填充。
      </p>
    </section>
  )
}