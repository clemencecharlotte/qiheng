import { describe, expect, it } from 'vitest'
import { attemptNarrative, executionStatusText, suffixStatusText } from './statusNarrative'

describe('M27 C · 状态中文与风险口径', () => {
  it('retired 给安全退休 + 旧授权不可继续 + 重新审查', () => {
    const n = executionStatusText('retired')
    expect(n.label).toContain('退休')
    expect(n.risk).toContain('旧授权')
    expect(n.risk).toContain('重新审查')
  })

  it('terminated 给安全终止 + 旧授权不可继续，且不编造精确原因', () => {
    const n = suffixStatusText('terminated')
    expect(n.label).toContain('终止')
    expect(n.risk).toContain('旧授权不可继续')
    expect(n.risk).toContain('重新审查')
    expect(n.risk).not.toContain('刷新')
    expect(n.risk).not.toContain('人工终止')
  })

  it('timeout 明确超时/失败尝试保留/显式重试', () => {
    const n = suffixStatusText('timeout')
    expect(n.label).toContain('超时')
    expect(n.risk).toContain('失败尝试已保留')
    expect(n.risk).toContain('显式重试')
  })

  it('attemptNarrative 区分 timeout 与 infeasible，并给出是否有方案', () => {
    expect(attemptNarrative('timeout', false, null)).toContain('超时')
    expect(attemptNarrative('timeout', false, null)).toContain('本次未获得可用计划')
    expect(attemptNarrative('infeasible', false, null)).toContain('无可行解')
    expect(attemptNarrative('infeasible', false, null)).not.toContain('watchdog')
    expect(attemptNarrative('ok', true, null)).toContain('本次已获得可用计划')
  })

  it('未知状态原样返回且不给风险结论', () => {
    expect(executionStatusText('mystery')).toEqual({ label: 'mystery', risk: null })
    expect(suffixStatusText('mystery')).toEqual({ label: 'mystery', risk: null })
  })

  it('人工批准即授权合成执行，但不自动 Start', () => {
    const risk = executionStatusText('approved').risk ?? ''
    expect(risk).toContain('人工批准即授权合成执行')
    expect(risk).toContain('不自动 Start')
  })
})
