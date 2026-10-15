import { describe, expect, it } from 'vitest'
import { statusTone } from './StatusBadge'

describe('M25 r13 C · statusTone 真实文本枚举（诚实文本匹配，非结构 severity）', () => {
  it('通过/可行/提示/正常 → normal；无效/拒绝 → severe（不绿）', () => {
    expect(statusTone('质量通过')).toBe('normal')
    expect(statusTone('建议可行')).toBe('normal')
    expect(statusTone('提示')).toBe('normal')
    expect(statusTone('质量无效')).toBe('severe')
    expect(statusTone('拒绝')).toBe('severe')
    expect(statusTone('建议无解')).toBe('severe')
  })
  it('待复核/需关注/隔离/离线 → warn', () => {
    expect(statusTone('待复核')).toBe('warn')
    expect(statusTone('需关注')).toBe('warn')
    expect(statusTone('隔离')).toBe('warn')
    expect(statusTone('离线')).toBe('warn')
  })
  it('未知/未配置/断链 不得为 normal（未知不绿）', () => {
    expect(statusTone('未知')).toBe('unknown')
    expect(statusTone('未配置')).toBe('unknown')
    expect(statusTone('断链')).not.toBe('normal')
    expect(statusTone('')).toBe('unknown')
  })
  it('重叠文字：拒绝/无效优先（不得被“通过”降级为绿）', () => {
    expect(statusTone('通过但无效')).toBe('severe')
    expect(statusTone('拒绝（原通过）')).toBe('severe')
  })
})
