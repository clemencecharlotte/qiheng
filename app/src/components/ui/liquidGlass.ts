/**
 * M13 · 液态玻璃指针高光控制器（全局单例，阻尼跟随）。
 * 规格：CtaPassport v1（L5 指针高光，rAF 阻尼 0.16；离开阻尼归中；仅 mouse；
 * reduce 不启动；连续跟随=“慢速光追感”）。对任意匹配元素写 --gx/--gy（百分比）。
 * 一次安装、单 rAF 循环、静止自停；卸载即撤监听与帧。
 */
export const GLASS_SELECTOR = [
  '.lg-glass',
  '.lg-btn',
  '.app-shell .panel',
  '.app-shell .overview-main > section',
  '.topbar-modal',
  '.appearance-scene-pop',
  '.u-dialog',
  '.qh-relations',
  '.qh-data-ingress',
  '.qh-gov-events',
].join(',')

export function installLiquidGlass(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const reduce = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let active: HTMLElement | null = null
  let curX = 50, curY = 50, tx = 50, ty = 50
  let raf = 0

  const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0 } }
  const tick = () => {
    raf = 0
    if (!active) return
    curX += (tx - curX) * 0.16
    curY += (ty - curY) * 0.16
    active.style.setProperty('--gx', `${curX.toFixed(2)}%`)
    active.style.setProperty('--gy', `${curY.toFixed(2)}%`)
    if (Math.abs(curX - tx) > 0.2 || Math.abs(curY - ty) > 0.2) {
      raf = requestAnimationFrame(tick)
    }
  }
  const ensure = () => { if (!raf && active) raf = requestAnimationFrame(tick) }
  const centerOf = (el: HTMLElement) => { el.style.setProperty('--gx', '50%'); el.style.setProperty('--gy', '50%') }

  const onMove = (e: PointerEvent) => {
    if (e.pointerType && e.pointerType !== 'mouse') return
    if (reduce) return
    const el = (e.target as Element | null)?.closest?.(GLASS_SELECTOR) as HTMLElement | null
    if (el !== active) {
      if (active) centerOf(active)
      active = el
      curX = curY = tx = ty = 50
      if (active) centerOf(active)
    }
    if (!active) return
    const r = active.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      tx = ((e.clientX - r.left) / r.width) * 100
      ty = ((e.clientY - r.top) / r.height) * 100
      ensure()
    }
  }
  const onOut = (e: PointerEvent) => {
    if (!active) return
    const to = e.relatedTarget as Node | null
    if (to && active.contains(to)) return
    tx = 50; ty = 50
    ensure()
  }

  document.addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('pointerout', onOut, true)
  return () => {
    stop()
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerout', onOut, true)
    if (active) centerOf(active)
    active = null
  }
}
