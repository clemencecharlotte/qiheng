import { describe, expect, it } from 'vitest'
import { createPlaybackController, type PlayableEl } from './demoPlaybackController'

function deferred() { let r!: () => void; let j!: (e: unknown) => void; const p = new Promise<void>((res, rej) => { r = res; j = rej }); return { p, resolve: r, reject: j } }
function fakeEl(plays: Array<Promise<void>>) {
  let idx = 0
  const calls = { play: 0, pause: 0 }
  const el: PlayableEl = { paused: true, play() { calls.play++; return plays[idx++] ?? Promise.resolve() }, pause() { calls.pause++; this.paused = true } }
  return { el, calls }
}

describe('M24 C · 播放协调器（explicit 认领 / stale 不认领 / intent latest-wins）', () => {
  it('C1：A 播放中明确点击 B → B 原子接管，A 被暂停', () => {
    const c = createPlaybackController()
    const a = fakeEl([Promise.resolve()]); const b = fakeEl([Promise.resolve()])
    c.setElement('A', a.el); c.setElement('B', b.el)
    c.requestPlay('A'); expect(c.notifyNativePlay('A')).toBe(true)
    c.requestPlay('B'); expect(c.notifyNativePlay('B')).toBe(true)
    expect(c.getActiveId()).toBe('B')
    expect(a.calls.pause).toBeGreaterThan(0)
  })

  it('C1：陈旧 play 事件（非所有者/非 desired）不认领', () => {
    const c = createPlaybackController()
    const a = fakeEl([Promise.resolve()]); const b = fakeEl([Promise.resolve()])
    c.setElement('A', a.el); c.setElement('B', b.el)
    c.requestPlay('B')
    expect(c.notifyNativePlay('A')).toBe(false) // A 非 owner/desired → 调用方应 pause
    expect(c.notifyNativePlay('B')).toBe(true)
  })

  it('A ended 不释放 B 的所有权', () => {
    const c = createPlaybackController()
    const a = fakeEl([Promise.resolve()]); const b = fakeEl([Promise.resolve()])
    c.setElement('A', a.el); c.setElement('B', b.el)
    c.requestPlay('A'); c.notifyNativePlay('A')
    c.requestPlay('B'); c.notifyNativePlay('B')
    expect(c.notifyNativeEnded('A')).toBe(false) // A 非 owner → 不释放
    expect(c.getActiveId()).toBe('B')
  })

  it('C3：同元素 play1→pause→play2，play1 晚 resolve 不暂停合法 play2', async () => {
    const c = createPlaybackController()
    const d1 = deferred(); const d2 = deferred()
    const f = fakeEl([d1.p, d2.p])
    c.setElement('A', f.el)
    c.requestPlay('A')      // play1
    c.requestPause('A')     // 取消 → desired=pause, intent++
    c.requestPlay('A')      // play2（同元素，最新 desired=play）
    const pausesBefore = f.calls.pause
    d1.resolve()            // play1 晚到 resolve
    await Promise.resolve()
    expect(f.calls.pause).toBe(pausesBefore) // 不因旧 resolve 暂停
    d2.resolve(); await Promise.resolve()
    expect(c.getActiveId()).toBe('A')
  })

  it('C2：pending 时再次点击=取消；晚到 reject（AbortError）不误报', async () => {
    const c = createPlaybackController()
    const d = deferred(); const f = fakeEl([d.p])
    let errored = false
    c.setElement('A', f.el); c.onError('A', () => { errored = true })
    c.requestPlay('A')
    c.requestPause('A')               // pending 取消
    d.reject(Object.assign(new Error('x'), { name: 'AbortError' }))
    await Promise.resolve(); await Promise.resolve()
    expect(errored).toBe(false)       // 取消不当 decode 失败
  })

  it('src 换入旧 promise 不污染；unmount 停止并释放', async () => {
    const c = createPlaybackController()
    const d = deferred(); const f = fakeEl([d.p])
    c.setElement('A', f.el); c.requestPlay('A')
    c.setElement('A', null)           // src 换入/卸载：失效 + 暂停 + 释放
    expect(f.calls.pause).toBeGreaterThan(0)
    expect(c.getActiveId()).toBe(null)
    d.resolve(); await Promise.resolve()
    expect(c.getActiveId()).toBe(null) // 旧 resolve 不复活
  })
})

describe('M24 r04 · 协调器时序修正（陈旧 pause / 真失败）', () => {
  it('C1：旧 pause 事件迟到（最新 desired=play）不清 owner，合法新播放不被误停', () => {
    const c = createPlaybackController()
    const el: PlayableEl = { paused: false, play() { this.paused = false; return Promise.resolve() }, pause() { this.paused = true } }
    c.setElement('A', el)
    c.requestPlay('A')       // play1
    c.requestPause('A')      // 取消
    c.requestPlay('A')       // play2（最新 desired=play）
    el.paused = false        // 新播放已开始
    expect(c.notifyNativePause('A')).toBe(false) // 旧 pause 迟到：不清 owner
    expect(c.getActiveId()).toBe('A')
    expect(c.notifyNativePlay('A')).toBe(true)   // 合法新播放仍可认领
  })

  it('C2：play 真失败（非 Abort）→ 失效 intent、释放 owner、触发 error', async () => {
    const c = createPlaybackController()
    let errored = false
    const el: PlayableEl = { paused: true, play() { return Promise.reject(Object.assign(new Error('decode'), { name: 'NotSupportedError' })) }, pause() { this.paused = true } }
    c.setElement('A', el)
    c.onError('A', () => { errored = true })
    c.requestPlay('A')
    await Promise.resolve(); await Promise.resolve()
    expect(errored).toBe(true)
    expect(c.getActiveId()).toBe(null)          // 真失败释放本 owner
    expect(c.notifyNativePlay('A')).toBe(false) // 不再认领
  })
})
