import { useCallback, useRef } from 'react'
import type { PointerEvent } from 'react'

/**
 * 在设备舞台上提供柔和的局部光感。只在指针移动时通过 requestAnimationFrame
 * 节流更新 CSS 变量，不改变任何数据或业务状态；离开舞台即清除。
 */
export function usePointerGlow<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const frame = useRef<number | null>(null)
  const point = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const clear = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    const node = ref.current
    if (!node) return
    node.style.removeProperty('--glow-x')
    node.style.removeProperty('--glow-y')
    node.removeAttribute('data-glow')
  }, [])

  const onPointerMove = useCallback((event: PointerEvent) => {
    const node = ref.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    point.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    node.setAttribute('data-glow', 'on')
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const target = ref.current
      if (!target) return
      target.style.setProperty('--glow-x', `${point.current.x}px`)
      target.style.setProperty('--glow-y', `${point.current.y}px`)
    })
  }, [])

  return { ref, onPointerMove, onPointerLeave: clear }
}