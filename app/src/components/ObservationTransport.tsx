import { useEffect, useState } from 'react'
import {
  PLAY_SPEEDS,
  labelAt,
  rangeFromLabels,
  type PlaySpeed,
  type RangeSummary,
} from '../domain/explore'
import type { ObservationClockApi } from './useObservationClock'

const SPEED_LABEL: Record<PlaySpeed, string> = {
  0.5: '0.5×',
  1: '1×',
  2: '2×',
}

interface Props {
  sourceLabel: string
  api: ObservationClockApi
  onFullWindow: () => void
  onLastHour: () => void
  rangeSummary?: RangeSummary | null
  outOfRange?: string | null
}

export default function ObservationTransport({
  sourceLabel,
  api,
  onFullWindow,
  onLastHour,
  rangeSummary,
  outOfRange,
}: Props) {
  const { state, clock, effectiveIndex, locked, newBuckets } = api
  const count = clock.count

  // 起止时刻区间入口：与刷卡共用同一 range 状态与边界校验。
  const [startText, setStartText] = useState('')
  const [endText, setEndText] = useState('')
  const [rangeError, setRangeError] = useState('')
  useEffect(() => {
    if (api.range) {
      setStartText(labelAt(clock, api.range[0]))
      setEndText(labelAt(clock, api.range[1]))
    } else {
      setStartText(labelAt(clock, 0))
      setEndText(labelAt(clock, count - 1))
    }
    setRangeError('')
  }, [api.range, clock, count])

  const applyRange = () => {
    const result = rangeFromLabels(clock, startText, endText)
    if (result.error || !result.range) {
      setRangeError(result.error ?? '区间无效。')
      return
    }
    setRangeError('')
    api.setRange(result.range)
  }

  return (
    <section className="transport-bar" aria-label="观察时钟与趋势探查">
      <div className="transport-main">
        <button
          type="button"
          className="btn primary transport-play"
          aria-pressed={state.playing}
          onClick={() => { if (!state.playing && api.locked) api.follow(); api.toggle() }}
        >
          {state.playing ? '暂停' : api.locked ? '跟随播放' : '播放'}
        </button>

        <div className="transport-speed" role="group" aria-label="演示回放速度">
          {PLAY_SPEEDS.map((s) => (
            <button
              type="button"
              key={s}
              className={`chip-btn${state.speed === s ? ' active' : ''}`}
              aria-pressed={state.speed === s}
              onClick={() => api.setSpeed(s)}
            >
              {SPEED_LABEL[s]}
            </button>
          ))}
        </div>

        <label className="hint transport-loop"><input type="checkbox" checked={api.looping} onChange={(e) => api.setLooping(e.target.checked)} /> 循环播放</label>
        <span className="tag">来源：{sourceLabel}</span>
        {locked ? (
          <>
            <span className="tag warn" role="status">
              已锁定 · 播放已前进 {newBuckets} 桶
            </span>
            <button type="button" className="btn ghost" onClick={api.follow}>
              {state.playing ? '跟随播放' : '解除锁定'}
            </button>
          </>
        ) : (
          <span className="tag muted">跟随播放</span>
        )}

        <details className="transport-advanced">
          <summary>高级（窗口与清除）</summary>
          <div className="transport-presets">
            <button type="button" className="chip-btn" onClick={onFullWindow}>
              全窗口
            </button>
            <button type="button" className="chip-btn" onClick={onLastHour}>
              最近一小时
            </button>
            <button
              type="button"
              className="chip-btn"
              aria-label="清除观察：清空观察区间、时间锁与悬停游标"
              title="清除观察区间、时间锁与悬停游标"
              onClick={api.resetExplore}
            >
              清除观察
            </button>
          </div>
        </details>

        <details className="transport-range">
          <summary aria-label="观察区间：按起止时刻设置（键盘可展开）">
            观察区间
          </summary>
          <div
            className="transport-range-body"
            role="group"
            aria-label="按起止时刻设置观察区间"
          >
            <label className="transport-range-field">
              <span>起</span>
              <input
                type="time"
                value={startText}
                onChange={(e) => setStartText(e.target.value)}
                aria-label="观察区间起时刻"
              />
            </label>
            <label className="transport-range-field">
              <span>止</span>
              <input
                type="time"
                value={endText}
                onChange={(e) => setEndText(e.target.value)}
                aria-label="观察区间止时刻"
              />
            </label>
            <button type="button" className="chip-btn" onClick={applyRange}>
              应用区间
            </button>
            <button
              type="button"
              className="chip-btn"
              onClick={() => {
                api.setRange(null)
                setRangeError('')
              }}
            >
              清除区间
            </button>
            {rangeError ? (
              <span className="neg" role="alert">
                {rangeError}
              </span>
            ) : null}
          </div>
        </details>

        <details className="transport-help">
          <summary>播放说明</summary>
          <p className="hint">
            速度仅用于演示回放；按真实桶推进，{api.looping ? '循环开启时不暂停（末端回到首桶）' : '循环关闭时到末端自动暂停'}，页面隐藏时始终暂停。
            循环不合并跨圈累计、不代表现场实时。播放 / 悬停 / 刷选不触发求解、审批或执行命令。
          </p>
        </details>
      </div>

      <label className="transport-slider">
        <span className="transport-slider-label">
          时间滑块（锁时）：{api.observationLabel}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, count - 1)}
          step={1}
          value={effectiveIndex}
          aria-label="观察时刻时间滑块"
          onChange={(e) => api.lockIndex(Number(e.target.value))}
        />
      </label>

      {rangeSummary ? (
        <details className="range-summary qh-note-details">
          <summary>区间摘要</summary>
          <span role="status">{rangeSummary.note}</span>
        </details>
      ) : null}
      {outOfRange ? (
        <div className="range-outside" role="status">
          {outOfRange}
        </div>
      ) : null}
    </section>
  )
}