import { describe, expect, it } from 'vitest'
import {
  CHASE_EPS,
  SCENE_ENVS,
  chaseSettled,
  chaseStep,
  clampScenePosition,
  contrastRatio,
  interpolateEnv,
  mixHex,
  relativeLuminance,
} from './scenePalette'

describe('scenePalette v2 · 六环境恒定合同（SHARED-CONTRACT 命名）', () => {
  it('六档 id/name 恒定且顺序稳定', () => {
    expect(SCENE_ENVS.map((e) => [e.id, e.name])).toEqual([
      ['preDawn', '晨前'],
      ['sunrise', '晨启'],
      ['daytime', '日间'],
      ['dusk', '暮色'],
      ['sunset', '晚间'],
      ['night', '夜班'],
    ])
  })

  it('昼夜亮度差真实拉开（真实光线层次：晨前/夜班暗、日间亮）', () => {
    const lum = (e: (typeof SCENE_ENVS)[number]) => relativeLuminance(e.skyMid)
    const preDawn = lum(SCENE_ENVS[0])
    const day = lum(SCENE_ENVS[2])
    const night = lum(SCENE_ENVS[5])
    expect(day).toBeGreaterThan(preDawn * 4)
    expect(day).toBeGreaterThan(night * 8)
    // 全环境统一浅字体系（copy 局部暗晕兜底亮区）——六环境 ink 均为浅色
    for (const e of SCENE_ENVS) {
      expect(relativeLuminance(e.ink)).toBeGreaterThan(0.7)
    }
  })
})

describe('interpolateEnv · 小数位置连续插值', () => {
  it('端点=该档原色（0/1/…/5 精确回到环境定义）', () => {
    for (let i = 0; i < SCENE_ENVS.length; i++) {
      const env = interpolateEnv(i)
      expect(env.skyTop).toBe(SCENE_ENVS[i].skyTop)
      expect(env.skyHorizon).toBe(SCENE_ENVS[i].skyHorizon)
      expect(env.sunColor).toBe(SCENE_ENVS[i].sunColor)
      expect(env.name).toBe(SCENE_ENVS[i].name)
    }
  })

  it('光斑位置/半径连续插值（太阳随环境移动：晨前低东→日间顶中→晚间西沉）', () => {
    const a = interpolateEnv(0)
    const mid = interpolateEnv(2.5)
    const d = interpolateEnv(2)
    const n = interpolateEnv(5)
    expect(d.sunY).toBeLessThan(a.sunY) // 日间太阳升高
    expect(d.sunX).toBeGreaterThan(a.sunX) // 且移向中天
    expect(mid.sunX).toBeCloseTo((SCENE_ENVS[2].sunX + SCENE_ENVS[3].sunX) / 2, 5)
    expect(n.sunX).toBeGreaterThan(SCENE_ENVS[0].sunX) // 夜班月光偏西
    expect(n.sunR).toBeLessThan(SCENE_ENVS[1].sunR) // 月斑小于晨启大阳
  })

  it('全字段输出合法（hex 格式/数值有限），中点=两邻档均值', () => {
    for (const p of [0.3, 2.5, 4.9]) {
      const e = interpolateEnv(p)
      for (const k of ['skyTop', 'skyMid', 'skyHorizon', 'sunColor', 'ambColor', 'hazeColor', 'coreHi', 'coreLo', 'flow', 'ink', 'inkMuted', 'accent'] as const) {
        expect(e[k]).toMatch(/^#[0-9a-f]{6}$/)
      }
      for (const k of ['sunX', 'sunY', 'sunR', 'ambX', 'ambY'] as const) {
        expect(Number.isFinite(e[k])).toBe(true)
      }
    }
    expect(interpolateEnv(2.5).skyTop).toBe(mixHex(SCENE_ENVS[2].skyTop, SCENE_ENVS[3].skyTop, 0.5))
  })

  it('clamp：越界输入收敛到 [0,5]；非法值回 0', () => {
    expect(clampScenePosition(7)).toBe(5)
    expect(clampScenePosition(-2)).toBe(0)
    expect(clampScenePosition(Number.NaN)).toBe(0)
    expect(interpolateEnv(9).skyTop).toBe(SCENE_ENVS[5].skyTop)
  })
})

/** copy 区局部暗晕衬底近似（CSS 同参数：62% #0a1420 叠加） */
function underCopyScrim(sky: string): string {
  const k = 0.62
  const base = [0x0a, 0x14, 0x20]
  const src = [0, 2, 4].map((i) => parseInt(sky.replace('#', '').slice(i, i + 2), 16))
  return '#' + src.map((v, i) => Math.round(v * (1 - k) + base[i] * k).toString(16).padStart(2, '0')).join('')
}

describe('可读性合同 · 统一浅字体系：hero 压 skyTop 直接对比；copy 区由局部暗晕兜底', () => {
  it.each(SCENE_ENVS.map((e, i) => [e.name, i] as const))('%s：ink on skyTop ≥4.5；copy 晕下（mid/horizon）ink/inkMuted ≥4.5', (_name, i) => {
    const e = SCENE_ENVS[i]
    expect(contrastRatio(e.ink, e.skyTop)).toBeGreaterThanOrEqual(4.5)
    for (const sky of [e.skyMid, e.skyHorizon]) {
      expect(contrastRatio(e.ink, underCopyScrim(sky))).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(e.inkMuted, underCopyScrim(sky))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('插值中间位置（0.5/1.5/2.5/3.5/4.5）连续可读（晕下全过）', () => {
    for (const p of [0.5, 1.5, 2.5, 3.5, 4.5]) {
      const e = interpolateEnv(p)
      expect(contrastRatio(e.ink, e.skyTop)).toBeGreaterThanOrEqual(4.5)
      for (const sky of [e.skyMid, e.skyHorizon]) {
        expect(contrastRatio(e.ink, underCopyScrim(sky))).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(e.inkMuted, underCopyScrim(sky))).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('chaseStep/chaseSettled · r02 合同保留（时间插值）', () => {
  it('r05：0→5 收敛 ≈1.5s（80–95 帧 @60fps，降速后从容观感）', () => {
    let v = 0
    let frames = 0
    while (!chaseSettled(v, 5) && frames < 600) {
      v = chaseStep(v, 5)
      frames++
    }
    expect(frames).toBeGreaterThanOrEqual(80)
    expect(frames).toBeLessThanOrEqual(95)
  })
  it('快速 0→5→2→0 从当前值接续（无队列）', () => {
    let v = 0
    for (let i = 0; i < 10; i++) v = chaseStep(v, 5)
    const atSwitch = v
    for (let i = 0; i < 10; i++) v = chaseStep(v, 2)
    expect(v).toBeGreaterThan(Math.min(atSwitch, 2))
    expect(v).toBeLessThan(5)
    for (let i = 0; i < 600 && !chaseSettled(v, 0, CHASE_EPS); i++) v = chaseStep(v, 0)
    expect(chaseSettled(v, 0, CHASE_EPS)).toBe(true)
  })
})
