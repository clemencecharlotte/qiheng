import { describe, expect, it } from 'vitest'
import {
  acquireBg,
  acquireScroll,
  isMeasurableAnchor,
  lockStyle,
  nextPhase,
  releaseBg,
  releaseScrollState,
  type DialogPhase,
} from './lifecycle'

describe('nextPhase · 展示状态机', () => {
  const cases: Array<[DialogPhase, 'open' | 'close' | 'settle-open' | 'settle-closed', DialogPhase | null]> = [
    ['closed', 'open', 'opening'],
    ['opening', 'settle-open', 'open'],
    ['open', 'close', 'closing'],
    ['closing', 'settle-closed', 'closed'],
    ['closing', 'open', 'opening'], // 关中重开：沿当前进度连续
    ['opening', 'close', 'closing'], // opening 中途关闭
    ['open', 'open', null],
    ['closed', 'close', null],
    ['closing', 'settle-open', null],
  ]
  it.each(cases)('%s + %s → %s', (phase, evt, expected) => {
    expect(nextPhase(phase, evt)).toBe(expected)
  })
})

describe('isMeasurableAnchor · 锚点有效性', () => {
  const ok = { isConnected: true, getBoundingClientRect: () => ({ width: 120, height: 44 }) }
  it('已连接且矩形有效 → true', () => {
    expect(isMeasurableAnchor(ok)).toBe(true)
  })
  it('display:none（仍 isConnected）→ false（修复飞旧坐标）', () => {
    expect(isMeasurableAnchor(ok, 'none')).toBe(false)
  })
  it('零矩形 → false', () => {
    expect(isMeasurableAnchor({ isConnected: true, getBoundingClientRect: () => ({ width: 0, height: 0 }) })).toBe(false)
  })
  it('未连接 → false', () => {
    expect(isMeasurableAnchor({ isConnected: false, getBoundingClientRect: () => ({ width: 10, height: 10 }) })).toBe(false)
  })
  it('null → false', () => {
    expect(isMeasurableAnchor(null)).toBe(false)
  })
})

describe('背景/滚动锁一次性取得与还原', () => {
  it('首次取得保存原属性；重入不覆盖（修复重开重复保存）', () => {
    const original = { inert: false, aria: null }
    const first = acquireBg(null, original)
    const second = acquireBg(first, { inert: true, aria: 'true' })
    expect(second).toEqual({ inert: false, aria: null })
    expect(releaseBg(original)).toEqual(original)
  })
  it('滚动锁：一次性取得；锁定样式 clip+≥7px；释放还原保存的原值而非清空', () => {
    const original = { overflow: 'clip', paddingRight: '7px' }
    const state = acquireScroll(null, original, 15)
    expect(state).toEqual(original)
    const re = acquireScroll(state, { overflow: '', paddingRight: '' }, 15)
    expect(re).toEqual(original)
    const style = lockStyle(state, 15)
    expect(style.overflow).toBe('clip')
    expect(parseInt(style.paddingRight)).toBeGreaterThanOrEqual(7)
    expect(releaseScrollState(original)).toEqual(original)
  })
})

describe('M12-r01 · startClose 幂等资格（重复 close 无副作用）', () => {
  it('closing / closed 下 close 返回 null（宿主 callback 身份变化重复 effect 不得取消进行中的 closing）', () => {
    expect(nextPhase('closing', 'close')).toBeNull()
    expect(nextPhase('closed', 'close')).toBeNull()
  })
  it('仅 open / opening 允许进入 closing（真正关闭路径不变）', () => {
    expect(nextPhase('open', 'close')).toBe('closing')
    expect(nextPhase('opening', 'close')).toBe('closing')
  })
})
