import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import './preview-wheel.css'

export interface PreviewWheelItem {
  id: string
  title: string
  eyebrow: string
  content: ReactNode
  actionLabel?: string
  onOpen?: () => void
}
export function wheelOffset(index: number, selected: number, count: number) {
  if (count < 1) return 0
  const distance = ((index - selected) % count + count) % count
  return distance > count / 2 ? distance - count : distance
}

/** Real cards supplied by the host. No solver, storage, fabricated record or timer. */
export function PreviewWheel({ items, label = '能力图册', initialId, onSelect }: {
  items: PreviewWheelItem[]; label?: string; initialId?: string; onSelect?: (id: string) => void
}) {
  const prefix = useId()
  const [selectedId, setSelectedId] = useState(initialId ?? items[0]?.id ?? '')
  const [visible, setVisible] = useState(true)
  const [foreground, setForeground] = useState(() => typeof document === 'undefined' || !document.hidden)
  const root = useRef<HTMLElement>(null)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const gesture = useRef<{ x: number; y: number } | null>(null)
  const selected = Math.max(0, items.findIndex(item => item.id === selectedId))
  useEffect(() => {
    const node = root.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => setVisible(entries[0]?.isIntersecting ?? false))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const change = () => setForeground(!document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  function choose(index: number) {
    if (!items.length) return
    const next = ((index % items.length) + items.length) % items.length
    // Transfer focus before the old card becomes inert, including quick reversal.
    const tab = tabs.current[next]
    tab?.focus({ preventScroll: true })
    if (tab?.parentElement) {
      const item = tab.getBoundingClientRect(), track = tab.parentElement.getBoundingClientRect()
      if (item.left < track.left) tab.parentElement.scrollLeft -= track.left - item.left
      else if (item.right > track.right) tab.parentElement.scrollLeft += item.right - track.right
    }
    setSelectedId(items[next].id)
    onSelect?.(items[next].id)
  }
  function onKey(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement
    if (target.closest('input,textarea,select,a,[contenteditable=true]')) return
    const next = event.key === 'ArrowRight' ? selected + 1 : event.key === 'ArrowLeft' ? selected - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null
    if (next !== null) { event.preventDefault(); choose(next) }
  }
  const invalid = new Set(items.map(item => item.id)).size !== items.length || items.some(item => !item.id)
  return <section ref={root} className="qh-preview-wheel" aria-label={label} aria-roledescription="可选择的旋转图册"
    data-motion={visible && foreground ? 'active' : 'paused'} onKeyDown={onKey}>
    <header className="qh-wheel-heading"><h3>{label}</h3><span aria-live="polite" aria-atomic="true">
      {!invalid && items.length ? `${selected + 1} / ${items.length} · ${items[selected].title}` : '暂无可展示内容'}
    </span></header>
    {invalid ? <p role="status">图册对象编号有误，请检查来源目录。</p> : !items.length ? <p role="status">暂无内容，不展示虚构成果。</p> : <>
      <div className="qh-wheel-stage" onPointerDown={event => {
        if ((event.target as HTMLElement).closest('button,a,input,textarea,select')) return
        gesture.current = { x: event.clientX, y: event.clientY }
      }} onPointerCancel={() => { gesture.current = null }} onPointerUp={event => {
        const start = gesture.current; gesture.current = null
        if (start && Math.abs(event.clientX - start.x) > 48 && Math.abs(event.clientY - start.y) < 60)
          choose(selected + (event.clientX < start.x ? 1 : -1))
      }}>
        {items.map((item, index) => {
          const offset = wheelOffset(index, selected, items.length)
          const active = index === selected
          const hidden = Math.abs(offset) > 2
          const style = { '--wheel-offset': offset, zIndex: 10 - Math.abs(offset), opacity: hidden ? 0 : active ? 1 : .85 } as CSSProperties
          return <div key={item.id} className="qh-wheel-slot" style={style} data-active={active} data-hidden={hidden}>
            <article id={`${prefix}-card-${index}`} role="tabpanel" aria-labelledby={`${prefix}-tab-${index}`} className="qh-wheel-card" aria-label={item.title} inert={!active} aria-hidden={!active}>
              <div className="qh-wheel-eyebrow">{item.eyebrow}</div><h4>{item.title}</h4>
              <div className="qh-wheel-content">{item.content}</div>
              {item.onOpen && <button type="button" className="qh-wheel-action" onClick={item.onOpen}>{item.actionLabel ?? '查看真实内容'}<span aria-hidden="true"> ↗</span></button>}
            </article>
            {!active && !hidden && <button type="button" className="qh-wheel-preview-hit" tabIndex={-1}
              aria-label={`选择图册：${item.title}`} onClick={() => choose(index)} />}
          </div>
        })}
      </div>
      <div className="qh-wheel-controls">
        <button type="button" aria-label="图册上一张" onClick={() => choose(selected - 1)} disabled={items.length < 2}>←</button>
        <div className="qh-wheel-tabs" role="tablist" aria-label={`${label}选择`}>
          {items.map((item, index) => <button ref={node => { tabs.current[index] = node }} key={item.id}
            id={`${prefix}-tab-${index}`} type="button" role="tab" aria-selected={index === selected} aria-controls={`${prefix}-card-${index}`}
            tabIndex={index === selected ? 0 : -1} onClick={() => choose(index)}>{item.title}</button>)}
        </div>
        <button type="button" aria-label="图册下一张" onClick={() => choose(selected + 1)} disabled={items.length < 2}>→</button>
      </div>
    </>}
  </section>
}
