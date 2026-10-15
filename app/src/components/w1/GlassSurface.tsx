/**
 * D09 r04 · CTA-PASSPORT 六层玻璃（光感交互 v2：全局单源光标）。
 * 规格来源 /workspace/CTA-PASSPORT-DESIGN.md（材质/几何/四路交互不变）；
 * L5 指针高光改为**全局连续光标**驱动：
 *   - 光点一直跟随鼠标（页面级单源，cursor.ts 单例阻尼循环）；
 *   - 卡片 pointerenter→点亮（位置=全局坐标映射到自身盒，**无起点跳变**）；
 *     pointerleave→隐没（不重置位置）；切卡无缝交接；
 *   - 零 setState（直写 --gx/--gy）；reduce 直落；触屏不点亮（CSS 同时隐藏）。
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { subscribeCursor } from './cursor'
import './GlassSurface.css'

export function dampStep(current: number, target: number, k = 0.16): number {
  return current + (target - current) * k
}

export interface GlassSurfaceProps {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'article'
  interactive?: boolean
  ariaLabel?: string
  innerRef?: React.RefObject<HTMLElement | null>
  dataAttrs?: Record<string, string>
  ariaHidden?: boolean
}

export function GlassSurface({ children, className = '', as = 'div', interactive = true, ariaLabel, innerRef, dataAttrs, ariaHidden }: GlassSurfaceProps) {
  const ref = useRef<HTMLElement | null>(null)
  const elRef = useCallback((el: HTMLElement | null) => {
    ref.current = el
    if (innerRef) (innerRef as React.MutableRefObject<HTMLElement | null>).current = el
  }, [innerRef])

  // 全局光标→自身盒百分比（连续映射；enter/leave 只切 u-glass--lit）
  useEffect(() => {
    if (!interactive) return
    const el = ref.current
    if (!el) return
    const unsub = subscribeCursor((cx, cy) => {
      const target = ref.current
      if (!target) return
      const rect = target.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      target.style.setProperty('--gx', `${(((cx - rect.left) / rect.width) * 100).toFixed(2)}%`)
      target.style.setProperty('--gy', `${(((cy - rect.top) / rect.height) * 100).toFixed(2)}%`)
    })
    return unsub
  }, [interactive])

  const onEnter = useCallback(() => {
    ref.current?.classList.add('u-glass--lit')
  }, [])
  const onLeave = useCallback(() => {
    ref.current?.classList.remove('u-glass--lit')
  }, [])

  const Tag = as as 'div'
  return (
    <Tag
      ref={elRef}
      className={`u-glass ${className}`}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden || undefined}
      {...dataAttrs}
      onPointerEnter={interactive ? onEnter : undefined}
      onPointerLeave={interactive ? onLeave : undefined}
    >
      {children}
    </Tag>
  )
}

export interface GlassButtonProps {
  children: ReactNode
  onClick?: () => void
  tone?: 'glass' | 'primary'
  size?: 'md' | 'lg'
  ariaLabel?: string
  className?: string
}

export function GlassButton({ children, onClick, tone = 'glass', size = 'md', ariaLabel, className = '' }: GlassButtonProps) {
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (tone !== 'glass') return
    const el = ref.current
    if (!el) return
    const unsub = subscribeCursor((cx, cy) => {
      const target = ref.current
      if (!target) return
      const rect = target.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      target.style.setProperty('--gx', `${(((cx - rect.left) / rect.width) * 100).toFixed(2)}%`)
      target.style.setProperty('--gy', `${(((cy - rect.top) / rect.height) * 100).toFixed(2)}%`)
    })
    return unsub
  }, [tone])

  const onEnter = useCallback(() => {
    ref.current?.classList.add('u-glass--lit')
  }, [])
  const onLeave = useCallback(() => {
    ref.current?.classList.remove('u-glass--lit')
  }, [])

  if (tone === 'primary') {
    return (
      <button type="button" className={`u-cta-primary ${size === 'lg' ? 'u-cta-lg' : ''} ${className}`} aria-label={ariaLabel} onClick={onClick}>
        {children}
      </button>
    )
  }
  return (
    <button
      ref={ref as React.RefObject<HTMLButtonElement>}
      type="button"
      className={`u-cta-glass ${size === 'lg' ? 'u-cta-lg' : ''} ${className}`}
      aria-label={ariaLabel}
      onClick={onClick}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {children}
    </button>
  )
}
