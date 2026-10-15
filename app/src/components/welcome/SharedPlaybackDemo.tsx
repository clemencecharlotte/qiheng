import { useEffect, useMemo, useSyncExternalStore, useState } from 'react'
import { buildDemoSeries, SharedPlayback, type DemoDeviceState } from './sharedPlaybackStore'

const DEVICE_LABEL: Record<DemoDeviceState, string> = {
  running: '运行（演示）',
  standby: '待机（演示）',
  fault: '故障（演示）',
  loading: '加载（演示）',
}

const VB_W = 520
const VB_H = 120
const PAD = 10

function pathFor(values: (number | null)[], lo: number, hi: number): string {
  if (values.length === 0) return ''
  const span = Math.max(0.001, hi - lo)
  const x = (i: number) => PAD + (i / Math.max(1, values.length - 1)) * (VB_W - PAD * 2)
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (VB_H - PAD * 2)
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v === null) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `
    pen = true
  })
  return d.trim()
}

export default function SharedPlaybackDemo() {
  const store = useMemo(() => new SharedPlayback(buildDemoSeries(42, 24)), [])
  const snap = useSyncExternalStore(store.subscribe, store.get, store.get)
  const [reduced, setReduced] = useState(false)

  useEffect(() => () => store.dispose(), [store])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])

  // 后台/不可见时暂停装饰推进（不丢用户进度）。
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVis = () => { if (document.hidden) store.pause() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [store])

  const demand = snap.series.buckets.map((b) => b.demand)
  const supply = snap.series.buckets.map((b) => b.supply)
  const nums = [...demand, ...supply].filter((v): v is number => v !== null)
  const lo = nums.length ? Math.min(...nums) - 0.3 : 0
  const hi = nums.length ? Math.max(...nums) + 0.3 : 1
  const cur = snap.bucket
  const n = snap.series.buckets.length

  return (
    <div className="qh-shared-pb" aria-label="共享时间轴演示（合成，非现场）">
      <div className="qh-shared-pb-head">
        <span className="tag">{snap.series.sourceLabel}</span>
        <span className="tag muted" data-testid="spb-clock">同源时刻 {cur?.label ?? '—'}</span>
        {snap.loop ? <span className="tag muted">循环（非实时）</span> : null}
        {reduced ? <span className="tag muted">减弱动效</span> : null}
      </div>

      <svg className="qh-shared-pb-svg" viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label="需求与供气趋势（合成，缺值断开不补零）">
        <path className="spb-line demand" d={pathFor(demand, lo, hi)} fill="none" />
        <path className="spb-line supply" d={pathFor(supply, lo, hi)} fill="none" />
        <circle className="spb-cursor" cx={PAD + (snap.index / Math.max(1, n - 1)) * (VB_W - PAD * 2)} cy={VB_H / 2} r={3} />
      </svg>

      <div className="qh-shared-pb-bars" role="group" aria-label="逐桶（当前高亮）">
        {snap.series.buckets.map((b) => (
          <button
            type="button"
            key={b.index}
            className={`spb-bar${b.index === snap.index ? ' on' : ''}${b.demand === null ? ' gap' : ''}`}
            aria-pressed={b.index === snap.index}
            aria-label={`第 ${b.index + 1} 桶 ${b.label}${b.demand === null ? ' 缺值' : ` 需求 ${b.demand}`}`}
            onClick={() => store.seek(b.index)}
          >
            <span style={{ height: b.demand === null ? '8%' : `${Math.min(100, Math.max(8, (b.demand / (hi || 1)) * 100))}%` }} />
          </button>
        ))}
      </div>

      <div className={`qh-shared-pb-device${cur ? ` is-${cur.device}` : ''}`} data-demo-state={cur?.device ?? 'standby'}>
        <span className="spb-device-dot" aria-hidden="true" />
        设备状态：{cur ? DEVICE_LABEL[cur.device] : '—'}
        <span className={`spb-pipe${cur?.device === 'running' ? ' on' : ''}`} aria-hidden="true" />
      </div>

      <p className="qh-shared-pb-readout" role="status" data-testid="spb-readout">
        第 {snap.index + 1} 桶 · 需求 {cur?.demand ?? '缺值（未知）'} · 供气 {cur?.supply ?? '缺值（未知）'}
      </p>

      <div className="qh-shared-pb-ctrl" role="group" aria-label="回放控制">
        <button type="button" className="btn ghost" onClick={() => (snap.playing ? store.pause() : store.play())} aria-pressed={snap.playing}>
          {snap.playing ? '暂停' : '播放'}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, n - 1)}
          step={1}
          value={snap.index}
          aria-label="定位桶"
          onChange={(e) => store.seek(Number(e.target.value))}
        />
        <label className="spb-speed">
          倍速
          <select value={snap.speed} onChange={(e) => store.setSpeed(Number(e.target.value))} aria-label="回放倍速">
            {[0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <button type="button" className="btn ghost" onClick={() => store.toggleLoop()} aria-pressed={snap.loop}>循环</button>
      </div>
      <p className="hint">同一时间轴驱动趋势 / 柱图 / 设备状态 / 管网流向 / 时间标签；缺失不补零、循环非实时、来源不同不并入同一复验；不自动求解 / 封存 / 审批 / 启动。</p>
    </div>
  )
}
