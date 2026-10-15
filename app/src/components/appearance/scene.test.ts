import { describe, expect, it } from 'vitest'
import { interpolateScene, rgb, sceneBackground, sceneElevation, scenePositionForDate, sceneVars, SCENES } from './scene'

describe('M12 r03 六环境连续天光', () => {
  it('六档命名恒定', () => {
    expect(SCENES.map((s) => s.name)).toEqual(['晨前', '晨启', '日间', '暮色', '晚间', '夜班'])
  })

  it('端点取整档颜色；中间连续（相邻档之间线性插值，不跳变）', () => {
    expect(rgb(interpolateScene(0).top)).toBe(rgb(SCENES[0].top))
    expect(rgb(interpolateScene(5).top)).toBe(rgb(SCENES[5].top))
    // 连续性：相邻 0.05 步长颜色差有限
    let maxDelta = 0
    let prev = interpolateScene(0).top
    for (let p = 0.05; p <= 5.0001; p += 0.05) {
      const cur = interpolateScene(p).top
      maxDelta = Math.max(maxDelta, Math.abs(cur[0] - prev[0]), Math.abs(cur[1] - prev[1]), Math.abs(cur[2] - prev[2]))
      prev = cur
    }
    expect(maxDelta).toBeLessThan(30)
  })

  it('两端整数端点从当前颜色连续接续（端点邻域差小）', () => {
    const a = interpolateScene(0).bottom
    const a2 = interpolateScene(0.05).bottom
    const b = interpolateScene(5).bottom
    const b2 = interpolateScene(4.95).bottom
    expect(Math.abs(a[0] - a2[0])).toBeLessThan(10)
    expect(Math.abs(b[0] - b2[0])).toBeLessThan(10)
  })

  it('sceneVars 输出两主题 token 与日轮位置/光晕，均为合法值', () => {
    const v = sceneVars(2.5)
    expect(v['--scene-top']).toMatch(/^rgb\(/)
    expect(v['--scene-top-l']).toMatch(/^rgb\(/)
    expect(v['--scene-glow-l']).toMatch(/^rgb\(/)
    expect(Number(v['--scene-glow-alpha'])).toBeGreaterThan(0)
    expect(v['--scene-sun-y']).toMatch(/%$/)
    expect(Number(v['--scene-sun-opacity'])).toBeGreaterThan(0)
    // 正午日轮高于晨前
    const noon = Number(sceneVars(2)['--scene-sun-y'].replace('%', ''))
    const dawn = Number(sceneVars(0)['--scene-sun-y'].replace('%', ''))
    expect(noon).toBeLessThan(dawn)
  })

  it('elevation 端点=0、中间最高', () => {
    expect(sceneElevation(0)).toBeCloseTo(0, 5)
    expect(sceneElevation(5)).toBeCloseTo(0, 5)
    expect(sceneElevation(2.5)).toBeGreaterThan(0.9)
  })
})

describe('M12 r03 sceneBackground 与真实时间', () => {
  it('sceneBackground 返回含三段渐变的合法 CSS（浅/深不同）', () => {
    const dark = sceneBackground(2, 'dark')
    const light = sceneBackground(2, 'light')
    expect(dark).toContain('linear-gradient(180deg')
    expect(dark).toContain('radial-gradient')
    expect(dark).not.toBe(light)
    expect(dark).toMatch(/rgb\(\d+, \d+, \d+\)/)
  })
  it('scenePositionForDate 覆盖一天且落在 [0,5]', () => {
    for (const h of [0, 5, 7, 12, 17, 20, 23]) {
      const v = scenePositionForDate(new Date(2026, 9, 9, h, 0))
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(5)
    }
    // 正午接近日间(2)，深夜接近夜班(5)
    expect(scenePositionForDate(new Date(2026, 9, 9, 12, 0))).toBeCloseTo(2, 0)
    expect(scenePositionForDate(new Date(2026, 9, 9, 0, 0))).toBeCloseTo(5, 0)
  })
})
