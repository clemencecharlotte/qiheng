// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Player from './NativeDemoPlayer'
import { createPlaybackController } from './demoPlaybackController'

describe('actual NativeDemoPlayer DOM lifecycle (mock media boundary only)', () => {
  let host: HTMLDivElement
  let root: Root
  let mounted: boolean
  let ctrl: ReturnType<typeof createPlaybackController>
  let requests: Array<{ video: HTMLMediaElement; resolve: () => void; reject: (e: unknown) => void }>
  let disconnect: ReturnType<typeof vi.fn>
  const pauseCounts = new WeakMap<HTMLMediaElement, number>()
  let paused: WeakMap<HTMLMediaElement, boolean>
  let ioCallback: (entries: IntersectionObserverEntry[]) => void
  const render = async (src = 'one.webm') => {
    await act(async () => root.render(<Player assetId="ask" src={src} captions="ask.vtt" poster="ask.png" events={[]} label="实际录制" controller={ctrl} />))
  }
  const button = (text: string) => {
    const b = Array.from(host.querySelectorAll('button')).find((el) => el.textContent === text)
    expect(b, 'actual button ' + text).toBeTruthy()
    return b as HTMLButtonElement
  }
  const click = async (text: string) => { await act(async () => button(text).click()) }
  const event = async (el: Element, type: string) => { await act(async () => el.dispatchEvent(new Event(type))) }
  beforeEach(() => {
    requests = []; paused = new WeakMap(); ctrl = createPlaybackController(); mounted = true
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: (e: IntersectionObserverEntry[]) => void) { ioCallback = cb }
      observe = vi.fn(); disconnect = disconnect
    })
    vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) { return paused.get(this) ?? true })
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { paused.set(this, true); pauseCounts.set(this, (pauseCounts.get(this) ?? 0) + 1) })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      return new Promise<void>((resolve, reject) => requests.push({ video: this, resolve: () => { paused.set(this, false); resolve() }, reject }))
    })
  })
  afterEach(async () => {
    if (mounted) await act(async () => root.unmount())
    host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  })
  it('video error renders poster/retry and retry mounts a new media element', async () => {
    await render(); const original = host.querySelector('video')!
    await event(original, 'error')
    expect(host.textContent).toContain('演示加载失败'); expect(host.querySelector('img')?.getAttribute('src')).toBe('ask.png')
    await click('重试')
    expect(host.querySelector('video')).not.toBe(original); expect(host.textContent).not.toContain('演示加载失败')
  })
  it('track failure/retry/load is consumed by the actual caption controls', async () => {
    await render(); const oldTrack = host.querySelector('track')!
    expect(button('字幕加载中…').disabled).toBe(true)
    await event(oldTrack, 'error'); await click('字幕失效 · 重试')
    expect(button('字幕加载中…').disabled).toBe(true)
    const newTrack = host.querySelector('track')!; expect(newTrack).not.toBe(oldTrack)
    await event(newTrack, 'load'); expect(button('字幕开').getAttribute('aria-pressed')).toBe('true')
  })
  it('old rejected play after src replacement cannot mark new player failed', async () => {
    await render(); await click('播放'); const old = requests[0]
    await render('two.webm')
    await act(async () => old.reject(new Error('old network rejection')))
    expect(host.textContent).not.toContain('演示加载失败')
    await click('播放'); const current = requests[1]
    await act(async () => current.resolve()); await event(host.querySelector('video')!, 'play')
    expect(button('暂停')).toBeTruthy(); expect(ctrl.getActiveId()).toBe('ask')
  })
  it('unmount invalidates delayed play and disconnects observer; old resolve pauses old element', async () => {
    await render(); await click('播放'); const old = requests[0]
    await act(async () => root.unmount()); mounted = false
    expect(disconnect).toHaveBeenCalled(); expect(ctrl.getActiveId()).toBeNull()
    const before = pauseCounts.get(old.video) ?? 0
    await act(async () => old.resolve())
    expect(pauseCounts.get(old.video)).toBeGreaterThan(before); expect(host.childElementCount).toBe(0)
  })
  it('actual offscreen callback pauses without automatically restarting on re-entry', async () => {
    await render(); await click('播放'); await act(async () => requests[0].resolve()); await event(host.querySelector('video')!, 'play')
    await act(async () => ioCallback([{ isIntersecting: false } as IntersectionObserverEntry]))
    expect(ctrl.getActiveId()).toBeNull(); expect(host.querySelector('[data-in-view]')?.getAttribute('data-in-view')).toBe('false')
    const count = requests.length
    await act(async () => ioCallback([{ isIntersecting: true } as IntersectionObserverEntry]))
    expect(requests.length).toBe(count)
  })
})
