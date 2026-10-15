/**
 * M29 D · 共享回放纯逻辑（仅内存，无业务副作用）。
 * 一个共享时间轴驱动趋势 / 柱图 / 设备状态 / 管网流向 / 时间标签：跨区同一 index。
 * 合成夹具显式标记；缺值保持 null（不补零）；来源不同不并入同一分母；循环非实时。
 * 不自动求解 / 封存 / 审批 / Start / advance。
 */
export type DemoDeviceState = 'running' | 'standby' | 'fault' | 'loading'

export interface SharedBucket {
  index: number
  label: string
  /** 需求（合成）；缺值 null，不补零。 */
  demand: number | null
  /** 供气（合成）；缺值 null。 */
  supply: number | null
  device: DemoDeviceState
}

export interface SharedSeries {
  id: string
  sourceLabel: string
  synthetic: true
  buckets: SharedBucket[]
}

export interface SharedPlaybackState {
  index: number
  playing: boolean
  speed: number
  loop: boolean
}

export interface SharedSnapshot extends SharedPlaybackState {
  series: SharedSeries
  bucket: SharedBucket | null
}

/** 确定性合成夹具（无随机真值；缺值用 null 明确表达）。 */
export function buildDemoSeries(seed: number, count = 24): SharedSeries {
  const states: DemoDeviceState[] = ['running', 'running', 'standby', 'running', 'loading', 'fault']
  const buckets: SharedBucket[] = []
  let x = seed >>> 0
  const rnd = () => {
    x = (x * 1664525 + 1013904223) >>> 0
    return x / 0xffffffff
  }
  for (let i = 0; i < count; i++) {
    const phase = i / count
    const base = 3.2 + Math.sin(phase * Math.PI * 2) * 1.1
    // 故意制造缺值窗口（不补零）
    const gap = i % 7 === 5
    const stateIdx = Math.floor(phase * states.length * 2) % states.length
    buckets.push({
      index: i,
      label: `${String(8 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
      demand: gap ? null : Number((base + rnd() * 0.3).toFixed(2)),
      supply: gap ? null : Number((base - 0.25 + rnd() * 0.25).toFixed(2)),
      device: states[stateIdx],
    })
  }
  return { id: `demo-${seed}`, sourceLabel: '合成演示序列（非现场）', synthetic: true, buckets }
}

export class SharedPlayback {
  private state: SharedPlaybackState
  private snapshot: SharedSnapshot
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private series: SharedSeries) {
    this.state = { index: 0, playing: false, speed: 1, loop: false }
    this.snapshot = this.compose()
  }

  private compose(): SharedSnapshot {
    return { ...this.state, series: this.series, bucket: this.series.buckets[this.state.index] ?? null }
  }

  private emit() {
    this.snapshot = this.compose()
    this.listeners.forEach((l) => l())
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }

  get = (): SharedSnapshot => this.snapshot

  private clearTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private arm() {
    this.clearTimer()
    if (!this.state.playing) return
    // 每秒推进一个桶 × speed；循环到末尾回卷（接缝在 UI 标注）。
    this.timer = setInterval(() => this.step(1), Math.max(120, 1000 / this.state.speed))
  }

  step(delta: number) {
    const n = this.series.buckets.length
    if (n === 0) return
    let next = this.state.index + delta
    if (next >= n) {
      if (this.state.loop) next = next % n
      else {
        next = n - 1
        this.state = { ...this.state, index: next, playing: false }
        this.clearTimer()
        this.emit()
        return
      }
    } else if (next < 0) next = this.state.loop ? (next + n) % n : 0
    this.state = { ...this.state, index: next }
    this.emit()
  }

  play() {
    if (this.state.playing) return
    this.state = { ...this.state, playing: true }
    this.emit()
    this.arm()
  }

  pause() {
    if (!this.state.playing) return
    this.state = { ...this.state, playing: false }
    this.emit()
    this.clearTimer()
  }

  seek(index: number) {
    const n = this.series.buckets.length
    if (n === 0) return
    const i = Math.min(n - 1, Math.max(0, Math.round(index)))
    this.state = { ...this.state, index: i }
    this.emit()
  }

  setSpeed(speed: number) {
    const s = Math.min(4, Math.max(0.5, speed))
    this.state = { ...this.state, speed: s }
    this.emit()
    if (this.state.playing) this.arm()
  }

  toggleLoop() {
    this.state = { ...this.state, loop: !this.state.loop }
    this.emit()
  }

  dispose() {
    this.clearTimer()
    this.listeners.clear()
  }
}
