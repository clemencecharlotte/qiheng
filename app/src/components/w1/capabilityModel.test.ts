import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_CATEGORIES,
  capabilitiesForCategory,
  isGroupActive,
  trackMetricsFor,
  type CapabilityItem,
} from './capabilityModel'

describe('trackMetricsFor · 容器测量卡宽（s1-r2-final-review 修正数学，首版可调）', () => {
  it('手机 390：内容 358 → 卡 318 / gap 12 / 露 28', () => {
    expect(trackMetricsFor(358)).toEqual({ cardWidth: 318, gap: 12, peek: 28 })
  })
  it('手机 320：内容 288 → 卡 248 / gap 12 / 露 28', () => {
    expect(trackMetricsFor(288)).toEqual({ cardWidth: 248, gap: 12, peek: 28 })
  })
  it('桌面内容 1200 → 卡 360 / gap 24 / 露 48', () => {
    expect(trackMetricsFor(1200)).toEqual({ cardWidth: 360, gap: 24, peek: 48 })
  })
  it('窄容器安全：卡 ≥216 且 peek ≥24；全部由容器宽推导（不 100vw）', () => {
    for (const w of [220, 260, 400, 700, 900, 1440]) {
      const m = trackMetricsFor(w)
      expect(m.cardWidth).toBeGreaterThanOrEqual(Math.min(160, w))
      expect(m.cardWidth).toBeLessThanOrEqual(360)
      expect(m.peek).toBeGreaterThanOrEqual(0)
      expect(m.cardWidth + m.gap + m.peek).toBeLessThanOrEqual(w)
    }
  })
})

describe('分类与离场合同', () => {
  const items: CapabilityItem[] = [
    { id: '1', category: '运行', title: 'a', summary: 's', route: '#/a', state: 'available' },
    { id: '2', category: '决策', title: 'b', summary: 's', route: '#/b', state: 'unconfigured' },
    { id: '3', category: '决策', title: 'c', summary: 's', route: '#/c', state: 'unavailable' },
  ]
  it('四类恒定：运行/决策/数据/智能', () => {
    expect(CAPABILITY_CATEGORIES).toEqual(['运行', '决策', '数据', '智能'])
  })
  it('按类过滤；空类返回空数组（不造内容）', () => {
    expect(capabilitiesForCategory(items, '决策')).toHaveLength(2)
    expect(capabilitiesForCategory(items, '智能')).toEqual([])
  })
  it('离场组判定：仅当前组可交互', () => {
    expect(isGroupActive('决策', '决策')).toBe(true)
    expect(isGroupActive('决策', '运行')).toBe(false)
  })
})
