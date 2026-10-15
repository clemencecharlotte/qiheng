import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GLASS_SELECTOR, installLiquidGlass } from './liquidGlass'
import GlassButton from './GlassButton'

describe('M13 液态玻璃', () => {
  it('玻璃选择器覆盖卡片/浮层/次级按钮族', () => {
    for (const s of ['.lg-glass', '.lg-btn', '.app-shell .panel', '.topbar-modal', '.appearance-scene-pop', '.u-dialog', '.qh-relations']) {
      expect(GLASS_SELECTOR).toContain(s)
    }
  })

  it('installLiquidGlass 在无窗口环境返回可调用卸载函数', () => {
    const dispose = installLiquidGlass()
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('GlassButton 渲染 lg-btn 合同（lg 档类）且可读', () => {
    const html = renderToStaticMarkup(<GlassButton ariaLabel="查看决策护照">查看决策护照</GlassButton>)
    expect(html).toContain('class="lg-btn"')
    expect(html).toContain('aria-label="查看决策护照"')
    const lg = renderToStaticMarkup(<GlassButton size="lg">x</GlassButton>)
    expect(lg).toContain('lg-btn lg-btn-lg')
  })
})
