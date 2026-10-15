import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE_V2, normalizeAppearance, mapLegacyV1 } from './appearanceState'

describe('M25 r10 · 默认玻璃 50%（唯一 g=0.5）与非法/合法/旧迁移', () => {
  it('默认常量 glassIntensity=0.5', () => {
    expect(DEFAULT_APPEARANCE_V2.glassIntensity).toBe(0.5)
  })
  it('缺省/缺失/null/NaN/Infinity/string 非法 → 50%（同源默认，不另一处 .85）', () => {
    for (const v of [undefined, null, {}, { glassIntensity: NaN }, { glassIntensity: Infinity } as never, { glassIntensity: '0.9' } as never]) {
      expect(normalizeAppearance(v as never).glassIntensity).toBe(0.5)
    }
  })
  it('合法 0 / 0.85 / 1 保留（不 v||0.5 吞 0）', () => {
    expect(normalizeAppearance({ glassIntensity: 0 } as never).glassIntensity).toBe(0)
    expect(normalizeAppearance({ glassIntensity: 0.85 } as never).glassIntensity).toBe(0.85)
    expect(normalizeAppearance({ glassIntensity: 1 } as never).glassIntensity).toBe(1)
  })
  it('旧 level1 → 1/5=0.2（旧单位不误 100）', () => {
    expect(mapLegacyV1({ glassLevel: 1 }).glassIntensity).toBe(0.2)
  })
  it('theme/environment/follow 默认不变', () => {
    expect(DEFAULT_APPEARANCE_V2.appearanceMode).toBe('vivid')
    expect(DEFAULT_APPEARANCE_V2.environmentPosition).toBe(2)
    expect(DEFAULT_APPEARANCE_V2.followLocalTime).toBe(true)
  })
})
