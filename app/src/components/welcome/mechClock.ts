/**
 * r41 · 机构相位时钟：消费宿主共享回放（hostPlayback 的 playing/speed/index/loop），
 * 不另造 seed 数据或独立时钟。暂停=冻结相位；恢复=续相；seek（index 跳变）=确定性终态；
 * 后台/离屏=不推进（rAF 自然停 + 订阅门）；reduce=永不推进，由消费方落静态关键相位。
 *
 * 单一 rAF 循环（模块级），仅当存在"活动订阅者"且宿主 playing 时推进；30fps 节流通知。
 * 订阅者（moving 的卡/舞台）拿到相位秒后乘自身倍率（loading 2.6×）消费。
 */
import { useEffect, useRef, useState } from 'react'
import { SECONDS_PER_HOST_INDEX } from './deviceKinematics'

export interface MechClockSource { playing: boolean; speed: number; index: number }

interface ClockState {
  t: number
  lastIndex: number
  raf: number
  lastTs: number
  lastNotify: number
  active: number
  src: MechClockSource | null
  subs: Set<(t: number) => void>
}
const clock: ClockState = { t: 0, lastIndex: -1, raf: 0, lastTs: 0, lastNotify: 0, active: 0, src: null, subs: new Set() }

function step(ts: number) {
  const dt = clock.lastTs ? Math.min(0.1, (ts - clock.lastTs) / 1000) : 0
  clock.lastTs = ts
  const src = clock.src
  if (src && clock.active > 0) {
    if (src.index !== clock.lastIndex) { clock.t = SECONDS_PER_HOST_INDEX * src.index; clock.lastIndex = src.index }
    if (src.playing && typeof document !== 'undefined' && !document.hidden) clock.t += dt * src.speed
  }
  if (ts - clock.lastNotify > 33) {
    clock.lastNotify = ts
    clock.subs.forEach((cb) => cb(clock.t))
  }
  clock.raf = requestAnimationFrame(step)
}
function ensureLoop() {
  if (!clock.raf && typeof requestAnimationFrame !== 'undefined') { clock.lastTs = 0; clock.raf = requestAnimationFrame(step) }
}
function maybeStop() {
  if (clock.raf && clock.subs.size === 0) { cancelAnimationFrame(clock.raf); clock.raf = 0 }
}

/** 宿主回放源绑定（DeviceSystemExperience 单一写者；null = 无宿主时钟，相位冻结）。 */
export function bindMechSource(src: MechClockSource | null) {
  clock.src = src
  if (src) clock.lastIndex = src.index
}
export function mechPhaseNow(): number { return clock.t }

const REDUCE_Q = '(prefers-reduced-motion: reduce)'
export function motionReduced(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCE_Q).matches
}

/**
 * 活动订阅者返回实时相位秒；非活动（待机/故障/离屏/后台）返回 staticT（确定性静态相位）。
 * reduce 时一律 staticT（完整静态关键相位，配合界面说明）。
 */
export function useMechPhase(active: boolean, staticT: number): number {
  const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCE_Q).matches
  const live = active && !reduced
  const [t, setT] = useState<number>(() => (live ? clock.t : staticT))
  const liveRef = useRef(live)
  liveRef.current = live
  useEffect(() => {
    if (!liveRef.current) { setT(staticT); return }
    const cb = (v: number) => setT(v)
    clock.subs.add(cb); clock.active += 1; ensureLoop(); cb(clock.t)
    return () => { clock.subs.delete(cb); clock.active -= 1; maybeStop() }
  }, [live, staticT])
  return live ? t : staticT
}
