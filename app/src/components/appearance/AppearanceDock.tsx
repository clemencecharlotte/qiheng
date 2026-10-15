import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SCENE_ENVS, clampScenePosition } from '../w1/scenePalette'
import { type AppearanceMode } from './appearanceState'
import { chooseReturnFocus } from './focusReturn'
import { computeAnchoredPlacement } from './placement'
import './appearance.css'

/**
 * M16 r01 · 外观模式控制（宿主受控 state）。
 * 三段：外观模式(system/day/night/vivid) / 环境[0,5] / 玻璃[0,1 连续 0–100% 步长0.01，六材质锚点插值不硬档]。
 * 单入口胶囊 + 局部非模态浮层（portal 锚定）；Esc/外点回本次入口；内部键盘等价。
 */
const clampScene = (v: number) => clampScenePosition(v)
const sceneName = (pos: number) => SCENE_ENVS[Math.round(clampScenePosition(pos))]?.name ?? ''

const MODE_OPTIONS: Array<{ id: AppearanceMode; label: string }> = [
  { id: 'system', label: '跟随系统' },
  { id: 'day', label: '日间' },
  { id: 'night', label: '夜间' },
  { id: 'vivid', label: '臻彩' },
]

function OutlineEarth() {
  return (
    <svg className="asp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 12h17M12 3.2c2.6 2.4 2.6 15.2 0 17.6M12 3.2c-2.6 2.4-2.6 15.2 0 17.6" />
    </svg>
  )
}
function CartoonEarth() {
  return (
    <svg className="asp-ico" viewBox="0 0 24 24" aria-hidden="true">
      <defs><linearGradient id="qhEarth" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3ea0ff" /><stop offset="1" stopColor="#2e7d32" /></linearGradient></defs>
      <circle cx="12" cy="12" r="9" fill="url(#qhEarth)" />
      <path d="M5 9.5c2 .4 3.6-.6 5 0s2.4 2.4 4 2.4 2.6-1 4-.6" fill="none" stroke="#bfe6c2" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M6.5 15.5c1.6-.6 3 .6 4.6.4s2.8-1.8 4.4-1.4" fill="none" stroke="#bfe6c2" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}
function ResetIcon() {
  return (
    <svg className="asp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 5v4h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function SunIcon({ night }: { night: boolean }) {
  if (night) {
    return (
      <svg className="asp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M20 14.2A8.2 8.2 0 1 1 9.8 4a6.6 6.6 0 0 0 10.2 10.2Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg className="asp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" strokeLinecap="round" />
    </svg>
  )
}

interface Props {
  environmentPosition: number
  onEnvironmentPositionChange: (v: number) => void
  glassIntensity: number
  onGlassIntensityChange: (v: number) => void
  appearanceMode: AppearanceMode
  onAppearanceModeChange: (m: AppearanceMode) => void
  followLocalTime: boolean
  onFollowLocalTimeChange: (v: boolean) => void
  onReset: () => void
  /** 宿主材质 token（cg/qh-glass 系）：portal 到 body 不继承，显式带回本次浮层。 */
  materialVars?: React.CSSProperties
  /** 序幕：只保顶部唯一外观按钮——隐藏本控制器胶囊，仅保留浮层，由外部事件(detail.origin)打开。 */
  triggerHidden?: boolean
}

export default function AppearanceDock({
  environmentPosition,
  onEnvironmentPositionChange,
  glassIntensity,
  onGlassIntensityChange,
  appearanceMode,
  onAppearanceModeChange,
  followLocalTime,
  onFollowLocalTimeChange,
  onReset,
  materialVars,
  triggerHidden = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number; needsScroll: boolean } | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const pendingReturnRef = useRef(false)

  const place = () => {
    const t = btnRef.current ?? returnFocusRef.current
    const p = popRef.current
    if (!t || !p) return
    const r = t.getBoundingClientRect()
    const contentH = Math.max(p.scrollHeight, p.firstElementChild ? (p.firstElementChild as HTMLElement).scrollHeight : 0)
    const res = computeAnchoredPlacement({ left: r.left, top: r.top, bottom: r.bottom }, contentH, { width: window.innerWidth, height: window.innerHeight })
    setPos({ left: res.left, top: res.top, width: res.width, maxHeight: res.maxHeight, needsScroll: res.needsScroll })
  }

  const openDock = (origin?: HTMLElement | null) => {
    returnFocusRef.current = origin ?? btnRef.current
    pendingReturnRef.current = false
    setOpen(true)
  }
  const closeDock = () => {
    pendingReturnRef.current = true
    setOpen(false)
  }

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail as { origin?: HTMLElement } | undefined
      returnFocusRef.current = d?.origin ?? btnRef.current
      pendingReturnRef.current = false
      setOpen(true)
    }
    window.addEventListener('qh:appearance-open', onOpen)
    return () => window.removeEventListener('qh:appearance-open', onOpen)
  }, [])

  useLayoutEffect(() => {
    if (open || !pendingReturnRef.current) return
    pendingReturnRef.current = false
    const cand = (el: HTMLElement | null) => el ? { isConnected: el.isConnected, focusable: typeof el.focus === 'function' && (el.offsetParent !== null || el.getClientRects().length > 0) } : null
    const fbEl = document.querySelector<HTMLElement>('[data-qh-focus-fallback]')
    const kind = chooseReturnFocus(cand(returnFocusRef.current), cand(fbEl))
    if (kind === 'trigger') returnFocusRef.current!.focus({ preventScroll: true })
    else if (kind === 'fallback') fbEl!.focus({ preventScroll: true })
    else if (rootRef.current) { rootRef.current.tabIndex = -1; rootRef.current.focus({ preventScroll: true }) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      const n = e.target as Node
      if (!((rootRef.current && rootRef.current.contains(n)) || (popRef.current && popRef.current.contains(n)))) closeDock()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); closeDock() } }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDocDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  const modeIdx = Math.max(0, MODE_OPTIONS.findIndex((o) => o.id === appearanceMode))
  const modeLabel = MODE_OPTIONS[modeIdx]?.label ?? '跟随系统'
  const glassPct = Math.round(glassIntensity * 100)

  // 玻璃键盘等价：Arrow ±1%(0.01)、Page ±10%(0.1)、Home/End。
  const onGlassKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = glassIntensity + 0.01
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = glassIntensity - 0.01
    else if (e.key === 'PageUp') next = glassIntensity + 0.1
    else if (e.key === 'PageDown') next = glassIntensity - 0.1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = 1
    if (next !== null) { e.preventDefault(); onGlassIntensityChange(Math.min(1, Math.max(0, Number(next.toFixed(2))))) }
  }

  return (
    <div className={`appearance-scene-ctl${triggerHidden ? ' is-controller' : ''}`} ref={rootRef}>
      {triggerHidden ? null : (
      <div className="appearance-scene-ctl-btns">
        <button
          type="button"
          ref={btnRef}
          className={`appearance-scene-trigger${open ? ' on' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => (open ? closeDock() : openDock())}
          data-testid="appearance-open"
          title="外观：模式 / 环境 / 玻璃"
        >
          <SunIcon night={appearanceMode === 'night' || appearanceMode === 'vivid'} />
          <span className="asc-label" data-testid="appearance-scene-name">{followLocalTime ? `随本地 · ${sceneName(environmentPosition)}` : sceneName(environmentPosition)}</span>
        </button>
      </div>
      )}

      {open ? createPortal(
        <div
          className="appearance-scene-pop"
          role="dialog"
          aria-label="外观"
          data-testid="appearance-pop"
          ref={popRef}
          data-glass-intensity={glassIntensity <= 0 ? '0' : 'nz'}
          style={{
            ...(materialVars ?? {}),
            ...(pos
              ? { position: 'fixed', left: pos.left, top: pos.top, right: 'auto', bottom: 'auto', height: 'auto', width: pos.width, maxHeight: pos.maxHeight, overflowY: pos.needsScroll ? 'auto' : 'visible' }
              : { position: 'fixed', left: 0, top: 0, right: 'auto', bottom: 'auto', height: 'auto', width: 300, visibility: 'hidden' }),
            // g=0：精确实底、无 blur（不参与分层；不改 B5 锚点、不把全部强度实底）
            ...(glassIntensity <= 0
              ? { background: 'var(--surface, #fff)', backdropFilter: 'none', WebkitBackdropFilter: 'none' }
              : {}),
          }}
        >
          <div className="asp-head">
            <button type="button" className={`asp-globe${followLocalTime ? ' on' : ''}`} aria-pressed={followLocalTime} aria-label="随本地时间变化" title="随本地时间变化" data-testid="appearance-globe" onClick={() => onFollowLocalTimeChange(!followLocalTime)}>
              {followLocalTime ? <CartoonEarth /> : <OutlineEarth />}
            </button>
            <button type="button" className="asp-reset" aria-label="重置为跟随系统" title="重置为跟随系统" data-testid="appearance-reset" onClick={onReset}>
              <ResetIcon />
            </button>
          </div>

          <div className="asp-row" data-testid="appearance-theme-row">
            <span className="asp-row-label">模式</span>
            <b className="asp-row-name" data-testid="appearance-theme-name">{modeLabel}</b>
            <input className="asp-range" type="range" min={0} max={MODE_OPTIONS.length - 1} step={1} value={modeIdx} aria-label="外观模式" aria-valuetext={modeLabel} onChange={(e) => onAppearanceModeChange(MODE_OPTIONS[Number(e.target.value)].id)} />
            <span className="asp-dots" aria-hidden="true">{MODE_OPTIONS.map((o) => <span key={o.id} className="asp-dot" />)}</span>
          </div>

          <div className="asp-row" data-testid="appearance-scene-row">
            <span className="asp-row-label">环境</span>
            <b className="asp-row-name" data-testid="appearance-scene-popname">{sceneName(environmentPosition)}</b>
            <input className="asp-range" type="range" min={0} max={5} step={0.05} value={clampScene(environmentPosition)} aria-label="环境" aria-valuetext={sceneName(environmentPosition)} disabled={followLocalTime} onChange={(e) => onEnvironmentPositionChange(clampScene(Number(e.target.value)))} />
            <span className="asp-dots" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="asp-dot" />)}</span>
          </div>

          <div className="asp-row" data-testid="appearance-glass-row">
            <span className="asp-row-label">玻璃</span>
            <b className="asp-row-name" data-testid="appearance-glass-name">{glassPct}%</b>
            <input className="asp-range" type="range" min={0} max={1} step={0.01} value={glassIntensity} aria-label="玻璃强度" aria-valuetext={`${glassPct}%`} onKeyDown={onGlassKey} onChange={(e) => onGlassIntensityChange(Math.min(1, Math.max(0, Number(e.target.value))))} />
            <span className="asp-dots" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="asp-dot" />)}</span>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
