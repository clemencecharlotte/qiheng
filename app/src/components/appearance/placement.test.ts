import { describe, expect, it } from 'vitest'
import { computeAnchoredPlacement } from './placement'

const vp = { width: 390, height: 844 }

describe('M14 r01 内容感知锚定定位', () => {
  it('触发在左下、内容高 → 优先上方且限高在可用空间内、不出窗', () => {
    const p = computeAnchoredPlacement({ left: 8, top: 755, bottom: 791 }, 348, vp)
    expect(p.placedAbove).toBe(true)
    expect(p.top).toBeGreaterThanOrEqual(8)
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(vp.height - 8 + 0.001)
    expect(p.left).toBeGreaterThanOrEqual(8)
    expect(p.left + p.width).toBeLessThanOrEqual(vp.width)
  })

  it('近顶、上方不足 → 放下方', () => {
    const p = computeAnchoredPlacement({ left: 20, top: 40, bottom: 76 }, 300, vp)
    expect(p.placedAbove).toBe(false)
    expect(p.top).toBeGreaterThanOrEqual(76)
  })

  it('内容高于两侧空间 → 取较大侧并限高（内部滚动）', () => {
    const p = computeAnchoredPlacement({ left: 10, top: 420, bottom: 456 }, 2000, vp)
    expect(p.maxHeight).toBeLessThanOrEqual(vp.height)
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(vp.height - 8 + 0.001)
  })

  it('宽度夹取在视口内', () => {
    const p = computeAnchoredPlacement({ left: 380, top: 400, bottom: 436 }, 200, vp)
    expect(p.left + p.width).toBeLessThanOrEqual(vp.width - 8 + 0.001)
  })
})

describe('M14 r02 needsScroll', () => {
  it('空间足够 → 不限高滚动；空间不足 → needsScroll', () => {
    const vp2 = { width: 390, height: 844 }
    const enough = computeAnchoredPlacement({ left: 8, top: 700, bottom: 736 }, 200, vp2)
    expect(enough.needsScroll).toBe(false)
    const tight = computeAnchoredPlacement({ left: 8, top: 430, bottom: 800 }, 2000, vp2)
    expect(tight.needsScroll).toBe(true)
  })
})
