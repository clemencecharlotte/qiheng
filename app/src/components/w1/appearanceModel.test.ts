import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_MODES,
  effectiveScenePosition,
  effectiveTheme,
  timeToScenePosition,
} from './appearanceModel'

describe('timeToScenePosition · 真实本地时间→六环境连续映射', () => {
  it('锚点：正午=日间(2.0)；午夜/深夜=夜班(≈5)；05:00=晨前(0.1)；19:18=晚间(4.0)', () => {
    expect(timeToScenePosition(12.5)).toBeCloseTo(2, 5)
    expect(timeToScenePosition(0)).toBe(5)
    expect(timeToScenePosition(5)).toBeCloseTo(0.1, 5)
    expect(timeToScenePosition(19.3)).toBeCloseTo(4, 5)
  })

  it('真实节奏：凌晨→晨前快速天亮（单位小时位移远大于日间驻留段）', () => {
    const dawnSlope = Math.abs(timeToScenePosition(5) - timeToScenePosition(4.2)) / 0.8
    const daySlope = Math.abs(timeToScenePosition(16.8) - timeToScenePosition(12.5)) / 4.3
    expect(dawnSlope).toBeGreaterThan(daySlope * 4)
  })

  it('24h 环绕：23 点与 1 点都在夜班段（跨午夜连续）', () => {
    expect(timeToScenePosition(23)).toBeGreaterThan(4.8)
    expect(timeToScenePosition(1)).toBeGreaterThan(4.8)
    expect(timeToScenePosition(25)).toBe(timeToScenePosition(1))
    expect(timeToScenePosition(-1)).toBe(timeToScenePosition(23))
  })

  it('全日输出在 [0,5] 且各段单调', () => {
    let prev = timeToScenePosition(0)
    for (let h = 0.1; h < 24; h += 0.1) {
      const v = timeToScenePosition(h)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(5)
      prev = v
    }
    void prev
  })
})

describe('effectiveScenePosition · 背景位置决策（地球优先→模式→系统明暗）', () => {
  it('地球开启：无论模式，随真实时钟（注入 now 验证）', () => {
    const noon = new Date(2026, 9, 9, 12, 30)
    const night = new Date(2026, 9, 9, 23, 0)
    for (const mode of ['system', 'day', 'night', 'vivid'] as const) {
      expect(effectiveScenePosition({ mode, globeOn: true, manualScene: 1, themeResolved: 'light', now: noon })).toBeCloseTo(2, 1)
      expect(effectiveScenePosition({ mode, globeOn: true, manualScene: 1, themeResolved: 'light', now: night })).toBeCloseTo(4.95, 1)
    }
  })

  it('vivid：手动滑动值；day/night：静态 2/5；system：按解析主题', () => {
    expect(effectiveScenePosition({ mode: 'vivid', globeOn: false, manualScene: 3.4, themeResolved: 'dark' })).toBe(3.4)
    expect(effectiveScenePosition({ mode: 'day', globeOn: false, manualScene: 3.4, themeResolved: 'dark' })).toBe(2)
    expect(effectiveScenePosition({ mode: 'night', globeOn: false, manualScene: 3.4, themeResolved: 'light' })).toBe(5)
    expect(effectiveScenePosition({ mode: 'system', globeOn: false, manualScene: 0, themeResolved: 'light' })).toBe(2)
    expect(effectiveScenePosition({ mode: 'system', globeOn: false, manualScene: 0, themeResolved: 'dark' })).toBe(5)
  })
})

describe('effectiveTheme · 阅读主题分离合同（vivid 不改主题）', () => {
  it('day→light、night→dark、vivid/system→保持解析值', () => {
    expect(effectiveTheme({ mode: 'day', themeResolved: 'dark' })).toBe('light')
    expect(effectiveTheme({ mode: 'night', themeResolved: 'light' })).toBe('dark')
    expect(effectiveTheme({ mode: 'vivid', themeResolved: 'dark' })).toBe('dark')
    expect(effectiveTheme({ mode: 'system', themeResolved: 'light' })).toBe('light')
  })
})

describe('APPEARANCE_MODES · 四档恒定（跟随系统默认）', () => {
  it('顺序与默认', () => {
    expect(APPEARANCE_MODES.map((m) => m.label)).toEqual(['跟随系统', '日间', '夜间', '臻彩'])
    expect(APPEARANCE_MODES[0].key).toBe('system')
  })
})
