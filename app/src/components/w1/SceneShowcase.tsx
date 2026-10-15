/**
 * D08-W1 r06 · SceneShowcase——主体浮层（合成器/变量路径，零逐帧 re-render）。
 *
 * r06 闪屏修复（与 SceneBackdrop 同思路）：
 * - chase 回调式（useSceneChase）：每帧 onFrame 直写容器 CSS 变量
 *   （--w1-core-hi/core-lo/flow/ink/ink-muted/accent/dx/dy），**零 setState**——
 *   SVG/文字颜色由 CSS `stroke/fill: var(...)` 级联，重绘面积仅限展台内部；
 * - 指针阻尼同样直写变量（r03 的每帧 setDamp 整树重渲已移除）；
 * - env 名称播报为唯一低频 state（仅跨档过半时变化，~秒级）；
 * - reduce/离屏/hidden：资格回收（r02 合同），变量即时到位。
 * 几何跨态稳定合同不变（同一 SVG 实例）；触达 44；不碰 field-engine。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { clampScenePosition, interpolateEnv, useSceneChase } from './scenePalette'
import SceneDial from './SceneDial'
import '../unified/ProductMaterial.css' // 已接受语义 token 依赖（D06 r04 原件，只读）
import './SceneShowcase.css'

export interface SceneShowcaseProps {
  /** 外观滑动值 [0,5]（宿主受控 target；内部 chase 到 visual） */
  scenePosition: number
  onScenePositionChange?: (v: number) => void
  title?: string
  subtitle?: string
  actions?: Array<{ label: string; onAction: () => void; kind?: 'primary' | 'ghost' }>
  footnote?: string
  /** 指针微光（默认开；reduce/离屏自动关） */
  pointerGlow?: boolean
  /** r05：滑杆控制区显隐（仅臻彩显示） */
  showControls?: boolean
}

/** 太阳轨迹（与 SceneBackdrop 同源公式；光斑层位置由 backdrop 承担，
 *  此处仅用于 SVG 主体辉光强度） */
export function sceneGlowStrength(visual: number): number {
  const warm = Math.max(0, 1 - Math.abs(visual - 1.2) / 2.6)
  const cool = Math.max(0, 1 - Math.abs(visual - 5) / 1.6)
  return Math.max(0.25, Math.min(1, 0.4 + 0.6 * Math.max(warm, cool)))
}

/** 原创气流环/供气汇流芯（几何静态；颜色全部走 CSS var） */
function CoreSvg() {
  return (
    <svg
      className="u-w1-scene__svg"
      viewBox="0 0 420 300"
      role="img"
      aria-label="气流环与供气汇流芯示意（展示外观）"
    >
      <defs>
        <radialGradient id="u-w1-glow" cx="50%" cy="46%" r="60%">
          <stop offset="0%" className="u-w1-scene__glow-stop" stopOpacity="0.55" />
          <stop offset="70%" className="u-w1-scene__glow-stop" stopOpacity="0.12" />
          <stop offset="100%" className="u-w1-scene__glow-stop" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="u-w1-core" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" className="u-w1-scene__hi-stop" />
          <stop offset="100%" className="u-w1-scene__lo-stop" />
        </linearGradient>
      </defs>
      <circle cx="210" cy="146" r="132" fill="url(#u-w1-glow)" />
      <g className="u-w1-scene__drift">
        <circle cx="210" cy="146" r="150" fill="none" stroke="url(#u-w1-core)" strokeWidth="2" />
        <circle cx="210" cy="146" r="112" fill="none" stroke="url(#u-w1-core)" strokeWidth="1.5" strokeDasharray="6 10" className="u-w1-scene__arc" style={{ animationDuration: '26s' }} />
        <circle cx="210" cy="146" r="74" fill="none" stroke="url(#u-w1-core)" strokeWidth="1.2" />
        <path d="M52 168 C 128 128, 292 128, 368 168" fill="none" stroke="url(#u-w1-core)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M78 186 C 140 158, 280 158, 342 186" fill="none" className="u-w1-scene__lo-stroke" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        <circle cx="210" cy="150" r="26" fill="none" className="u-w1-scene__hi-stroke" strokeWidth="2" />
        <circle cx="210" cy="150" r="9" className="u-w1-scene__hi-fill" opacity="0.85" />
        <circle className="u-w1-scene__flow u-w1-scene__flow--a" r="3" />
        <circle className="u-w1-scene__flow u-w1-scene__flow--b" r="2.4" />
        <circle className="u-w1-scene__flow u-w1-scene__flow--c" r="2" />
      </g>
    </svg>
  )
}

export default function SceneShowcase(props: SceneShowcaseProps) {
  const { scenePosition, onScenePositionChange, title, subtitle, actions, footnote, pointerGlow = true, showControls = true } = props
  const target = clampScenePosition(scenePosition)

  const rootRef = useRef<HTMLElement | null>(null)
  const [envName, setEnvName] = useState(() => interpolateEnv(target).name)
  const [inView, setInView] = useState(true)
  const [docHidden, setDocHidden] = useState(false)
  const [reduce, setReduce] = useState(false)
  const animate = !reduce && inView && !docHidden && pointerGlow
  const animateRef = useRef(animate)
  animateRef.current = animate

  // 资格探测（r02 合同）
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMq = () => setReduce(mq.matches)
    onMq()
    mq.addEventListener('change', onMq)
    return () => mq.removeEventListener('change', onMq)
  }, [])
  useEffect(() => {
    const onVis = () => setDocHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => setInView(es[0]?.isIntersecting ?? true))
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // chase 回调：直写 CSS 变量（零 setState）；env 名仅跨档过半时 setState（低频）
  useSceneChase(target, (visual) => {
    const el = rootRef.current
    if (el) {
      const env = interpolateEnv(visual)
      el.style.setProperty('--w1-ink', env.ink)
      el.style.setProperty('--w1-ink-muted', env.inkMuted)
      el.style.setProperty('--w1-accent', env.accent)
      el.style.setProperty('--w1-core-hi', env.coreHi)
      el.style.setProperty('--w1-core-lo', env.coreLo)
      el.style.setProperty('--w1-flow', env.flow)
      el.style.setProperty('--w1-glow-c', env.sunColor)
      el.style.setProperty('--w1-glow-k', sceneGlowStrength(visual).toFixed(3))
    }
    const name = interpolateEnv(visual).name
    setEnvName((prev) => (prev === name ? prev : name))
  }, { enabled: animate })

  // 指针阻尼：目标 ≤6px，rAF 直写 --w1-dx/dy（零 setState）；资格回收回中（r02 合同）
  const dampTarget = useRef({ x: 0, y: 0 })
  const dampCur = useRef({ x: 0, y: 0 })
  const dampRaf = useRef<number | null>(null)
  const dampLoop = useCallback(() => {
    dampCur.current = {
      x: dampCur.current.x + (dampTarget.current.x - dampCur.current.x) * 0.12,
      y: dampCur.current.y + (dampTarget.current.y - dampCur.current.y) * 0.12,
    }
    const el = rootRef.current
    if (el) {
      el.style.setProperty('--w1-dx', `${dampCur.current.x.toFixed(2)}px`)
      el.style.setProperty('--w1-dy', `${dampCur.current.y.toFixed(2)}px`)
    }
    const settled =
      Math.abs(dampCur.current.x - dampTarget.current.x) < 0.05 &&
      Math.abs(dampCur.current.y - dampTarget.current.y) < 0.05
    if (settled) {
      dampRaf.current = null
      return
    }
    dampRaf.current = requestAnimationFrame(dampLoop)
  }, [])
  useEffect(() => {
    if (animate) return
    dampTarget.current = { x: 0, y: 0 }
    dampCur.current = { x: 0, y: 0 }
    if (dampRaf.current !== null) {
      cancelAnimationFrame(dampRaf.current)
      dampRaf.current = null
    }
    const el = rootRef.current
    if (el) {
      el.style.setProperty('--w1-dx', '0px')
      el.style.setProperty('--w1-dy', '0px')
    }
  }, [animate])
  useEffect(
    () => () => {
      if (dampRaf.current !== null) cancelAnimationFrame(dampRaf.current)
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!animateRef.current) return
      const rect = e.currentTarget.getBoundingClientRect()
      const nx = (e.clientX - rect.left) / rect.width - 0.5
      const ny = (e.clientY - rect.top) / rect.height - 0.5
      dampTarget.current = { x: Math.max(-6, Math.min(6, nx * 12)), y: Math.max(-6, Math.min(6, ny * 12)) }
      if (dampRaf.current === null) dampRaf.current = requestAnimationFrame(dampLoop)
    },
    [dampLoop],
  )
  const onPointerLeave = useCallback(() => {
    dampTarget.current = { x: 0, y: 0 }
    if (dampRaf.current === null && animateRef.current) dampRaf.current = requestAnimationFrame(dampLoop)
  }, [dampLoop])

  const setPos = (v: number) => onScenePositionChange?.(clampScenePosition(v))

  return (
    <section
      ref={rootRef}
      className="u-w1-scene"
      data-scene-id={interpolateEnv(target).id}
      aria-label="产品体验展台（六环境展示外观）"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <div className="u-w1-scene__canvas">
        <CoreSvg />
        <div className="u-w1-scene__copy">
          {title ? <h3 className="u-w1-scene__title">{title}</h3> : null}
          {subtitle ? <p className="u-w1-scene__subtitle">{subtitle}</p> : null}
          {actions && actions.length > 0 ? (
            <div className="u-w1-scene__actions">
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={`u-w1-scene__cta u-glow u-${a.kind === 'ghost' ? 'cta-glass' : 'cta-primary'}`}
                  onClick={a.onAction}
                >
                  {a.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* D09 · 环境名播报独立于滑杆（滑杆收束到外观弹层后展示不丢） */}
      <span className="u-w1-scene__env-live" aria-live="polite">
        当前环境：{envName}
      </span>

      {showControls ? (
        <div className="u-w1-scene__controls">
          <SceneDial value={target} onChange={setPos} />
        </div>
      ) : null}
      {footnote ? <p className="u-w1-scene__footnote">{footnote}</p> : null}
    </section>
  )
}
