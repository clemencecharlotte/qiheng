import { describe, expect, it } from 'vitest'
import { resolveEnvironment, toHostPatch } from './environmentAdapter'

const NOON = new Date(2026, 9, 10, 12, 30)
const NIGHT = new Date(2026, 9, 10, 1, 19)

describe('resolveEnvironment · 宿主统一字段→W1 受控 props（D11 供件 adapter）', () => {
  it('followLocalTime 优先：位置=真实时间锚点（正午≈日间2、01:19≈夜班4.93），globeOn=true', () => {
    for (const mode of ['system', 'day', 'night', 'vivid'] as const) {
      const r = resolveEnvironment({ environmentPosition: 3, appearanceMode: mode, followLocalTime: true, themeResolved: 'dark', now: NOON })
      expect(r.scenePosition).toBeCloseTo(2, 1)
      expect(r.globeOn).toBe(true)
      const n = resolveEnvironment({ environmentPosition: 3, appearanceMode: mode, followLocalTime: true, themeResolved: 'dark', now: NIGHT })
      expect(n.scenePosition).toBeCloseTo(4.93, 1)
    }
  })

  it('非 follow：始终用手选持久 environmentPosition（四 mode × 手选 0/2/5/2.4 均不被覆盖）', () => {
    const manuals = [0, 2, 5, 2.4]
    for (const mode of ['system', 'day', 'night', 'vivid'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        for (const m of manuals) {
          const r = resolveEnvironment({ environmentPosition: m, appearanceMode: mode, followLocalTime: false, themeResolved: theme })
          expect(r.scenePosition).toBeCloseTo(m, 5)
          expect(r.globeOn).toBe(false)
        }
      }
    }
    // 显式回归：日间主题 + 夜班环境合法（不被 theme/mode 覆盖）
    expect(resolveEnvironment({ environmentPosition: 5, appearanceMode: 'day', followLocalTime: false, themeResolved: 'light' }).scenePosition).toBe(5)
  })

  it('globeOn=false（非跟随）；clamp 越界', () => {
    const r = resolveEnvironment({ environmentPosition: 9, appearanceMode: 'vivid', followLocalTime: false, themeResolved: 'dark' })
    expect(r.scenePosition).toBe(5)
    expect(r.globeOn).toBe(false)
  })

  it('appearanceMode 同名直通（无第二套枚举）', () => {
    expect(resolveEnvironment({ environmentPosition: 0, appearanceMode: 'vivid', followLocalTime: false, themeResolved: 'light' }).appearanceMode).toBe('vivid')
  })
})

describe('toHostPatch · 组件回调→宿主统一字段写回', () => {
  it('scenePosition→environmentPosition；globeOn→followLocalTime；空 patch 无键', () => {
    expect(toHostPatch({ scenePosition: 2.5 })).toEqual({ environmentPosition: 2.5 })
    expect(toHostPatch({ globeOn: true })).toEqual({ followLocalTime: true })
    expect(toHostPatch({})).toEqual({})
    expect(toHostPatch({ scenePosition: 9 }).environmentPosition).toBe(5)
  })
})
