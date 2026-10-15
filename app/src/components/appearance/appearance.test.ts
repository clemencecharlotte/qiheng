import { describe, expect, it } from 'vitest'
import {
  clampGlass,
  clampScene,
  glassName,
  glassTokens,
  interpolateSceneTint,
  nearestSceneIndex,
  sceneName,
  SCENES,
} from './appearance'

describe('M12 外观预置纯逻辑', () => {
  it('六环境命名恒定且与权威命名一致', () => {
    expect(SCENES.map((s) => s.name)).toEqual(['晨前', '晨启', '日间', '暮色', '晚间', '夜班'])
    expect(sceneName(0)).toBe('晨前')
    expect(sceneName(2)).toBe('日间')
    expect(sceneName(5)).toBe('夜班')
    expect(sceneName(2.4)).toBe('日间')
    expect(sceneName(2.6)).toBe('暮色')
  })

  it('scenePosition 连续插值（两邻档之间，夹取边界）', () => {
    expect(interpolateSceneTint(0)).toBe('rgb(38, 54, 84)')
    expect(interpolateSceneTint(5)).toBe('rgb(18, 28, 46)')
    const mid = interpolateSceneTint(2.5)
    expect(mid).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
    expect(clampScene(-3)).toBe(0)
    expect(clampScene(9)).toBe(5)
  })

  it('玻璃六档命名与 token：0 档无 blur、实底；末档更强', () => {
    expect(glassName(0)).toBe('关闭')
    expect(glassName(5)).toBe('极强')
    expect(glassTokens(0).blur).toBe(0)
    expect(glassTokens(0).alpha).toBe(100)
    expect(glassTokens(5).blur).toBeGreaterThan(glassTokens(3).blur)
    expect(glassTokens(5).alpha).toBeLessThan(glassTokens(3).alpha)
    expect(clampGlass(9)).toBe(5)
    expect(clampGlass(1.4)).toBe(1)
  })

  it('nearestSceneIndex 边界取整', () => {
    expect(nearestSceneIndex(0)).toBe(0)
    expect(nearestSceneIndex(5)).toBe(5)
    expect(nearestSceneIndex(3.4)).toBe(3)
    expect(nearestSceneIndex(3.5)).toBe(4)
  })
})
