import { describe, expect, it } from 'vitest'
import { sampleGlass, SURFACE_ROLES } from './glass-anchors'

describe('M16 r02 B5 连续玻璃（消费副本 shadow 不取整）', () => {
  it('shadow 连续：g .299 vs .300 不因取整跳变', () => {
    const a = sampleGlass(0.299, 'card').shadow
    const b = sampleGlass(0.300, 'card').shadow
    expect(Math.abs(b - a)).toBeLessThan(0.05)
    expect(b).not.toBe(a)
  })
  it('六锚点为校准点，非硬档：相邻段连续', () => {
    const s1 = sampleGlass(0.19, 'card').blur
    const s2 = sampleGlass(0.21, 'card').blur
    expect(Math.abs(s2 - s1)).toBeLessThan(3)
  })
  it('角色：data 实底（blur 受限、fill 有下限）；button/overlay 有各自系数', () => {
    const d = sampleGlass(1, 'data')
    expect(d.blur).toBeLessThanOrEqual(4)
    expect(d.fillAlpha).toBeGreaterThanOrEqual(0.92)
    expect(SURFACE_ROLES.overlay.blurK).toBeGreaterThan(SURFACE_ROLES.button.blurK)
  })
  it('端点：g=0 实底无 blur；g=1 最强', () => {
    expect(sampleGlass(0, 'card').blur).toBe(0)
    expect(sampleGlass(0, 'card').fillAlpha).toBeGreaterThanOrEqual(0.9)
    expect(sampleGlass(1, 'card').blur).toBeGreaterThan(sampleGlass(0.8, 'card').blur)
  })
})
