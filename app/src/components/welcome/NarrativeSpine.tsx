import { useEffect, useRef, type RefObject } from 'react'
import { buildSpine, spineProgressAt, type AvoidBox, type SpineSeg } from './spineProgress'

type Pt = { x: number; y: number }

const R = 18
const START_GAP = 12

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y) || 1e-9
}
function unit(a: Pt, b: Pt): Pt {
  const d = dist(a, b)
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }
}
function roundedPath(points: Pt[], r: number): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const p0 = points[i - 1]
    const p1 = points[i]
    const p2 = points[i + 1]
    const rr = Math.min(r, dist(p0, p1) / 2, dist(p1, p2) / 2)
    const u1 = unit(p0, p1)
    const u2 = unit(p1, p2)
    const a = { x: p1.x - u1.x * rr, y: p1.y - u1.y * rr }
    const b = { x: p1.x + u2.x * rr, y: p1.y + u2.y * rr }
    d += ` L ${a.x.toFixed(2)} ${a.y.toFixed(2)} Q ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
  }
  const last = points[points.length - 1]
  d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`
  return d
}

/** 会与中央下行段冲突的可见盒（Core 外环/标题/分段控件/能力卡/演示）。 */
const AVOID_SELECTORS = ['.u-w1-scene', '.qh-title', '.qh-w1-caps', '.u-w1-natdemo']

/**
 * M22 · 叙事线（原构图 + 冲突段局部避让）。
 * 保原总体构图（居中 cue、原转折/lane 四步局部关系）；仅根据真实内容盒包络，
 * 在 baseX 穿过的冲突区间做 ≤160px 局部偏移并立即回原线（超出则短段断开），
 * 不再全右轨、不再长横扫。进度按分段弧长 + 55% 阅读线投射（spineProgressAt）。
 */
export default function NarrativeSpine({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const baseRef = useRef<SVGPathElement>(null)
  const progRef = useRef<SVGPathElement>(null)
  const nodeRef = useRef<SVGGElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const svg = svgRef.current
    const base = baseRef.current
    const prog = progRef.current
    const nodeG = nodeRef.current
    if (!root || !svg || !base || !prog || !nodeG) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let raf = 0
    let disposed = false
    let reduced = reduce.matches
    let simplified = false
    let progressLen = 0
    let spineSegs: SpineSeg[] = []
    let nodeDocY: Record<string, number> = {}
    let mainDocTop = 0
    let proc: { top: number; h: number; vh: number; sticky: boolean; start: number; span: number } | null = null
    let cueEl: HTMLElement | null = null
    let cueInner: HTMLElement | null = null
    let trustEl: HTMLElement | null = null
    let stepEls: HTMLElement[] = []
    let lastClientW = document.documentElement.clientWidth

    const build = () => {
      const main = root.querySelector<HTMLElement>('.qh-main')
      if (!main || !svg) return
      root.classList.add('qh-measure')
      try {
        buildGeometry(main, svg)
      } finally {
        root.classList.remove('qh-measure')
      }
    }

    const buildGeometry = (main: HTMLElement, svgEl: SVGSVGElement) => {
      const mr = main.getBoundingClientRect()
      mainDocTop = mr.top + window.scrollY
      const localX = (screenX: number) => screenX - mr.left
      const localY = (screenTop: number) => screenTop - mr.top

      const steps = Array.from(root.querySelectorAll<HTMLElement>('#qh-process .proc-steps > li'))
      const cue = root.querySelector<HTMLElement>('.qh-cue')
      const arrow = root.querySelector<HTMLElement>('.qh-cue-arrow')
      // r45 A5 · 末尾 CTA 大卡删除后，引导线终点重锚到页脚（唯一剩余底部锚点），不留悬空线。
      const ctaRow = root.querySelector<HTMLElement>('.qh-cta-sec .qh-cta-row') ?? root.querySelector<HTMLElement>('.qh-ftr-in')
      const cta = root.querySelector<HTMLElement>('.qh-cta-sec .qh-cta-row .btn') ?? root.querySelector<HTMLElement>('.qh-ftr-in > span') ?? root.querySelector<HTMLElement>('.qh-ftr-in')
      if (!cue || !steps.length || !cta || !ctaRow) return

      svgEl.setAttribute('viewBox', `0 0 ${Math.round(mr.width)} ${Math.round(mr.height)}`)
      svgEl.setAttribute('width', String(Math.round(mr.width)))
      svgEl.setAttribute('height', String(Math.round(mr.height)))

      simplified = window.innerWidth <= 900 || steps.length < 4

      // 起笔锚点：冻结 bob/fade 后取 arrow 中心与静态底。
      let heroX: number
      let cueStaticBottom: number
      const innerEl = root.querySelector<HTMLElement>('.qh-cue-inner')
      if (arrow) {
        const prevAnim = arrow.style.animation
        const prevTransform = arrow.style.transform
        const prevInner = innerEl ? innerEl.style.transform : ''
        try {
          arrow.style.animation = 'none'
          arrow.style.transform = 'none'
          if (innerEl) innerEl.style.transform = 'none'
          void arrow.getBoundingClientRect()
          const ar = arrow.getBoundingClientRect()
          heroX = localX((ar.left + ar.right) / 2)
          cueStaticBottom = ar.bottom - mainDocTop
        } finally {
          arrow.style.animation = prevAnim
          arrow.style.transform = prevTransform
          if (innerEl) innerEl.style.transform = prevInner
        }
      } else {
        const cr = cue.getBoundingClientRect()
        heroX = localX((cr.left + cr.right) / 2)
        cueStaticBottom = cr.bottom - mainDocTop
      }

      // 步骤锚点取自然布局（临时解除 sticky）。
      const stageEl = root.querySelector<HTMLElement>('#qh-process .proc-sticky')
      let stepGeom: { left: number; top: number; height: number }[] = []
      const measureSteps = () => steps.map((el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, height: r.height }
      })
      if (stageEl) {
        const prevPos = stageEl.style.position
        try {
          stageEl.style.position = 'static'
          void stageEl.getBoundingClientRect()
          stepGeom = measureSteps()
        } finally {
          stageEl.style.position = prevPos
        }
      } else {
        stepGeom = measureSteps()
      }
      const first = stepGeom[0]
      // M29 r03 · 4：引导线走右侧安全边界（非历史左轨）；仍避让真实内容盒，不穿主体/控件/末尾 CTA。
      const laneX = Math.max(24, localX(mr.right) - 28)
      const rowRect = ctaRow.getBoundingClientRect()
      const ctaRect = cta.getBoundingClientRect()
      const ctaX = localX(ctaRect.left)
      const ctaY = localY(rowRect.top) - 10

      // 冲突盒（本地坐标）：仅真实内容盒。
      const boxes: AvoidBox[] = []
      for (const sel of AVOID_SELECTORS) {
        root.querySelectorAll<HTMLElement>(sel).forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return
          boxes.push({ left: localX(r.left), right: localX(r.right), top: localY(r.top), bottom: localY(r.bottom) })
        })
      }

      let d = ''
      spineSegs = []
      if (simplified) {
        const startY = localY(first.top) + first.height / 2
        const endY = localY(stepGeom[stepGeom.length - 1].top) + stepGeom[stepGeom.length - 1].height / 2
        d = roundedPath([{ x: laneX, y: startY }, { x: laneX, y: endY }], R)
        spineSegs = buildSpine({ baseX: laneX, startY, turnY: startY, laneX, ctaY: endY, ctaX: laneX }, []).segs
      } else {
        const startY = cueStaticBottom + START_GAP
        const turnY = localY(first.top) - 28
        const { subpaths, segs } = buildSpine({ baseX: heroX, startY, turnY, laneX, ctaY, ctaX }, boxes, { maxOffset: 160, margin: 20 })
        d = subpaths.map((p) => roundedPath(p, R)).join(' ')
        spineSegs = segs
      }

      base.setAttribute('d', d)
      prog.setAttribute('d', d)
      try {
        progressLen = base.getTotalLength()
      } catch {
        progressLen = 0
      }
      prog.style.strokeDasharray = String(progressLen)
      prog.style.strokeDashoffset = String(progressLen)

      nodeG.innerHTML = ''
      nodeDocY = {}
      steps.forEach((_, i) => {
        const g = stepGeom[i]
        const ny = localY(g.top) + g.height / 2
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        c.setAttribute('cx', String(laneX))
        c.setAttribute('cy', String(ny))
        c.setAttribute('r', '4')
        const gg = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        gg.setAttribute('class', 'qh-spine-node')
        gg.setAttribute('data-spine-node', `process-${i + 1}`)
        gg.appendChild(c)
        nodeG.appendChild(gg)
        nodeDocY[`process-${i + 1}`] = mainDocTop + ny
      })

      trustEl = root.querySelector<HTMLElement>('#qh-process')
      stepEls = steps
      if (trustEl) {
        const tr = trustEl.getBoundingClientRect()
        const stage = trustEl.querySelector<HTMLElement>('.proc-sticky')
        const sticky = stage ? getComputedStyle(stage).position === 'sticky' : false
        const stageTop = sticky && stage ? parseFloat(getComputedStyle(stage).top) || 0 : 0
        proc = {
          top: tr.top + window.scrollY,
          h: tr.height,
          vh: window.innerHeight,
          sticky,
          start: tr.top + window.scrollY - stageTop,
          span: sticky && stage ? Math.max(1, tr.height - stage.getBoundingClientRect().height) : tr.height,
        }
      } else {
        proc = null
      }
    }

    const procState = (y: number): { p: number; idx: number } | null => {
      if (!proc || proc.h <= 0) return null
      const p = proc.sticky
        ? (y - proc.start) / proc.span
        : (y + proc.vh * 0.5 - proc.top) / proc.h
      const c = Math.max(0, Math.min(1, p))
      return { p: c, idx: Math.min(3, Math.floor(c * 4)) }
    }

    const apply = (y: number) => {
      const cw = document.documentElement.clientWidth
      if (cw !== lastClientW) {
        lastClientW = cw
        rebuild()
        return
      }
      // 阅读线（局部坐标）= 滚动 + 视口 55% − main 顶。
      const localReadingY = (y + window.innerHeight * 0.55) - mainDocTop
      // r40 ⑤·4：simplified（≤900px 或步骤<4）也走同一进度函数——build 已为其构造
      // 直线 segs，右沿引导线在小屏同样随滚动可逆推进，而不是恒 0。
      const p = spineProgressAt(spineSegs, localReadingY)
      if (progressLen > 0) {
        prog.style.strokeDashoffset = String(progressLen * (1 - p))
      }

      if (cueEl) {
        const fade = Math.max(0, Math.min(1, 1 - y / 60))
        cueEl.style.opacity = String(fade)
        if (cueInner && !reduced) cueInner.style.transform = `translateY(${((1 - fade) * 8).toFixed(2)}px)`
        else if (cueInner) cueInner.style.transform = 'none'
        const away = y >= 80
        cueEl.style.visibility = away ? 'hidden' : 'visible'
        cueEl.setAttribute('data-away', away ? 'true' : 'false')
        cueEl.tabIndex = away ? -1 : 0
      }

      const ps = procState(y)
      const ns = nodeG.querySelectorAll<SVGGElement>('.qh-spine-node')
      ns.forEach((g) => {
        const name = g.getAttribute('data-spine-node') || ''
        let on = false
        // r40 ⑤·4：simplified 下节点同样按 procState 点亮（原来恒灭）。
        if (/^process-[1-4]$/.test(name)) on = ps ? Number(name.slice(8)) - 1 <= ps.idx : false
        else {
          const docY = nodeDocY[name]
          on = docY !== undefined && localReadingY >= docY - mainDocTop
        }
        if (on) g.setAttribute('data-on', '1')
        else g.removeAttribute('data-on')
      })

      if (trustEl && ps) {
        trustEl.setAttribute('data-proc-index', String(ps.idx))
        stepEls.forEach((el, i) => {
          if (i === ps.idx) el.setAttribute('data-active', '1')
          else el.removeAttribute('data-active')
        })
      }
    }

    let pending: number | null = null
    let ticking = false
    const tick = () => {
      ticking = false
      if (pending === null) return
      const y = pending
      pending = null
      apply(y)
    }
    const onScroll = () => {
      pending = window.scrollY || 0
      if (ticking) return
      ticking = true
      raf = requestAnimationFrame(tick)
    }

    const rebuild = () => {
      build()
      apply(window.scrollY || 0)
    }

    cueEl = root.querySelector<HTMLElement>('.qh-cue')
    cueInner = root.querySelector<HTMLElement>('.qh-cue-inner')

    rebuild()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', rebuild, { passive: true })
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      const main = root.querySelector<HTMLElement>('.qh-main')
      if (main) {
        ro = new ResizeObserver(() => rebuild())
        ro.observe(main)
      }
    }
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(() => {
        if (!disposed) rebuild()
      })
    }
    const onReduce = () => {
      reduced = reduce.matches
      rebuild()
    }
    reduce.addEventListener?.('change', onReduce)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', rebuild)
      ro?.disconnect()
      reduce.removeEventListener?.('change', onReduce)
    }
  }, [rootRef])

  return (
    <svg className="qh-spine" ref={svgRef} aria-hidden="true" preserveAspectRatio="none">
      <path className="qh-spine-base" ref={baseRef} />
      <path className="qh-spine-progress" ref={progRef} />
      <g className="qh-spine-nodes" ref={nodeRef} />
    </svg>
  )
}
