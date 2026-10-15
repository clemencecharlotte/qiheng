import { describe, expect, it } from 'vitest'
import { chooseReturnFocus } from './focusReturn'

describe('M13 外观关闭回焦决策', () => {
  it('入口有效 → 回本次入口（trigger）', () => {
    expect(chooseReturnFocus({ isConnected: true, focusable: true }, { isConnected: true, focusable: true })).toBe('trigger')
  })
  it('入口卸载/失效 → 落可用替代节点（fallback）', () => {
    expect(chooseReturnFocus({ isConnected: false, focusable: true }, { isConnected: true, focusable: true })).toBe('fallback')
    expect(chooseReturnFocus({ isConnected: true, focusable: false }, { isConnected: true, focusable: true })).toBe('fallback')
    expect(chooseReturnFocus(null, { isConnected: true, focusable: true })).toBe('fallback')
  })
  it('入口与替代都不可用 → 落 host（不落背景根）', () => {
    expect(chooseReturnFocus(null, null)).toBe('host')
    expect(chooseReturnFocus({ isConnected: false, focusable: false }, { isConnected: false, focusable: true })).toBe('host')
  })
})
