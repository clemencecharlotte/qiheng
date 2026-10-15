import { useEffect, type RefObject } from 'react'

/**
 * 可逆入场（2026-10-06 采用支线 extended-branch-20261006 同步的技术）。
 *
 * 目标：入场不是"一次性事件"，而是"元素在视口中的位置"的纯函数 ——
 *   下滚推进 / 上滚回退 / 再下滚重播；同一 scrollY ⇒ 同一状态（与方向无关）；
 *   视口外不提前点亮；reduced-motion 与无 observer 时一律常显（内容永远可读）。
 *
 * 两层（正交）：
 *   ① 首选 CSS 滚动驱动：`animation-timeline: view()`（进度由位置决定，天然可逆）；
 *      JS 只探测支持并打 `html.rv-timeline`，不参与计时。
 *   ② 退化：双向幂等 JS —— 入场阈值 88%vh；元素**整块退回视口下方**后重新武装，
 *      下次下滚重新播放。没有 unobserve、没有 setInterval、没有 setTimeout(showAll)。
 *
 * 状态统一写进 CSS 变量 `--rv-on`（见 welcome.css），这样 Process 舞台这类
 * "也想要 opacity" 的第二个系统可以用乘法叠加，不会与入场抢同一个属性。
 */
export default function useReveal(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.rv'))
    if (!targets.length) return

    // 声明 JS 已挂载：只有此时 CSS 才隐藏待入场元素；脚本未运行则直接可见。
    root.classList.add('qh-js')

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

    const showAll = (reason: string) => {
      targets.forEach((t) => {
        t.classList.remove('pre')
        t.classList.add('in')
      })
      root.dispatchEvent(new CustomEvent('qiheng:reveal', { detail: { reason } }))
    }

    const hasTimeline =
      typeof window.CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('animation-timeline: view()')

    /* 2026-10-06 实测修正：**默认不用**滚动驱动时间线。
       原因（用户反馈"上滑没有正确的渐变消失或出现显示"，已复现）：
       时间线的进度 = 元素视口位置，于是用户一停手，动画就**冻结在中途** ——
       实测停在 y=1000/3000/4400/4600/4900 时，屏内分别有 5/3/2/3/3 个元素的
       opacity 卡在 0.17–0.95（CTA 按钮 0.379、Process 步骤 0.2–0.9），等 1.6s
       也不收敛：正文半透明、看不清 = "没有正确出现"。
       改用「按位置触发、按时间播完」的类切换：状态仍是位置的纯函数（可逆、可重播、
       同一 scrollY 同一状态），但动画由 0.6s transition 播完，**必定收敛到
       全显示或全隐藏**，不会卡在中间。
       时间线实现保留在 CSS 里（html.rv-timeline），需要时用 `?reveal=timeline` 打开做对照。 */
    const wantTimeline =
      hasTimeline && /(?:^|[?&])reveal=timeline(?:&|$)/.test(window.location.search)

    let raf = 0
    let onViewportChange: (() => void) | null = null
    let measureObserver: ResizeObserver | null = null

    if (reduce.matches || typeof IntersectionObserver === 'undefined') {
      /* 底线：内容永远可读（reduced-motion / 老内核直接常显） */
      showAll(reduce.matches ? 'reduced-motion' : 'no-observer')
    } else if (wantTimeline) {
      document.documentElement.classList.add('rv-timeline')
      root.dispatchEvent(new CustomEvent('qiheng:reveal', { detail: { reason: 'view-timeline' } }))
    } else {
      /* 默认路径：双向幂等 —— 状态只由**元素在视口中的位置**决定，
         动画交给 0.6s 的 CSS transition 播完，因此不会停在半透明。
         可见窗口：
           · 入场线 ENTER(88%vh)：下滚时顶部越过它 → 渐显（出现）
           · 离场线 EXIT(10%vh) ：继续下滚、元素**底边**升到视口顶边附近 → 渐隐（消失）
           上滚完全对称（同一条线，方向无关）→ 同一 scrollY ⇒ 同一状态。
         2026-10-06 用户先要求补上"往下滑时上半区内容逐渐消失"，
         随后反馈"消失的范围有点大了，信息没看完就消失了" —— 因此离场线从 30%vh
         压到 10%vh：**只有基本滑到顶边的内容才淡出**，中上部仍可正常阅读。
         （想更晚消失就把 EXIT_RATIO 继续调小；0 = 完全移出视口才淡出。）
         两处豁免（否则会误伤）：
           · .qh-hero（首屏开场）：其中的元素在加载时就位于屏幕上方，
             用离场线会在 y=0 就把它们判成"已到顶边"而藏起来；
           · #qh-process（粘性舞台）：步骤被钉在视口顶部，底边天然落在顶部带里，
             用离场线会把舞台内容淡掉。
         这两处仍按"越进入场线即显示"的老规则。 */
      const ENTER_RATIO = 0.88 /* 底部入场线 */
      const EXIT_RATIO = 0.10 /* 顶部离场线（元素底边升过此线即淡出） */
      const REVEAL_SHIFT = 18 /* 与 CSS 里 translateY(calc((1 - var(--rv-on)) * 18px)) 保持一致 */

      const isExempt = (el: HTMLElement) =>
        !!el.closest('.qh-hero') || !!el.closest('#qh-process')

      const apply = () => {
        raf = 0
        const vh = window.innerHeight || 1
        const enterLine = vh * ENTER_RATIO
        const exitLine = vh * EXIT_RATIO
        for (const el of targets) {
          const r = el.getBoundingClientRect()
          /* 已入场 ⇒ 位移 0；未入场 ⇒ 位移 +18px。扣掉它，判据只反映"布局位置" */
          const shift = el.classList.contains('in') ? 0 : REVEAL_SHIFT
          const top = r.top - shift
          const bottom = r.bottom - shift
          const inBand = top < enterLine && bottom > 0
          const visible = inBand && (isExempt(el) || bottom > exitLine)
          if (visible) {
            el.classList.remove('pre')
            el.classList.add('in')
          } else if (el.classList.contains('in')) {
            el.classList.add('pre')
            el.classList.remove('in')
          }
        }
      }
      const request = () => {
        if (!raf) raf = window.requestAnimationFrame(apply)
      }

      targets.forEach((t) => t.classList.add('pre'))
      onViewportChange = request
      window.addEventListener('scroll', request, { passive: true })
      window.addEventListener('resize', request, { passive: true })
      if (typeof ResizeObserver !== 'undefined') {
        measureObserver = new ResizeObserver(() => request())
        measureObserver.observe(root)
      }
      if (document.fonts?.ready?.then) document.fonts.ready.then(() => request())
      request()
    }

    const onReduce = (e: MediaQueryListEvent) => {
      if (e.matches) showAll('reduced-motion')
    }
    reduce.addEventListener?.('change', onReduce)

    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      if (onViewportChange) {
        window.removeEventListener('scroll', onViewportChange)
        window.removeEventListener('resize', onViewportChange)
      }
      measureObserver?.disconnect()
      reduce.removeEventListener?.('change', onReduce)
      document.documentElement.classList.remove('rv-timeline')
      root.classList.remove('qh-js', 'qh-measure')
    }
  }, [rootRef])
}