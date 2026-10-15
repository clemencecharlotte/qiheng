import { describe, expect, it } from 'vitest'
import { nudgePose, viewportProgress } from './useNudgeProgress'

describe('nudgePose · 双向同路径（同 progress 恒同姿态）', () => {
  it('progress=0 初态偏移（模块刚进入）；progress=1 本位——桌面偏移 (-24,32,-1deg,.985)', () => {
    const full = nudgePose(0, false)
    expect(full.x).toBe(-24)
    expect(full.y).toBe(32)
    expect(full.rot).toBe(-1)
    expect(full.scale).toBeCloseTo(0.985, 5)
    expect(full.opacity).toBeCloseTo(0.55, 5)
    expect(nudgePose(1, false)).toEqual({ x: 0, y: 0, rot: 0, scale: 1, opacity: 1 })
  })
  it('mobile 幅度减半 (-12,16,-0.5deg)', () => {
    const m = nudgePose(0, true) // 初态（p=0）为最大偏移
    expect(m.x).toBe(-12)
    expect(m.y).toBe(16)
    expect(m.rot).toBe(-0.5)
  })
  it('A→B→C→B→A 往返：同 progress 值输出完全相同姿态（纯函数，无锁无队列）', () => {
    const seq = [0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]
    const poses = seq.map((p) => JSON.stringify(nudgePose(p, false)))
    // 正向与回退经同一点：0.25 出现两次姿态一致；0.5/0.75 同理
    expect(poses[1]).toBe(poses[7])
    expect(poses[2]).toBe(poses[6])
    expect(poses[3]).toBe(poses[5])
  })
  it('clamp：越界/NaN 收敛（>1 本位，<0 初态）', () => {
    expect(nudgePose(1.4, false).x).toBe(0)
    expect(nudgePose(-0.4, false).x).toBe(-24)
    expect(nudgePose(Number.NaN, false).x).toBe(-24)
  })
})

describe('viewportProgress · 视口相对位置连续映射', () => {
  const vh = 900
  const rectAt = (top: number) => ({ top } as DOMRect)
  it('模块顶 88%vh → 0；30%vh → 1；中间线性', () => {
    expect(viewportProgress(rectAt(vh * 0.88), vh)).toBe(0)
    expect(viewportProgress(rectAt(vh * 0.3), vh)).toBe(1)
    expect(viewportProgress(rectAt((vh * 0.88 + vh * 0.3) / 2), vh)).toBeCloseTo(0.5, 5)
  })
  it('离开区间 clamp [0,1]', () => {
    expect(viewportProgress(rectAt(vh), vh)).toBe(0)
    expect(viewportProgress(rectAt(-50), vh)).toBe(1)
  })
})
