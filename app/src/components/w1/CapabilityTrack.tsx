/**
 * D08-W1 r02 · CapabilityTrack——能力轨道 + 分类切换（r01 实证四缺陷收口）。
 *
 * r02 修复（实测证据驱动）：
 * - 交叉层局部化：track > stage（position:relative，尺寸由 in 组正常流决定）承载
 *   in/out 同坐标交叉；out 组 absolute 相对 stage——不再相对整页（r01 白帘跨 Hero/R4 根因）。
 * - 真 inert：React 19 boolean `inert={hidden}` 实际输出属性——离场组不可 focus/Enter 触发
 *   （programmatic focus 也被浏览器拒绝），非 tabIndex 替代。
 * - 实宽测量：量 track 自身 clientWidth 减横 padding（r01 误测含两枚 44 nav 的 section）；
 *   nav 移到轨道下方独立行，mobile 不挤轨道——完整首卡 + gap12 + 露约 28。
 * - 选中底板：按真实 tab 元素 offsetLeft/offsetWidth 定位（resize 重测），所有档稳态对齐，
 *   不再用百分比近似（r01 决策/数据/智能档偏移 4.68/9.36/14.04px 根因）。
 * - 快速反向 latest-wins：连点时旧 in 组转为 out，渐出动画从其**当前 computed opacity**
 *   起步（WAAPI 接续，outExitDuration = CROSS_MS × from），多层短暂并存、各自卸载，
 *   终态唯一组；reduce 直接卸载即时切换。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import '../unified/ProductMaterial.css' // D08-r02：显式携带已接受语义 token 依赖（D06 r04 原件，只读）
import {
  CAPABILITY_CATEGORIES,
  capabilitiesForCategory,
  trackMetricsFor,
  type CapabilityCategory,
  type CapabilityItem,
} from './capabilityModel'
import { GlassSurface } from './GlassSurface'
import { Tooltip } from '../ui/Disclosure'
import './CapabilityTrack.css'

const CROSS_MS = 420 // 350–500ms 档

export interface CapabilityTrackProps {
  capabilities: CapabilityItem[]
  /** 真实入口回调（宿主接 onNavigate(actualHash)） */
  onNavigate?: (route: string, item: CapabilityItem) => void
  footnote?: string
  /** 初始分类（默认第一类） */
  initialCategory?: CapabilityCategory
}

const STATE_LABEL: Record<CapabilityItem['state'], string> = {
  available: '已接入',
  unconfigured: '未接通',
  unavailable: '不可用',
}

/** 渐出时长按当前视觉权重缩放（WAAPI 从当前 pose 接续的时长合同） */
export function outExitDuration(fromOpacity: number, crossMs = CROSS_MS): number {
  const f = Math.min(1, Math.max(0, fromOpacity))
  return Math.round(crossMs * f)
}

interface OutEntry {
  cat: CapabilityCategory
  id: number
}

/** 渐出组：挂载时从当前 computed opacity 接续渐出（WAAPI），结束由宿主卸载 */
function OutGroup({ cat, items, onDone, renderCard }: {
  cat: CapabilityCategory
  items: CapabilityItem[]
  onDone: (id: string) => void
  renderCard: (item: CapabilityItem, hidden: boolean) => React.ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || typeof el.animate !== 'function') {
      onDone(`${cat}`)
      return
    }
    let from = 1
    try {
      from = parseFloat(getComputedStyle(el).opacity) || 1
    } catch {
      from = 1
    }
    const dur = outExitDuration(from)
    const anim = el.animate([{ opacity: from, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(-14px)' }], {
      duration: dur,
      fill: 'forwards',
      easing: 'cubic-bezier(0.4, 0, 0.1, 1)',
    })
    const t = window.setTimeout(() => onDone(`${cat}`), dur + 16)
    return () => {
      window.clearTimeout(t)
      anim.cancel()
    }
  }, [cat, onDone])
  return (
    <div ref={ref} className="u-w1-cap__group u-w1-cap__group--out" aria-hidden="true" inert data-category={cat}>
      {items.map((i) => renderCard(i, true))}
    </div>
  )
}

export default function CapabilityTrack(props: CapabilityTrackProps) {
  const { capabilities, onNavigate, footnote, initialCategory = CAPABILITY_CATEGORIES[0] } = props
  const [category, setCategory] = useState<CapabilityCategory>(initialCategory)
  const [incoming, setIncoming] = useState<CapabilityCategory>(initialCategory)
  const [outgoing, setOutgoing] = useState<OutEntry[]>([])
  const outNonce = useRef(0)
  const [metrics, setMetrics] = useState(() => trackMetricsFor(1200))
  const trackRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [thumbRect, setThumbRect] = useState<{ left: number; width: number } | null>(null)

  // 实宽测量：track 自身内容宽（减横 padding），不含 nav（nav 已移出轨道行）
  useLayoutEffect(() => {
    const measure = () => {
      const el = trackRef.current
      if (!el) return
      const cs = window.getComputedStyle(el)
      const padH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      setMetrics(trackMetricsFor(el.clientWidth - padH))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const ro = new ResizeObserver(measure)
    if (trackRef.current) ro.observe(trackRef.current)
    return () => ro.disconnect()
  }, [])

  // 选中底板：真实 tab rect（未变换 offsetLeft/Width），稳态对齐 + resize 重测
  const measureThumb = useCallback(() => {
    const idx = CAPABILITY_CATEGORIES.indexOf(category)
    const el = tabRefs.current[idx]
    if (!el) return
    setThumbRect({ left: el.offsetLeft, width: el.offsetWidth })
  }, [category])
  useLayoutEffect(() => {
    measureThumb()
    window.addEventListener('resize', measureThumb)
    return () => window.removeEventListener('resize', measureThumb)
  }, [measureThumb])

  const selectCategory = useCallback(
    (c: CapabilityCategory) => {
      if (c === incoming) return // latest-wins：同目标幂等
      setCategory(c) // 底板目标位（420ms 过渡）
      const id = ++outNonce.current
      setOutgoing((o) => [...o, { cat: incoming, id }]) // 旧组按当前视觉权重渐出（可多层短暂并存）
      setIncoming(c)
    },
    [incoming],
  )
  const removeOut = useCallback((id: string) => {
    setOutgoing((o) => o.filter((x) => `${x.cat}` !== id))
  }, [])

  // 轨道前后按钮（nav 独立行，不占轨道宽）
  const scrollByCard = useCallback(
    (dir: -1 | 1) => {
      const el = trackRef.current
      if (!el) return
      el.scrollBy({ left: dir * (metrics.cardWidth + metrics.gap), behavior: 'smooth' })
    },
    [metrics.cardWidth, metrics.gap],
  )
  const onTrackKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        scrollByCard(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        scrollByCard(-1)
      }
    },
    [scrollByCard],
  )

  const renderItem = (item: CapabilityItem, hidden: boolean) => (
    <GlassSurface
      key={item.id}
      as="article"
      className={`u-w1-cap__card u-w1-cap__card--${item.state}`}
      interactive={!hidden}
      ariaHidden={hidden}
      aria-label={item.title}
      dataAttrs={{ "data-cap-state": item.state }}
    >
      <header className="u-w1-cap__card-head">
        <h4 className="u-w1-cap__card-title">{item.title}</h4>
        <span className={`u-w1-cap__state u-w1-cap__state--${item.state}`}>{STATE_LABEL[item.state]}</span>
      </header>
      <p className="u-w1-cap__card-summary">{item.summary}</p>
      <div className="u-w1-cap__card-foot">
        {item.state === 'available' ? (
          <button
            type="button"
            className="u-w1-cap__open u-glow"
            tabIndex={hidden ? -1 : undefined}
            data-object-id={item.objectId}
            data-route={item.route}
            onClick={() => onNavigate?.(item.route, item)}
          >
            {item.entryLabel ?? '打开'}
          </button>
        ) : (
          <span className="u-w1-cap__no-entry">无入口（未接入）</span>
        )}
      </div>
    </GlassSurface>
  )

  const incomingItems = capabilitiesForCategory(capabilities, incoming)

  return (
    <section ref={rootRef as React.RefObject<HTMLElement>} className="u-w1-cap" aria-label="能力轨道">
      <div className="u-w1-cap__tabs" role="tablist" aria-label="能力分类">
        <span
          className="u-w1-cap__tab-thumb"
          style={
            thumbRect
              ? { transform: `translateX(${thumbRect.left - 4}px)`, width: thumbRect.width }
              : undefined
          }
          aria-hidden="true"
        />
        {CAPABILITY_CATEGORIES.map((c, i) => (
          <button
            key={c}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={category === c}
            className={`u-w1-cap__tab u-glow${category === c ? ' u-w1-cap__tab--on' : ''}`}
            onClick={() => selectCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 轨道全宽（nav 已移到下方独立行）；实宽=track 内容宽 */}
      <div
        ref={trackRef}
        className="u-w1-cap__track"
        tabIndex={0}
        onKeyDown={onTrackKeyDown}
        style={{ ['--w1-card-w' as string]: `${metrics.cardWidth}px`, ['--w1-gap' as string]: `${metrics.gap}px` }}
      >
        {/* stage=共同局部坐标层：in 组正常流决定尺寸，out 组 absolute 同起点交叉，绝不出轨道 */}
        <div className="u-w1-cap__stage">
          {outgoing.map((o) => (
            <OutGroup
              key={o.id}
              cat={o.cat}
              items={capabilitiesForCategory(capabilities, o.cat)}
              onDone={removeOut}
              renderCard={renderItem}
            />
          ))}
          <div className="u-w1-cap__group u-w1-cap__group--in" data-category={incoming}>
            {incomingItems.map((i) => renderItem(i, false))}
          </div>
        </div>
      </div>

      <div className="u-w1-cap__nav-row">
        <button type="button" className="u-w1-cap__nav u-glow" aria-label="上一卡" onClick={() => scrollByCard(-1)}>
          ‹
        </button>
        <span className="u-w1-cap__nav-hint">
          轨道浏览
          <Tooltip text="左右按钮 / 拖动 / 键盘 ←→ 浏览；垂直滚动不受影响">ⓘ</Tooltip>
        </span>
        <button type="button" className="u-w1-cap__nav u-glow" aria-label="下一卡" onClick={() => scrollByCard(1)}>
          ›
        </button>
      </div>
      {footnote ? <p className="u-w1-cap__footnote">{footnote}</p> : null}
    </section>
  )
}
