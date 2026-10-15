import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// M16 r05 · 顺序回归：直接读源 CSS 文本（node:fs，仅 shim 最小类型；不用 node:url / ?raw）。
const css = readFileSync('src/styles/liquid-glass.css', 'utf8')

describe('M16 r04/r05 liquid-glass 顺序合同', () => {
  it('noBlur 兜底位于全部角色 background 规则之后，且覆盖 overlay/data/button/card', () => {
    const lastRoleBg = css.lastIndexOf('* 100%), transparent)')
    const fb = css.lastIndexOf('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))')
    expect(fb).toBeGreaterThan(lastRoleBg)
    const fbBlock = css.slice(fb)
    expect(fbBlock).toContain('backdrop-filter: none !important')
    expect(fbBlock).toContain('background: var(--surface, #fff) !important')
    for (const sel of ['.appearance-scene-pop', '.u-dialog', '.qh-relations', '.panel.trend-panel', '.panel.stage-panel', '.lg-btn']) {
      expect(fbBlock).toContain(sel)
    }
  })

  it('reduce 瞬切位于消费过渡之后', () => {
    const reduce = css.lastIndexOf('@media (prefers-reduced-motion: reduce)')
    const lastRoleBg = css.lastIndexOf('* 100%), transparent)')
    expect(reduce).toBeGreaterThan(lastRoleBg)
  })

  it('overlay fill 有可读下限（max ≥ .85）', () => {
    expect(css).toContain('max(var(--cg-overlay-fill-a, 0.9), 0.85)')
  })
})
