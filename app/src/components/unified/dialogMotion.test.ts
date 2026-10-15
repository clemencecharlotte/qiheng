import { describe, expect, it, vi } from 'vitest'
import { PanelMotion, samplePose, type MotionElement } from './dialogMotion'

/** 桩 MotionElement：记录 animate 调用，动画可手动 finish/cancel（无浏览器） */
function stubEl() {
  const anims: Array<{ keyframes: Keyframe[]; onfinish: (() => void) | null; cancelled: boolean; finished: boolean }> = []
  const el: MotionElement & { anims: typeof anims } = {
    anims,
    getComputedStyle: () => ({ transform: 'none', opacity: '1' }),
    animate(keyframes, _opts) {
      const a = { keyframes, onfinish: null as (() => void) | null, cancelled: false, finished: false }
      anims.push(a)
      return {
        cancel: () => { a.cancelled = true },
        set onfinish(fn: (() => void) | null) { a.onfinish = fn },
        get onfinish() { return a.onfinish },
      } as unknown as Animation
    },
  }
  return el
}

describe('PanelMotion · 组件运动控制器真实合同（r03 残留1 配套）', () => {
  it('sampleThenCancel 固定先读后取消（合同顺序）', () => {
    const el = stubEl()
    const m = new PanelMotion(el)
    const spy = vi.fn(() => ({ transform: 'matrix(1, 0, 0, 1, -349.619, 187.538)', opacity: '0.7' }))
    ;(el as unknown as { getComputedStyle: () => unknown }).getComputedStyle = spy
    const cancelSpy = vi.spyOn(m, 'cancel')
    const pose = m.sampleThenCancel()
    expect(spy).toHaveBeenCalledBefore(cancelSpy)
    expect(pose).toEqual({ x: -349.619, y: 187.538, scale: 1, opacity: 0.7 })
  })

  it('令牌失效：新 play 后旧动画 onfinish 不触发 settle', () => {
    const el = stubEl()
    const m = new PanelMotion(el)
    const oldSettle = vi.fn()
    const newSettle = vi.fn()
    m.play({ x: 0, y: 0, scale: 1, opacity: 1 }, { x: 10, y: 0, scale: 1, opacity: 1 }, 200, false, oldSettle)
    m.play({ x: 10, y: 0, scale: 1, opacity: 1 }, { x: 0, y: 0, scale: 1, opacity: 1 }, 200, false, newSettle)
    expect(el.anims).toHaveLength(2)
    const first = el.anims[0] as unknown as { onfinish: (() => void) | null; cancelled: boolean }
    expect(first.cancelled).toBe(true) // 新意图取消旧动画
    first.onfinish?.() // 旧回调迟到触发
    expect(oldSettle).not.toHaveBeenCalled() // 令牌失效
    ;(el.anims[1] as unknown as { onfinish: () => void }).onfinish()
    expect(newSettle).toHaveBeenCalledTimes(1)
  })

  it('完成即 cancel 清 fill：finish 后 sample 读真实 CSS 状态', () => {
    const el = stubEl()
    const m = new PanelMotion(el)
    const settle = vi.fn()
    m.play({ x: 0, y: 0, scale: 1, opacity: 1 }, { x: 5, y: 5, scale: 1, opacity: 1 }, 200, false, settle)
    const a = el.anims[0] as unknown as { onfinish: () => void; cancelled: boolean }
    a.onfinish()
    expect(a.cancelled).toBe(true) // 清 fill
    expect(settle).toHaveBeenCalledTimes(1)
    expect(m.hasActive()).toBe(false)
  })

  it('reduce / 零时长：瞬切 settle，不启动远距动画', () => {
    const el = stubEl()
    const m = new PanelMotion(el)
    const settle = vi.fn()
    m.play({ x: 0, y: 0, scale: 1, opacity: 1 }, { x: 9, y: 9, scale: 1, opacity: 1 }, 320, true, settle)
    m.play({ x: 9, y: 9, scale: 1, opacity: 1 }, { x: 0, y: 0, scale: 1, opacity: 1 }, 0, false, settle)
    expect(el.anims).toHaveLength(0)
    expect(settle).toHaveBeenCalledTimes(2)
  })
})

describe('samplePose · matrix 解析（组件 from=当前位姿的数据源）', () => {
  it('解析 translate/scale/opacity；none → 本位', () => {
    expect(samplePose({ transform: 'matrix(0.540348, 0, 0, 0.540348, -349.619, 187.538)', opacity: '0.7' })).toEqual({
      x: -349.619, y: 187.538, scale: 0.540348, opacity: 0.7,
    })
    expect(samplePose({ transform: 'none', opacity: '1' })).toEqual({ x: 0, y: 0, scale: 1, opacity: 1 })
  })
})
