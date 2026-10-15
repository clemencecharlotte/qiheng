import type { ReactNode } from 'react'

/**
 * M13 · 全站次级按钮基准（CtaPassport v1，tone=glass）。
 * 六层液态玻璃 + 指针阻尼高光（由全局 installLiquidGlass 写 --gx/--gy）；
 * 44px 触控、四态（hover/active/focus-visible/reduce）、no-blur 实底退化。
 * 主行动请用 .btn.primary（accent 实底，不参与玻璃体系）。
 */
export default function GlassButton({
  children,
  onClick,
  ariaLabel,
  size = 'md',
  type = 'button',
  className = '',
  disabled,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  ariaLabel?: string
  size?: 'md' | 'lg'
  type?: 'button' | 'submit'
  className?: string
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type={type}
      className={`lg-btn${size === 'lg' ? ' lg-btn-lg' : ''}${className ? ` ${className}` : ''}`}
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  )
}
