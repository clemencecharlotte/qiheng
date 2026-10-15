import { describe, expect, it } from 'vitest'
import {
  mapLegacyV1,
  normalizeAppearance,
  appearanceModeToTheme,
  themeToAppearanceMode,
  DEFAULT_APPEARANCE_V2,
} from './appearanceState'
import { glassMaterialAt } from './appearance'

describe('M16 r01 外观 v2 迁移与连续玻璃', () => {
  it('旧 v1 字段映射：scenePosition→environmentPosition；glassLevel[0..5]→g=level/5（旧1≠100%）', () => {
    const m = mapLegacyV1({ scenePosition: 2, glassLevel: 1, followRealTime: true })
    expect(m.environmentPosition).toBe(2)
    expect(m.glassIntensity).toBeCloseTo(0.2, 5) // 关键：不是 1
    expect(m.followLocalTime).toBe(true)
    const s = normalizeAppearance({ ...DEFAULT_APPEARANCE_V2, ...m })
    expect(s.version).toBe(2)
    expect(s.glassIntensity).toBeCloseTo(0.2, 5)
  })

  it('无旧值时用默认；越界夹取', () => {
    const s = normalizeAppearance({ environmentPosition: 9 as unknown as number, glassIntensity: 2 as unknown as number })
    expect(s.environmentPosition).toBe(5)
    expect(s.glassIntensity).toBe(1)
  })

  it('模式↔主题显式映射', () => {
    expect(themeToAppearanceMode('light')).toBe('day')
    expect(themeToAppearanceMode('dark')).toBe('night')
    expect(themeToAppearanceMode('vivid')).toBe('vivid')
    expect(themeToAppearanceMode('whatever')).toBe('system')
    expect(appearanceModeToTheme('day')).toBe('light')
    expect(appearanceModeToTheme('night')).toBe('dark')
  })

  it('玻璃连续：0.13/0.57/0.93 不与锚点重合且单调（不吸附）', () => {
    const anchors = [0, 0.2, 0.4, 0.6, 0.8, 1].map((g) => glassMaterialAt(g).blur)
    const a = glassMaterialAt(0.13)
    const b = glassMaterialAt(0.57)
    const c = glassMaterialAt(0.93)
    expect(a.blur).toBeGreaterThan(glassMaterialAt(0).blur)
    expect(a.blur).toBeLessThan(glassMaterialAt(0.2).blur)
    expect(b.blur).toBeGreaterThan(glassMaterialAt(0.4).blur)
    expect(b.blur).toBeLessThan(glassMaterialAt(0.6).blur)
    expect(c.blur).toBeGreaterThan(glassMaterialAt(0.8).blur)
    expect(c.blur).toBeLessThan(glassMaterialAt(1).blur)
    // 0 档无 blur、实底；1 档更强
    expect(glassMaterialAt(0).blur).toBe(0)
    expect(glassMaterialAt(0).fillAlpha).toBe(100)
    expect(glassMaterialAt(1).blur).toBeGreaterThan(glassMaterialAt(0.8).blur)
    expect(anchors[0]).toBe(0)
  })
})
