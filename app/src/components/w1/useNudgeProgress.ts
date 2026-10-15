/**
 * D08-W1 · R4 ReversibleNudge——左下轻推（viewport progress 连续、双向同路径）。
 *
 * 合同（S1-R1 R4 / 02-addendum / SHARED-CONTRACT）：
 * - progress = 模块与视口相对位置，clamp [0,1]，rAF 更新（滚动叙事由进度驱动，
 *   无固定时长动画队列、无 once/revealed 永久锁）。
 * - 单一 transform 驱动（--w1-nudge-p 一个变量写 translate/rotate/scale），与既有
 *   .rv 入场/scrollspy/锚点不共用属性；上滚沿同路径回退——同 scroll 值恒同姿态。
 * - 桌面初值 translate(-24px,32px) rotateZ(-1deg) scale(.985) → 本位；mobile 幅度减半
 *   (-12px,16px)；opacity 只辅助（0.55→1）。
 * - reduce=直接本位（无位移无旋转）；隐藏区不交互（组件在 progress<0.05 时
 *   pointer-events 仍由宿主内容决定——本 hook 只写外观变量，不干预布局）。
 * - 姿态为 progress 的纯函数：A→B→C→B→A 任意往返，同位置同姿态。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export function nudgePose(p: number, mobile: boolean): { x: number; y: number; rot: number; scale: number; opacity: number } {
  const c = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0))
  const k = 1 - c // 0=本位, 1=完全偏移
  const ax = mobile ? -12 : -24
  const ay = mobile ? 16 : 32
  return {
    x: ax * k + 0, // +0 归一（-0 严格比较）
    y: ay * k + 0,
    rot: (mobile ? -0.5 : -1) * k + 0,
    scale: 1 - 0.015 * k,
    opacity: 1 - 0.45 * k,
  }
}

/** 模块相对视口的连续 progress：模块顶从视口 88% 进入 → 模块顶到 30% 时完成 */
export function viewportProgress(rect: DOMRect, vh: number): number {
  if (vh <= 0) return 0
  const start = vh * 0.88 // 模块顶到达此线时 p=0
  const end = vh * 0.3 // 模块顶到达此线时 p=1
  const top = rect.top
  const p = (start - top) / (start - end)
  return Math.min(1, Math.max(0, p))
}

export interface NudgeOptions {
  /** 移动幅度减半断点（默认 ≤640px） */
  mobileQuery?: string
  /** 关闭（reduce 由组件自动处理；此开关供宿主显式停用） */
  disabled?: boolean
}

export function useNudgeProgress<T extends HTMLElement>(options: NudgeOptions = {}) {
  const { mobileQuery = '(max-width: 640px)', disabled = false } = options
  const ref = useRef<T | null>(null)
  const [progress, setProgress] = useState(0)
  const [mobile, setMobile] = useState(false)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    const mq = window.matchMedia(mobileQuery)
    const onMq = () => setMobile(mq.matches)
    onMq()
    mq.addEventListener('change', onMq)
    return () => mq.removeEventListener('change', onMq)
  }, [mobileQuery])

  const sample = useCallback(() => {
    raf.current = null
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const p = disabled ? 1 : viewportProgress(rect, window.innerHeight)
    setProgress((prev) => (prev === p ? prev : p))
  }, [disabled])

  const schedule = useCallback(() => {
    if (raf.current === null) raf.current = requestAnimationFrame(sample)
  }, [sample])

  useEffect(() => {
    schedule()
    // 滚动/resize 只标记脏并 rAF 采样（进度驱动，无定时器模拟）
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (raf.current !== null) cancelAnimationFrame(raf.current)
      raf.current = null
    }
  }, [schedule])

  const pose = nudgePose(progress, mobile)
  return { ref, progress, pose, mobile }
}
