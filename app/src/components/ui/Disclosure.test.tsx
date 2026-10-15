import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Popover, Tooltip, place, sameStyle } from './Disclosure'

describe('M22 · 统一解释浮层原语结构', () => {
  it('Tooltip：语义 button + aria-label，无原生 title 黑框', () => {
    const html = renderToStaticMarkup(<Tooltip text="只读说明">i</Tooltip>)
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="只读说明"')
    expect(html).not.toContain('title="')
  })
  it('Popover：aria-haspopup=dialog + aria-expanded=false（默认关闭）', () => {
    const html = renderToStaticMarkup(<Popover label="来源详情" ariaLabel="来源详情">内容</Popover>)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('来源详情')
  })
})

describe('M22 r05 · place() 纯定位（flip/clamp，无 DOM runner）', () => {
  const rect = (top: number, bottom: number, left = 400, width = 120) => ({ left, right: left + width, top, bottom, width, height: bottom - top })
  it('下方空间足够 → 向下，clamp 视口内', () => {
    const s = place(rect(100, 140), 300, 120, 1440, 900)
    expect(s.top).toBe(148)
    expect(s.left).toBeGreaterThanOrEqual(12)
    expect(s.left + s.width).toBeLessThanOrEqual(1440 - 12)
    expect(s.maxHeight).toBeGreaterThan(96)
  })
  it('下方不足、上方足够 → 向上（长详情不撞下沿）', () => {
    const s = place(rect(760, 800), 300, 400, 1440, 900)
    expect(s.top).toBeLessThan(760)
    expect(s.maxHeight).toBeGreaterThan(0)
  })
  it('两侧都不足 → 选较大侧并限高可滚（>=96）', () => {
    const s = place(rect(400, 500), 300, 5000, 1200, 900)
    expect(s.maxHeight).toBeGreaterThanOrEqual(96)
  })
  it('sameStyle：值未变则保留旧对象（防 render 循环）', () => {
    const a = { left: 1, top: 2, width: 3, maxHeight: 4 }
    expect(sameStyle(a, { left: 1, top: 2, width: 3, maxHeight: 4 })).toBe(true)
    expect(sameStyle(a, { left: 1, top: 2, width: 3, maxHeight: 5 })).toBe(false)
    expect(sameStyle(null, a)).toBe(false)
  })
})

