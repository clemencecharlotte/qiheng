import { useEffect, useRef, useState } from 'react'
import type { EvidenceContext, EvidenceWorkspace } from '../domain/evidence'
import type { ApprovalDecision } from '../domain/types'
import type { QaViewSnapshot } from '../integration/evidenceReturn'
import {
  PRESET_QUESTIONS,
  askQuestion,
  type QaAnswer,
  type QaEvidence,
} from '../domain/qa'
import {
  narrateAnswer,
  type NarratedAnswer,
  type NarratorConfig,
  type NarratorTransport,
} from '../domain/narrator'

interface Props {
  ctx: EvidenceContext
  scenarioLabel: string
  narratorConfig: NarratorConfig
  narratorTransport: NarratorTransport | null
  safetyAllowsApproval: boolean
  currentDecision?: ApprovalDecision | null
  decisionEventId?: string | null
  /** 完整 run 身份：代次变更后旧异步结果不得覆盖新方案，也不得写审计。 */
  runIdentity?: string
  onJump: (workspace: EvidenceWorkspace, target: string, originId?: string) => void
  onAnswered: (question: string, answer: NarratedAnswer) => void
  /** M27 B · App 受控 QA 视图（input/answer）；返回来源时同 commit 恢复，不重新提问。 */
  view?: QaView | null
  onViewChange?: (v: QaView) => void
}

/** QA 已完成视图（受控）。 */
export type QaView = Omit<QaViewSnapshot, 'runIdentity'>

/** QA 外部稳定 trigger ID：返回时用于回焦本次问答入口。 */
export function qaEvidenceTriggerId(target: string): string {
  return `qa-ref-${target.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

const QUALITY_LABEL: Record<NonNullable<QaEvidence['quality']>, string> = {
  pass: '质量通过',
  review: '质量待复核',
  invalid: '质量无效',
}

const SOURCE_SCOPE_LABEL: Record<QaAnswer['sourceScope'], string> = {
  schedule: '合成调度示例',
  history: '合成回放夹具',
  both: '合成调度示例 + 合成回放夹具',
}

function QualityTag({ grade }: { grade: QaEvidence['quality'] }) {
  if (!grade) return null
  const cls = grade === 'pass' ? 'ok' : grade === 'review' ? 'warn' : 'bad'
  return <span className={`tag ${cls}`}>{QUALITY_LABEL[grade]}</span>
}

export default function QaPanel({
  ctx,
  scenarioLabel,
  narratorConfig,
  narratorTransport,
  safetyAllowsApproval,
  currentDecision,
  decisionEventId,
  runIdentity,
  onJump,
  onAnswered,
  view,
  onViewChange,
}: Props) {
  const input = view?.input ?? ''
  const answer = view?.answer ?? null
  const [pending, setPending] = useState(false)
  const generationRef = useRef(0)
  const setInput = (text: string) => onViewChange?.({ input: text, answer })

  // 身份变更：清空处理中状态并推进代次；旧异步返回据此丢弃（视图清理由 App 统一处理）。
  useEffect(() => {
    generationRef.current += 1
    setPending(false)
  }, [runIdentity])

  // 卸载也要使在途结果失效，避免对已卸载组件写入或回调。
  useEffect(
    () => () => {
      generationRef.current += 1
    },
    [],
  )

  const run = async (question: string) => {
    const text = question.trim()
    if (text.length === 0) return
    const generation = generationRef.current
    setPending(true)
    const base: QaAnswer = askQuestion(ctx, text, {
      scenarioLabel,
      currentDecision,
      decisionEventId,
    })
    const narrated = await narrateAnswer(base, {
      question: text,
      config: narratorConfig,
      transport: narratorTransport,
      safetyAllowsApproval,
    })
    // 代次已变（切夹具/偏好/卸载）：不覆盖新方案、不写审计。
    if (generation !== generationRef.current) return
    onViewChange?.({ input: text, answer: narrated })
    setPending(false)
    onAnswered(text, narrated)
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>可信问答</h2>
        <span className={`tag ${narratorConfig.status === 'enabled' ? 'ok' : 'warn'}`}>
          {narratorConfig.status === 'enabled' ? '模型润色可用' : '模型未连接 · 确定性解释'}
        </span>
      </div>

      {answer ? null : (
        <div className="qa-presets" role="group" aria-label="预设问题">
          <p className="qa-ask">你想了解哪个设备或方案？</p>
          {PRESET_QUESTIONS.slice(0, 3).map((q) => (
            <button
              type="button"
              key={q.intent}
              className="chip-btn"
              onClick={() => {
                setInput(q.label)
                void run(q.label)
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
      )}

      <form
        className="qa-form"
        onSubmit={(e) => {
          e.preventDefault()
          void run(input)
        }}
      >
        <label className="field qa-field">
          <span>你的问题</span>
          <textarea
            value={input}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例如：为什么当前建议被拒绝？09:30 的数据质量如何？AC-03 为什么只读？"
            aria-describedby="qa-help"
          />
        </label>
        <div className="qa-actions">
          <button type="submit" className="btn" disabled={pending || input.trim().length === 0}>
            {pending ? '解释中…' : '提问'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setInput('')
              onViewChange?.({ input: '', answer: null })
              generationRef.current += 1
              setPending(false)
            }}
          >
            清空
          </button>
        </div>
        <details className="qa-help"><summary>问答说明</summary><p id="qa-help" className="hint">只解释证据，不修改审批或下发指令。
          问答不会绕过安全门：违规/执行/KPI 类问题会被拒绝或要求澄清，且不会编造时段与数值。
          {narratorConfig.status !== 'enabled' && narratorConfig.reason ? ` 模型通道：${narratorConfig.reason}` : ''}
        </p></details>
      </form>

      <div className="qa-answer" aria-live="polite">
        {answer ? (
          <article className={`qa-card${answer.refused ? ' refused' : ''}`}>
            <header className="qa-card-head">
              <span className={`tag ${answer.narrationMode === 'model' ? 'ok' : ''}`}>
                {answer.narrationMode === 'model' ? '模型润色' : '规则解释'}
              </span>
              <span className="tag">所问来源 {SOURCE_SCOPE_LABEL[answer.sourceScope]}</span>
              {answer.untrustedInput ? <span className="tag bad">按不可信输入处理</span> : null}
            </header>

            <p className="qa-conclusion" role={answer.refused ? 'alert' : undefined}>
              {answer.conclusion}
            </p>

            {answer.sourceScope === 'both' ? (
              <p className="qa-context">两个来源（合成调度示例 / 合成回放夹具）不可直接比较。</p>
            ) : null}

            {answer.fallbackReason ? (
              <p className="hint">{answer.fallbackReason}</p>
            ) : null}

            {answer.narrationNote ? (
              <p className="qa-narration">{answer.narrationNote}</p>
            ) : null}

            {answer.invalidRefs.length > 0 ? (
              <p className="neg">已丢弃无效证据引用：{answer.invalidRefs.join('、')}</p>
            ) : null}

            <div className="qa-section">
              <span className="qa-label">证据（点击回原对象）</span>
              {answer.evidence.length === 0 ? null : (
                <ul className="qa-evidence-list">
                  {answer.evidence.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        id={qaEvidenceTriggerId(item.anchor.target)}
                        className="evidence-link"
                        onClick={() => onJump(item.anchor.workspace, item.anchor.target, qaEvidenceTriggerId(item.anchor.target))}
                      >
                        <span className="mono">{item.id}</span>
                        <span>{item.label}</span>
                        {item.unit ? <span className="hint">{item.unit}</span> : null}
                      </button>
                      <QualityTag grade={item.quality} />
                      {item.detail ? (
                        <details className="qa-evidence-detail"><summary>口径</summary><span className="hint">{item.detail}</span></details>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="qa-section">
              <span className="qa-label">建议下一步</span>
              <p>{answer.nextStep}</p>
            </div>

            <details className="qa-section">
              <summary className="qa-label">依据与未知（按需展开）</summary>
              <div className="qa-section">
                <span className="qa-label">依据 / 口径</span>
                {answer.assumptions.length > 0 ? (
                  <ul className="plain-list">
                    {answer.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="qa-section">
                <span className="qa-label">未知 / 限制</span>
                {answer.unknowns.length > 0 ? (
                  <ul className="plain-list unknown">
                    {answer.unknowns.map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </details>
          </article>
        ) : null}
      </div>
    </section>
  )
}
