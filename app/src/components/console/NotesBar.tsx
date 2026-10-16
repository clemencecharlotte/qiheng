import { autoUpdate, computePosition, offset, shift, size } from '@floating-ui/dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NOTES, type NoteKey } from './notes'

/**
 * M15 r01 · 页末注释：默认折叠，右下角角标按钮（触达 ≥44）控制展开/收起。
 * 正文 NoteRef 派发 qh:note-open{detail.id} → 展开后（挂载后）**聚焦并局部滚动到对应项**；
 * latest-wins：快速连续切引用只聚焦最后一次；Esc 收起并把焦点回本次引用角标。
 * 动态安全信息（离线/陈旧/拒绝/批准限制）不在本折叠区，就近保留。
 */
export default function NotesBar({
  sceneLabel,
  context = 'synthetic',
}: {
  sceneLabel: string
  context?: 'synthetic' | 'offline'
}) {
  const offline = context === 'offline'
  const [open, setOpen] = useState(false)
  const lastRefId = useRef<string | null>(null)
  const pendingFocusRef = useRef<string | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const anchor = toggleRef.current, panel = panelRef.current
    if (!open || !anchor || !panel) return
    let active = true
    const stop = autoUpdate(anchor, panel, () => {
      void computePosition(anchor, panel, { placement: "top-end", strategy: "fixed", middleware: [offset(8), shift({padding:8}), size({padding:8, apply({availableHeight, elements}) { elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px` }})] }).then(({x,y}) => { if (active) { panel.style.left = `${x}px`; panel.style.top = `${y}px` } })
    })
    return () => { active = false; stop() }
  }, [open])
  const keys: NoteKey[] = ['synthetic', 'readonly', offline ? 'offline' : 'data', 'approval', 'local', 'flow', 'passport', 'relations', 'governance', 'prerecord', 'bounds']

  const reduce = () => typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const focusItem = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: reduce() ? 'auto' : 'smooth' })
    el.focus({ preventScroll: true })
  }

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent).detail?.id as string | undefined
      if (!id) return
      lastRefId.current = id
      pendingFocusRef.current = id
      setOpen(true)
      // 已展开时 setOpen(true) 不触发重渲染；用 rAF 兜底聚焦（latest-wins）。
      requestAnimationFrame(() => {
        if (lastRefId.current === id && pendingFocusRef.current === id) {
          focusItem(id)
          pendingFocusRef.current = null
        }
      })
    }
    window.addEventListener('qh:note-open', onOpen)
    return () => window.removeEventListener('qh:note-open', onOpen)
  }, [])

  // 展开挂载后聚焦待处理目标（首次展开路径）。
  useLayoutEffect(() => {
    if (!open) return
    const id = pendingFocusRef.current
    if (!id) return
    pendingFocusRef.current = null
    focusItem(id)
  }, [open])

  // 展开后 Esc 收起并回本次引用角标。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(false)
      const id = lastRefId.current
      const ref = id ? document.querySelector<HTMLElement>(`[data-qh-note-ref="${id}"]`) : null
      ;(ref ?? toggleRef.current)?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const backToRef = (id: string) => {
    const ref = document.querySelector<HTMLElement>(`[data-qh-note-ref="${id}"]`)
    ref?.focus({ preventScroll: true })
  }

  return (
    <div className="app-footer-notes" id="app-notes" data-open={open ? '1' : '0'}>
      <button
        type="button"
        ref={toggleRef}
        className="app-footer-toggle"
        aria-expanded={open}
        aria-controls="app-notes-body"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '收起说明' : '说明'}
      </button>
      <div ref={panelRef} className="app-footer-notes-body" id="app-notes-body" hidden={!open}>
        <p className="app-footer-scene">
          {offline ? '只读数据接入' : '合成演示'}（当前场景：{sceneLabel}）
        </p>
        <ol>
          {keys.map((k) => {
            const def = NOTES[k]
            return (
              <li key={def.id} id={def.id} className="qh-note" tabIndex={-1}>
                <span className="qh-note-n">{def.n}</span>
                <span className="qh-note-text">{def.text}</span>
                <button
                  type="button"
                  className="qh-note-back"
                  data-qh-note-back={def.id}
                  onClick={() => backToRef(def.id)}
                >
                  回到引用 ↩
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
