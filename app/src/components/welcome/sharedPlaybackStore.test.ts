import { describe, expect, it } from 'vitest'
import { buildDemoSeries, SharedPlayback } from './sharedPlaybackStore'

describe('M29 D · 共享回放纯逻辑', () => {
  it('合成序列确定性、含缺值 null 且不补零', () => {
    const a = buildDemoSeries(42, 24)
    const b = buildDemoSeries(42, 24)
    expect(a.buckets.length).toBe(24)
    expect(a.buckets.map((x) => x.demand)).toEqual(b.buckets.map((x) => x.demand))
    expect(a.synthetic).toBe(true)
    const gaps = a.buckets.filter((x) => x.demand === null)
    expect(gaps.length).toBeGreaterThan(0)
    // 缺值处 demand 与 supply 同时为 null（不补零）
    for (const g of gaps) expect(g.supply).toBeNull()
  })

  it('seek 夹取范围，step 非循环到末尾停止', () => {
    const store = new SharedPlayback(buildDemoSeries(1, 5))
    store.seek(99)
    expect(store.get().index).toBe(4)
    store.seek(-5)
    expect(store.get().index).toBe(0)
    store.play()
    expect(store.get().playing).toBe(true)
    for (let i = 0; i < 5; i++) store.step(1) // 0→1→2→3→4→末尾(停)
    expect(store.get().index).toBe(4)
    expect(store.get().playing).toBe(false)
    store.dispose()
  })

  it('循环开启时回卷且不冒出实时', () => {
    const store = new SharedPlayback(buildDemoSeries(1, 4))
    store.toggleLoop()
    store.seek(3)
    store.step(1)
    expect(store.get().index).toBe(0)
    store.dispose()
  })

  it('倍速夹取到 [0.5,4]', () => {
    const store = new SharedPlayback(buildDemoSeries(1, 4))
    store.setSpeed(99)
    expect(store.get().speed).toBe(4)
    store.setSpeed(0.1)
    expect(store.get().speed).toBe(0.5)
    store.dispose()
  })
})
