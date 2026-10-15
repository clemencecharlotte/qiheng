/**
 * M24 C · 播放协调器（可注入 fake video，纯状态 + 明确 owner/intent 合同）。
 *
 * 解决 r02 残留：
 * - C1：用户**明确**点击 B 应能原子认领（active=B，desired[B]=play，desired[A]=pause 并暂停 A）——
 *   不再“他者 active 就拒绝”导致无法切换；原生 play 事件只在 desired/owner 一致时认领，陈旧事件不认领。
 * - C2：独立 desired intent；pending 时再次点击=取消（pause），pause/换源/卸载恒失效（intent++）。
 * - C3：旧 request 晚到 resolve，仅当**元素已换**或**最新 desired 已要求 pause**才 pause；
 *   同元素且最新仍 desired=play → 不对其发旧 pause。
 * 元素接口最小化，便于注入 fake video 窄测。
 */

export interface PlayableEl {
  paused: boolean
  play(): Promise<void>
  pause(): void
}

type Desired = 'idle' | 'play' | 'pause'

export interface PlaybackController {
  setElement(id: string, el: PlayableEl | null): void
  requestPlay(id: string): void
  requestPause(id: string): void
  /** 原生 play 事件：返回是否认领（false → 调用方应立即 pause，陈旧不认领）。 */
  notifyNativePlay(id: string): boolean
  /** 原生 pause 事件：返回是否释放（owner===id）。 */
  notifyNativePause(id: string): boolean
  /** 原生 ended：返回是否释放（owner===id，不清他者）。 */
  notifyNativeEnded(id: string): boolean
  /** 真失败（decode/network）：失效 intent、desired→停止、释放本 owner。 */
  notifyError(id: string): void
  dispose(id: string): void
  getActiveId(): string | null
  subscribe(cb: (active: string | null) => void): () => void
  onError(id: string, cb: (err: unknown) => void): () => void
}

export function createPlaybackController(): PlaybackController {
  const els = new Map<string, PlayableEl>()
  const desired = new Map<string, Desired>()
  const intent = new Map<string, number>()
  const errCbs = new Map<string, Set<(err: unknown) => void>>()
  const subs = new Set<(a: string | null) => void>()
  let active: string | null = null

  const setActive = (id: string | null) => {
    if (active === id) return
    active = id
    for (const cb of subs) cb(active)
  }

  const playIt = (id: string) => {
    const el = els.get(id)
    if (!el) return
    const myEl = el
    const it = (intent.get(id) ?? 0) + 1
    intent.set(id, it)
    myEl.play().then(() => {
      // 晚到 resolve：仅当元素已换 或 最新 desired 已非 play（要求 pause）才暂停；
      // 同元素且最新仍 desired=play → 不对其发旧 pause（不误停合法 play2）。
      if (intent.get(id) !== it && (els.get(id) !== myEl || desired.get(id) !== 'play')) myEl.pause()
    }).catch((err: unknown) => {
      if (intent.get(id) !== it) return
      if ((err as { name?: string } | null)?.name === 'AbortError') return
      // 真正失败：失效 intent、desired→停止、释放本 owner（不只有 setErrored）。
      intent.set(id, (intent.get(id) ?? 0) + 1)
      desired.set(id, 'pause')
      if (active === id) setActive(null)
      for (const cb of errCbs.get(id) ?? []) cb(err)
    })
  }

  return {
    setElement(id, el) {
      const prev = els.get(id)
      if (el === null) {
        intent.set(id, (intent.get(id) ?? 0) + 1) // 失效旧 intent
        desired.set(id, 'idle')
        prev?.pause()
        if (active === id) setActive(null)
        els.delete(id)
        return
      }
      els.set(id, el)
    },
    requestPlay(id) {
      // 明确意图：认领 id，其它 desired=play 者转为 pause 并暂停（允许切换 A→B）。
      for (const [other, d] of desired) {
        if (other !== id && d === 'play') {
          desired.set(other, 'pause')
          intent.set(other, (intent.get(other) ?? 0) + 1)
          els.get(other)?.pause()
        }
      }
      desired.set(id, 'play')
      setActive(id)
      playIt(id)
    },
    requestPause(id) {
      desired.set(id, 'pause')
      intent.set(id, (intent.get(id) ?? 0) + 1) // pending 取消：晚到 resolve/reject 失效
      els.get(id)?.pause()
      if (active === id) setActive(null)
    },
    notifyNativePlay(id) {
      // 陈旧/非所有者不认领（调用方暂停）。
      if (desired.get(id) !== 'play' || active !== id) return false
      return true
    },
    notifyNativePause(id) {
      // 陈旧 pause（最新仍 desired=play）：不清 owner，避免误停合法新播放。
      if (desired.get(id) === 'play') return false
      if (active === id) { setActive(null); return true }
      return false
    },
    notifyNativeEnded(id) {
      if (active === id) { desired.set(id, 'pause'); setActive(null); return true }
      return false
    },
    notifyError(id) {
      intent.set(id, (intent.get(id) ?? 0) + 1)
      desired.set(id, 'idle')
      if (active === id) setActive(null)
    },
    dispose(id) {
      intent.set(id, (intent.get(id) ?? 0) + 1)
      desired.set(id, 'idle')
      els.get(id)?.pause()
      els.delete(id)
      if (active === id) setActive(null)
    },
    getActiveId: () => active,
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb) },
    onError(id, cb) {
      const set = errCbs.get(id) ?? new Set()
      set.add(cb); errCbs.set(id, set)
      return () => set.delete(cb)
    },
  }
}
