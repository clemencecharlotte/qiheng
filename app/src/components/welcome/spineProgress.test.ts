import { describe, expect, it } from 'vitest'
import { buildSpine, segmentsFromPoints, spineProgressAt, type SpineSeg } from './spineProgress'

describe('M22 · 叙事线进度（分段弧长 + 阅读线投射）', () => {
  it('纵向进度按纵段落点，长横段不在中途吃进度', () => {
    // 竖(0..100) → 长横(100..2000) → 竖(2000..2100)
    const pts = [
      { x: 0, y: 0 }, { x: 0, y: 100 }, { x: 2000, y: 100 }, { x: 2000, y: 2000 },
    ]
    const segs = segmentsFromPoints(pts)
    // 阅读线在首个竖段中点 → 进度约为该纵段一半弧长占比
    const pMid = spineProgressAt(segs, 50)
    expect(pMid).toBeGreaterThan(0)
    expect(pMid).toBeLessThan(0.05) // 全长含 1900 长横，纵段占比很小 → 不因长横提前跳
    // 阅读线越过横段 Y 之后才计入横段
    const before = spineProgressAt(segs, 100) // 恰在横段 Y
    const after = spineProgressAt(segs, 150)
    expect(after).toBeGreaterThan(before)
  })

  it('单调、同位置同姿态、上下可逆', () => {
    const segs = segmentsFromPoints([{ x: 10, y: 0 }, { x: 10, y: 500 }, { x: 300, y: 500 }, { x: 300, y: 900 }])
    const ys = [0, 100, 250, 500, 700, 900, 1200]
    const ps = ys.map((y) => spineProgressAt(segs, y))
    for (let i = 1; i < ps.length; i += 1) expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1])
    expect(spineProgressAt(segs, 300)).toBe(spineProgressAt(segs, 300))
    expect(ps[0]).toBe(0)
    expect(spineProgressAt(segs, 99999)).toBe(1)
  })

  it('段判定：纵/横分类', () => {
    const segs: SpineSeg[] = segmentsFromPoints([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 100, y: 10 }])
    expect(segs[0].vertical).toBe(true)
    expect(segs[1].vertical).toBe(false)
  })
})

describe('M22 · buildSpine（原构图 + 冲突段局部避让）', () => {
  const base = { baseX: 500, startY: 0, turnY: 1000, laneX: 100, ctaY: 1200, ctaX: 80 }

  it('无冲突盒 → 退化原直线路径（单子路径）', () => {
    const { subpaths } = buildSpine(base, [])
    expect(subpaths.length).toBe(1)
    expect(subpaths[0][0]).toEqual({ x: 500, y: 0 })
  })

  it('小冲突盒 → 局部偏移 ≤maxOffset 并立即回原线（单子路径）', () => {
    const box = { left: 480, right: 520, top: 200, bottom: 400 } // 穿 baseX=500
    const { subpaths } = buildSpine(base, [box], { maxOffset: 160, margin: 20 })
    expect(subpaths.length).toBe(1)
    const xs = subpaths[0].map((p) => p.x)
    expect(Math.max(...xs)).toBeLessThanOrEqual(500 + 160) // 偏移受限
    expect(subpaths[0][subpaths[0].length - 1]).toEqual({ x: base.ctaX, y: base.ctaY }) // 回原路线终点
  })

  it('超 maxOffset 的大冲突盒 → 短段断开（多子路径），不长横扫', () => {
    const box = { left: -5000, right: 5000, top: 200, bottom: 400 } // 两侧 gutter 都远超 160
    const { subpaths } = buildSpine(base, [box], { maxOffset: 160 })
    expect(subpaths.length).toBeGreaterThan(1)
  })

  // r42 · 矩阵 L96-107 收尾：小屏 simplified 直线 segs 的中段/反向推进回归锁（浏览器实走仍归 D 层）
  it('simplified 直线 segs 中段真推进且可逆（r40 修复回归锁）', () => {
    const segs = segmentsFromPoints([{ x: 10, y: 0 }, { x: 10, y: 400 }])
    expect(spineProgressAt(segs, 200)).toBeCloseTo(0.5, 9)
    expect(spineProgressAt(segs, 100)).toBeLessThan(spineProgressAt(segs, 300))
    expect(spineProgressAt(segs, 400)).toBe(1)
    const withBox = buildSpine({ baseX: 100, startY: 0, turnY: 600, laneX: 40, ctaY: 900, ctaX: 40 }, [
      { left: 80, right: 140, top: 200, bottom: 300 },
    ]).segs
    const pm = spineProgressAt(withBox, 450)
    expect(pm).toBeGreaterThan(0.2)
    expect(pm).toBeLessThan(0.9)
  })
})
