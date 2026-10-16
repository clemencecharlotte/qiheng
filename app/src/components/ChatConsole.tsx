import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { EvidenceContext, EvidenceWorkspace } from '../domain/evidence'
import type { ApprovalDecision } from '../domain/types'
import { PRESET_QUESTIONS, askQuestion, type QaAnswer, type QaEvidence } from '../domain/qa'
import { narrateAnswer, type NarratedAnswer, type NarratorConfig, type NarratorTransport } from '../domain/narrator'
import { qaEvidenceTriggerId, type QaView } from './QaPanel'

/**
 * r45 ⑤ · 聊天产品呈现：消息流 + 中心主输入 + 按需抽屉。
 * 问答逻辑与旧表单呈现解耦：直接消费 domain/qa + domain/narrator，
 * 保留合同：view 快照恢复、qa-ref 稳定 trigger、代次/迟到保护、取消、审计回调。
 */

const SOURCE_SCOPE_LABEL: Record<QaAnswer['sourceScope'], string> = {
  schedule: '合成调度示例',
  history: '合成回放夹具',
  both: '合成调度示例 + 合成回放夹具',
}
const QUALITY_LABEL: Record<NonNullable<QaEvidence['quality']>, string> = {
  pass: '质量通过',
  review: '质量待复核',
  invalid: '质量无效',
}

interface Msg {
  id: number
  role: 'user' | 'assistant'
  text?: string
  answer?: NarratedAnswer | null
  error?: string
}

export default function ChatConsole({
  ctx, scenarioLabel, narratorConfig, narratorTransport, safetyAllowsApproval,
  currentDecision, decisionEventId, runIdentity, onJump, onAnswered,
  view = null, onViewChange, statusTag, drawerContent, drawerLabel = '上下文与工具',
}: {
  ctx: EvidenceContext
  scenarioLabel: string
  narratorConfig: NarratorConfig
  narratorTransport: NarratorTransport | null
  safetyAllowsApproval: boolean
  currentDecision?: ApprovalDecision | null
  decisionEventId?: string | null
  runIdentity?: string
  onJump: (workspace: EvidenceWorkspace, target: string, originId?: string) => void
  onAnswered: (question: string, answer: NarratedAnswer) => void
  view?: QaView | null
  onViewChange?: (v: QaView) => void
  statusTag?: ReactNode
  drawerContent?: ReactNode
  drawerLabel?: string
}) {
  const [messages, setMessages] = useState<Msg[]>(() =>
    view?.answer ? [{ id: 0, role: 'user', text: view.input }, { id: 1, role: 'assistant', answer: view.answer }] : [],
  )
  const [draft, setDraft] = useState(view?.answer ? '' : (view?.input ?? ''))
  const [pending, setPending] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const generationRef = useRef(0)
  const nextId = useRef(2)
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => { generationRef.current += 1; setPending(false) }, [runIdentity])
  useEffect(() => () => { generationRef.current += 1 }, [])
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending])
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const run = async (question: string) => {
    const text = question.trim()
    if (!text || pending) return
    const generation = generationRef.current
    setPending(true)
    setMessages((m) => [...m, { id: nextId.current++, role: 'user', text }])
    const base: QaAnswer = askQuestion(ctx, text, { scenarioLabel, currentDecision, decisionEventId })
    const narrated = await narrateAnswer(base, { question: text, config: narratorConfig, transport: narratorTransport, safetyAllowsApproval })
    if (generation !== generationRef.current) return
    setMessages((m) => [...m, { id: nextId.current++, role: 'assistant', answer: narrated }])
    setPending(false)
    setDraft('')
    onViewChange?.({ input: text, answer: narrated })
    onAnswered(text, narrated)
  }

  const cancel = () => { generationRef.current += 1; setPending(false); setMessages((m) => [...m, { id: nextId.current++, role: 'assistant', error: '已取消本次提问；未修改任何审批或状态。' }]) }

  const suggestions = PRESET_QUESTIONS.slice(0, 3)

  return (
    <div className="chat-console">
      <div className="chat-stream" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <h3>气衡问答</h3>
            <p>你想了解哪个设备或方案？</p>
            <div className="chat-sugs" role="group" aria-label="建议问题">
              {suggestions.map((q) => (
                <button key={q.intent} type="button" className="chat-sug" onClick={() => { setDraft(q.label); void run(q.label) }}>
                  {q.label.length > 18 ? `${q.label.slice(0, 18)}…` : q.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`chat-msg chat-msg--${m.role}`}>
              {m.role === 'user' ? (
                <p className="chat-bubble">{m.text}</p>
              ) : m.error ? (
                <p className="chat-bubble chat-bubble--err">{m.error}</p>
              ) : m.answer ? (
                <div className="chat-bubble chat-answer">
                  <p>{m.answer.conclusion}</p>
                  <p className="hint">下一步：{m.answer.nextStep}</p>
                  {m.answer.refused ? <p className="hint">能力边界：{m.answer.refusalReason ?? '不支持该问法'}</p> : null}
                  <details className="chat-ev">
                    <summary>证据与来源（{m.answer.evidence.length}）</summary>
                    <ul>
                      {m.answer.evidence.map((e) => (
                        <li key={e.id}>
                          <button type="button" className="link-btn" id={qaEvidenceTriggerId(e.anchor.target)} onClick={(ev) => onJump(e.anchor.workspace, e.anchor.target, ev.currentTarget.id)}>
                            <code>{e.id}</code> {e.label}
                          </button>
                          {e.quality ? <span className={`tag ${e.quality === 'pass' ? 'ok' : e.quality === 'review' ? 'warn' : 'bad'}`}>{QUALITY_LABEL[e.quality]}</span> : null}
                        </li>
                      ))}
                    </ul>
                    {m.answer.unknowns.length ? <p className="hint">未知：{m.answer.unknowns.join('；')}</p> : null}
                    {m.answer.assumptions.length ? <p className="hint">假设：{m.answer.assumptions.join('；')}</p> : null}
                    <p className="hint">来源：{SOURCE_SCOPE_LABEL[m.answer.sourceScope]} · {m.answer.narrationMode === 'model' ? '模型润色（仅解释）' : '规则解释'}</p>
                  </details>
                </div>
              ) : null}
            </div>
          ))
        )}
        {pending ? <div className="chat-msg chat-msg--assistant"><p className="chat-bubble chat-bubble--pending">正在核对证据…</p></div> : null}
      </div>

      <form
        className="chat-composer"
        onSubmit={(e) => { e.preventDefault(); void run(draft) }}
      >
        <div className="chat-composer-row">
          <textarea
            ref={inputRef}
            rows={2}
            value={draft}
            placeholder="例如：为什么当前建议被拒绝？AC-03 为什么只读？"
            aria-label="提问输入"
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <div className="chat-composer-bar">
          {statusTag}
          <span className="chat-spacer" />
          <button type="button" className="btn ghost" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog">{drawerLabel}</button>
          {pending ? (
            <button type="button" className="btn ghost" onClick={cancel}>取消</button>
          ) : (
            <button type="submit" className="btn primary" disabled={draft.trim().length === 0}>发送</button>
          )}
        </div>
      </form>

      {drawerOpen ? (
        <div className="qel-scrim chat-scrim" onClick={() => setDrawerOpen(false)}>
          <aside className="qel-drawer chat-drawer" role="dialog" aria-modal="true" aria-label={drawerLabel} onClick={(e) => e.stopPropagation()}>
            <div className="qel-drawer-head">
              <h3>{drawerLabel}</h3>
              <button type="button" className="qel-close" onClick={() => { setDrawerOpen(false); inputRef.current?.focus() }}>关闭 Esc</button>
            </div>
            {drawerContent}
          </aside>
        </div>
      ) : null}
    </div>
  )
}
