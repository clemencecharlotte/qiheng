import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { EvidenceContext, EvidenceWorkspace } from '../domain/evidence'
import type { ApprovalDecision } from '../domain/types'
import { PRESET_QUESTIONS, askQuestion, type QaAnswer, type QaEvidence } from '../domain/qa'
import { narrateAnswer, type NarratedAnswer, type NarratorConfig, type NarratorTransport } from '../domain/narrator'
import { qaEvidenceTriggerId, type QaView } from './QaPanel'
import type { ChatMessageSnapshot } from '../integration/evidenceReturn'

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
  const [messages, setMessages] = useState<ChatMessageSnapshot[]>(() =>
    view?.messages ?? (view?.answer ? [{ id: 0, role: 'user', text: view.input }, { id: 1, role: 'assistant', answer: view.answer }] : []),
  )
  const [draft, setDraft] = useState(view?.draft ?? (view?.answer ? '' : (view?.input ?? '')))
  const [pending, setPending] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const generationRef = useRef(0)
  const nextId = useRef(Math.max(1, ...messages.map((m) => m.id)) + 1)
  const instanceId = useId()
  const chatId = useRef(view?.chatId ?? instanceId)
  const messagesRef = useRef(messages)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const onViewRef = useRef(onViewChange)
  onViewRef.current = onViewChange
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const drawerRef = useRef<HTMLDialogElement | null>(null)
  const drawerTitleRef = useRef<HTMLHeadingElement | null>(null)
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const restoredScrollRef = useRef(view?.scrollTop)
  const identityRef = useRef(runIdentity)

  const publish = (next = messagesRef.current) => {
    const lastUser = [...next].reverse().find((m) => m.role === 'user')
    const lastAnswer = [...next].reverse().find((m) => m.answer)?.answer ?? null
    onViewRef.current?.({
      input: lastUser?.text ?? '', answer: lastAnswer, messages: next,
      chatId: chatId.current, draft: draftRef.current, scrollTop: listRef.current?.scrollTop ?? 0,
    })
  }
  const updateMessages = (next: ChatMessageSnapshot[]) => {
    messagesRef.current = next
    setMessages(next)
    publish(next)
  }

  useEffect(() => {
    generationRef.current += 1
    setPending(false)
    if (identityRef.current !== runIdentity) {
      identityRef.current = runIdentity
      messagesRef.current = []
      setMessages([])
      draftRef.current = ''
      setDraft('')
    }
  }, [runIdentity])
  useEffect(() => () => { generationRef.current += 1 }, [])
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = restoredScrollRef.current ?? el.scrollHeight
    restoredScrollRef.current = undefined
  }, [messages.length, pending])
  useEffect(() => {
    if (!drawerOpen) return
    const dialog = drawerRef.current
    if (!dialog) return
    dialog.showModal()
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    drawerTitleRef.current?.focus({ preventScroll: true })
    const trigger = drawerTriggerRef.current
    return () => {
      if (dialog.open) dialog.close()
      document.documentElement.style.overflow = previousOverflow
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [drawerOpen])

  const run = async (question: string) => {
    const text = question.trim()
    if (!text || pending) return
    const generation = generationRef.current
    setPending(true)
    updateMessages([...messagesRef.current, { id: nextId.current++, role: 'user', text }])
    const base: QaAnswer = askQuestion(ctx, text, { scenarioLabel, currentDecision, decisionEventId })
    const narrated = await narrateAnswer(base, { question: text, config: narratorConfig, transport: narratorTransport, safetyAllowsApproval })
    if (generation !== generationRef.current) return
    setPending(false)
    draftRef.current = ''
    setDraft('')
    updateMessages([...messagesRef.current, { id: nextId.current++, role: 'assistant', answer: narrated }])
    onAnswered(text, narrated)
  }

  const cancel = () => { generationRef.current += 1; setPending(false); updateMessages([...messagesRef.current, { id: nextId.current++, role: 'assistant', error: '已取消本次提问；未修改任何审批或状态。' }]) }

  const suggestions = PRESET_QUESTIONS.slice(0, 3)

  return (
    <div className="chat-console">
      <div className="chat-stream" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <h3>气衡问答</h3>
            <p>你想了解哪个设备或方案？</p>
            <div className="chat-sugs" role="group" aria-label="建议问题">
              {suggestions.map((q, index) => (
                <button key={q.intent} type="button" className="chat-sug" onClick={() => { setDraft(q.label); void run(q.label) }}>
                  {['解释当前方案', 'AC-03为何只读', '查询时段能耗'][index]}
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
                  <details className="chat-ev" open={m.evidenceOpen ?? false} onToggle={(event) => {
                    const open = event.currentTarget.open
                    if (open !== m.evidenceOpen && !(m.evidenceOpen === undefined && !open)) {
                      updateMessages(messagesRef.current.map((msg) => msg.id === m.id ? { ...msg, evidenceOpen: open } : msg))
                    }
                  }}>
                    <summary>证据与来源（{m.answer.evidence.length}）</summary>
                    <ul>
                      {m.answer.evidence.map((e, index) => (
                        <li key={e.id}>
                          <button type="button" className="link-btn" id={`${qaEvidenceTriggerId(e.anchor.target)}--${chatId.current}--${m.id}-${index}`} onClick={(ev) => {
                            publish()
                            onJump(e.anchor.workspace, e.anchor.target, ev.currentTarget.id)
                          }}>
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
            onBlur={() => publish()}
          />
        </div>
        <div className="chat-composer-bar">
          {statusTag}
          <span className="chat-spacer" />
          <button ref={drawerTriggerRef} type="button" className="btn ghost" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog">{drawerLabel}</button>
          {pending ? (
            <button type="button" className="btn ghost" onClick={cancel}>取消</button>
          ) : (
            <button type="submit" className="btn primary" disabled={draft.trim().length === 0}>发送</button>
          )}
        </div>
      </form>

      {drawerOpen ? (
        <dialog ref={drawerRef} className="chat-modal" aria-modal="true" aria-label={drawerLabel}
          onCancel={(event) => { event.preventDefault(); event.stopPropagation(); setDrawerOpen(false) }}
          onKeyDownCapture={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDrawerOpen(false) }
            if (event.key === 'Tab') {
              const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]')]
                .filter((el) => el.getClientRects().length > 0)
              const index = controls.indexOf(document.activeElement as HTMLElement)
              if (!controls.length) { event.preventDefault(); drawerTitleRef.current?.focus(); return }
              if ((event.shiftKey && index <= 0) || (!event.shiftKey && (index < 0 || index === controls.length - 1))) {
                event.preventDefault()
                controls[event.shiftKey ? controls.length - 1 : 0].focus()
              }
            }
          }}
          onClose={(event) => { if (!event.currentTarget.open) setDrawerOpen(false) }}
          onClick={(event) => { if (event.target === event.currentTarget) setDrawerOpen(false) }}>
          <aside className="qel-drawer chat-drawer">
            <div className="qel-drawer-head">
              <h3 ref={drawerTitleRef} tabIndex={-1}>{drawerLabel}</h3>
              <button type="button" className="qel-close" onClick={() => setDrawerOpen(false)}>关闭 Esc</button>
            </div>
            {drawerContent}
          </aside>
        </dialog>
      ) : null}
    </div>
  )
}
