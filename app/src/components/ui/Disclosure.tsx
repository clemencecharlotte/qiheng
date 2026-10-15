import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './disclosure.css'

/**
 * M22 · 统一解释浮层原语（非原生 title 黑框）。
 * r05 修复 P0 render-loop：useAnchored 的 onLost/重定位须**稳定引用**，且 setStyle 值未变即保留旧值，
 * 避免"新 onLost → reposition 依赖变 → useLayoutEffect 再 setStyle → render 循环"（打开即白屏）。
 * - 依实际内容尺寸上下 flip/clamp；长详情 max-height 可滚；scroll/resize 重定位；入口消失安全关闭；
 *   一次仅一个活动解释；hover 与 focus 等价；点击/触屏固定；非模态不全屏 blur/inert；Esc 回本次入口。
 */

const GAP = 8
const MARGIN = 12

let activeClose: (() => void) | null = null
function claimActive(close: () => void) {
  if (activeClose && activeClose !== close) activeClose()
  activeClose = close
}
function releaseActive(close: () => void) {
  if (activeClose === close) activeClose = null
}

interface StyleState { left: number; top: number; width: number; maxHeight: number }
export function sameStyle(a: StyleState | null, b: StyleState): boolean {
  return !!a && a.left === b.left && a.top === b.top && a.width === b.width && a.maxHeight === b.maxHeight
}

function measureWidth(vw: number, max: number) {
  return Math.min(max, Math.max(160, vw - MARGIN * 2))
}

/** 依触发入口 rect + 实际内容高度决定 flip 与 top（并 clamp 视口内）。导出以便纯函数窄测。 */
export function place(rect: { left: number; right: number; top: number; bottom: number; width: number; height: number }, width: number, contentH: number, vwArg?: number, vhArg?: number): StyleState {
  const vw = vwArg ?? (typeof document !== 'undefined' ? document.documentElement.clientWidth : 1024)
  const vh = vhArg ?? (typeof document !== 'undefined' ? document.documentElement.clientHeight : 768)
  let left = rect.left + rect.width / 2 - width / 2
  left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN))
  const spaceBelow = vh - rect.bottom - GAP - MARGIN
  const spaceAbove = rect.top - GAP - MARGIN
  let flip: 'up' | 'down'
  if (contentH <= spaceBelow) flip = 'down'
  else if (contentH <= spaceAbove) flip = 'up'
  else flip = spaceBelow >= spaceAbove ? 'down' : 'up'
  const available = flip === 'down' ? spaceBelow : spaceAbove
  const maxH = Math.max(96, available)
  const top = flip === 'down' ? rect.bottom + GAP : Math.max(MARGIN, rect.top - GAP - Math.min(contentH, maxH))
  return { left, top, width, maxHeight: maxH }
}

function useAnchored(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  popRef: React.RefObject<HTMLElement | null>,
  onLost: () => void,
  max: number,
) {
  const [style, setStyle] = useState<StyleState | null>(null)
  const onLostRef = useRef(onLost)
  onLostRef.current = onLost
  const reposition = useCallback(() => {
    const el = ref.current
    if (!el) return // 挂载前不关（避免首次打开尺寸未稳时自触发关闭）
    if (!el.isConnected) { onLostRef.current(); return }
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) { onLostRef.current(); return }
    const width = measureWidth(document.documentElement.clientWidth, max)
    const contentH = popRef.current?.scrollHeight ?? 200
    const next = place(r, width, contentH)
    setStyle((prev) => (sameStyle(prev, next) ? prev : next))
  }, [ref, popRef, max])
  useLayoutEffect(() => {
    if (!open) { setStyle(null); return }
    reposition()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reposition) : null
    if (ro && popRef.current) ro.observe(popRef.current)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      ro?.disconnect()
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, reposition, popRef])
  return style
}

export function Tooltip({ text, children, className = '', ariaLabel }: { text: string; children: ReactNode; className?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const id = useId()
  const showT = useRef<number | null>(null)
  const hideT = useRef<number | null>(null)
  const close = useCallback(() => { setOpen(false); releaseActive(close) }, [])
  const style = useAnchored(open, ref, popRef, close, 320)

  const scheduleShow = useCallback(() => {
    if (hideT.current) { window.clearTimeout(hideT.current); hideT.current = null }
    showT.current = window.setTimeout(() => { setOpen(true); claimActive(close) }, 250)
  }, [close])
  const scheduleHide = useCallback(() => {
    if (showT.current) { window.clearTimeout(showT.current); showT.current = null }
    hideT.current = window.setTimeout(() => { setOpen(false); releaseActive(close) }, 100)
  }, [close])
  useEffect(() => () => {
    if (showT.current) window.clearTimeout(showT.current)
    if (hideT.current) window.clearTimeout(hideT.current)
  }, [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  return (
    <>
      <button
        type="button"
        ref={ref}
        className={`disc-tip-trigger ${className}`}
        aria-describedby={open ? id : undefined}
        aria-label={ariaLabel ?? text}
        onPointerEnter={scheduleShow}
        onPointerLeave={scheduleHide}
        onFocus={scheduleShow}
        onBlur={scheduleHide}
      >
        {children}
      </button>
      {open && style && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popRef}
              id={id}
              role="tooltip"
              className="disc-tip"
              style={{ left: style.left, top: style.top, width: style.width, maxHeight: style.maxHeight, overflow: 'auto' }}
              onPointerEnter={() => { if (hideT.current) window.clearTimeout(hideT.current) }}
              onPointerLeave={scheduleHide}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

export function Popover({ label, children, ariaLabel, open: openProp, onOpenChange, triggerId }: { label: ReactNode; children: ReactNode; ariaLabel?: string; open?: boolean; onOpenChange?: (o: boolean) => void; triggerId?: string }) {
  const [openLocal, setOpenLocal] = useState(false)
  const open = openProp ?? openLocal
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange
  // 稳定引用：不因 onOpenChange 变而重建，避免 hide/toggle 捕获首轮回调（关了立即重开/旧回调）。
  const setOpen = useCallback((v: boolean) => { setOpenLocal(v); onOpenChangeRef.current?.(v) }, [])
  const ref = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const id = useId()
  // 稳定引用：hide 供 useAnchored/单活动协调复用；closeToTrigger 供 Esc/外点回焦。
  const hide = useCallback(() => { setOpen(false); releaseActive(hide) }, [])
  const closeToTrigger = useCallback(() => { setOpen(false); releaseActive(hide); ref.current?.focus() }, [hide])
  const style = useAnchored(open, ref, popRef, hide, 360)

  const toggle = useCallback(() => {
    if (open) { releaseActive(hide); ref.current?.focus(); setOpen(false) }
    else { claimActive(hide); setOpen(true) }
  }, [open, hide, setOpen])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeToTrigger() }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (ref.current && t && ref.current.contains(t)) return
      if (t && t.closest('.disc-pop')) return
      setOpen(false); releaseActive(hide)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [open, closeToTrigger, hide])

  return (
    <>
      <button
        type="button"
        ref={ref}
        id={triggerId}
        className="disc-pop-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={ariaLabel}
        onClick={toggle}
      >
        {label}
      </button>
      {open && style && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popRef}
              id={id}
              role="dialog"
              className="disc-pop"
              style={{ left: style.left, top: style.top, width: style.width, maxHeight: style.maxHeight, overflow: 'auto' }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
