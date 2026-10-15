import { replayWindow } from './replayWindow'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScenarioRun } from '../domain/engine'
import type { PeriodPlan, PlanResult } from '../domain/types'
import type { ObservationClockApi } from './useObservationClock'

interface Props {
  run: ScenarioRun
  plan: PlanResult
  planLabel: string
  activeUnitId: string | null
  activeHasBranch: boolean
  api: ObservationClockApi
}

const WIDTH = 720
/**
 * 完整视口：不裁切曲线与图例。y 域、坐标轴、曲线与观察线全部由 HEIGHT/PAD
 * 推导，改视口即整体重算（不是裁图）。宽度 100% + height:auto 时元素宽高比
 * 恒等于 viewBox 比例；拖刷与 tooltip 都用 getScreenCTM() 把 SVG 用户坐标
 * 映射到屏幕坐标，尺寸变化后不失配。
 */
const HEIGHT = 158
const PAD = { top: 12, right: 12, bottom: 24, left: 36 }
const PLOT_W = WIDTH - PAD.left - PAD.right
const PLOT_H = HEIGHT - PAD.top - PAD.bottom
/** 供气与需求视为“重合”的容差（m³/min）。 */
const COINCIDE_EPS = 0.05

function pathFor(
  values: Array<number | null>,
  yAt: (v: number) => number,
): string {
  const n = values.length
  if (n === 0) return ''
  const xAt = (i: number) => PAD.left + (i / Math.max(1, n - 1)) * PLOT_W
  let started = false
  let d = ''
  values.forEach((v, i) => {
    if (v === null) {
      started = false
      return
    }
    d += `${started ? ' L' : 'M'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`
    started = true
  })
  return d
}

function xAt(i: number, count: number): number {
  return PAD.left + (i / Math.max(1, count - 1)) * PLOT_W
}

function tickIndices(count: number): number[] {
  const fractions = [0, 0.25, 0.5, 0.75, 1]
  const set = new Set<number>()
  for (const f of fractions) set.add(Math.round(f * (count - 1)))
  return [...set].sort((a, b) => a - b)
}

export default function SupplyDemandTrend({
  run,
  plan,
  planLabel,
  activeUnitId,
  activeHasBranch,
  api,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const draggingRef = useRef(false)
  const downRef = useRef<{ x: number; y: number; touch: boolean } | null>(null)
  const [sizeNonce, setSizeNonce] = useState(0)
  const [showDemand, setShowDemand] = useState(true)
  const [showSupply, setShowSupply] = useState(true)
  const [showBranch, setShowBranch] = useState(true)
  const [showDiff, setShowDiff] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let frame = 0
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setSizeNonce((n) => n + 1))
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const [dynamic, setDynamic] = useState(true)
  const points = run.series.points
  const count = points.length
  const projection = useRef(replayWindow(count, api.effectiveIndex, dynamic))
  // Preserve the exact screen-to-index mapping throughout a drag; a saved range does not disable replay.
  if (api.state.brushStart === null) projection.current = replayWindow(count, api.effectiveIndex, dynamic)
  const [windowStart, windowEnd] = projection.current
  const windowCount = windowEnd - windowStart
  const chartX = (i: number) => xAt(Math.min(windowCount - 1, Math.max(0, i - windowStart)), windowCount)
  const demand = points.map((p) => p.demand)
  const hasPlan = plan.feasible && plan.periods.length > 0

  const periodByIndex = useMemo(() => {
    const map = new Map<number, PeriodPlan>()
    for (const p of plan.periods) map.set(p.index, p)
    return map
  }, [plan])

  const supply = points.map((p) => {
    if (!hasPlan) return null
    const period = periodByIndex.get(p.index)
    return period ? period.supply : null
  })
  const branch =
    hasPlan && activeUnitId && activeHasBranch
      ? points.map((p) => {
          const period = periodByIndex.get(p.index)
          if (!period) return null
          return activeUnitId in period.unitLoads ? period.unitLoads[activeUnitId] : null
        })
      : null
  const diff = hasPlan
    ? points.map((p, i) => {
        const s = supply[i]
        return s === null ? null : s - p.demand
      })
    : null

  const hasBranch = branch !== null
  const demandSupplyCoincide =
    hasPlan &&
    supply.every((v) => v !== null) &&
    points.every((p, i) => Math.abs((supply[i] as number) - p.demand) <= COINCIDE_EPS)

  // 差值模式的 y 域需覆盖负值；默认 0..max。
  const diffValues = (diff ?? []).filter((v): v is number => v !== null)
  const diffMin = diffValues.length > 0 ? Math.min(0, ...diffValues) : 0
  const diffMax = diffValues.length > 0 ? Math.max(0, ...diffValues) : 1
  const zeroLineY = (() => {
    const span = Math.max(1e-6, diffMax - diffMin)
    const scale = diffMax === diffMin ? 1 : 1 / span
    return PAD.top + PLOT_H - (0 - diffMin) * scale * PLOT_H
  })()

  const allValues = [
    ...(showDemand ? demand : []),
    ...(showSupply ? supply.filter((v): v is number => v !== null) : []),
    ...(showBranch && branch
      ? branch.filter((v): v is number => v !== null)
      : []),
  ]
  const max = Math.max(1, ...allValues) * 1.1

  const seriesY = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H
  const diffY = (v: number) => {
    const span = Math.max(1e-6, diffMax - diffMin)
    return PAD.top + PLOT_H - ((v - diffMin) / span) * PLOT_H
  }

  const obsIndex = api.effectiveIndex
  const obsX = chartX(obsIndex)
  const hoverIndex = api.hoverIndex
  const range = api.range

  const indexFromClientX = (clientX: number): number => {
    const svg = svgRef.current
    if (!svg) return obsIndex
    let svgX: number
    const ctm = svg.getScreenCTM?.()
    if (ctm && typeof svg.createSVGPoint === 'function') {
      const pt = svg.createSVGPoint()
      pt.x = clientX
      pt.y = 0
      svgX = pt.matrixTransform(ctm.inverse()).x
    } else {
      const rect = svg.getBoundingClientRect()
      svgX = ((clientX - rect.left) / rect.width) * WIDTH
    }
    const raw = windowStart + ((svgX - PAD.left) / PLOT_W) * Math.max(0, windowCount - 1)
    return Math.min(windowEnd - 1, Math.max(windowStart, Math.round(raw)))
  }

  const datumAt = (index: number) => {
    const label = points[index]?.label ?? ''
    const d = demand[index]
    const s = supply[index]
    const b = branch ? branch[index] : null
    const df = diff ? diff[index] : null
    return {
      label,
      demand: d,
      supply: s,
      margin: s === null ? null : s - d,
      branch: b,
      diff: df,
    }
  }

  const hoverDatum = hoverIndex === null ? null : datumAt(hoverIndex)
  const obsDatum = datumAt(obsIndex)

  const tipLeft = useMemo(() => {
    if (hoverIndex === null) return null
    const svg = svgRef.current
    if (!svg) return null
    const x = chartX(hoverIndex)
    const ctm = svg.getScreenCTM?.()
    if (ctm && typeof svg.createSVGPoint === 'function') {
      const pt = svg.createSVGPoint()
      pt.x = x
      pt.y = 0
      const screen = pt.matrixTransform(ctm)
      return screen.x - svg.getBoundingClientRect().left
    }
    const rect = svg.getBoundingClientRect()
    return (x / WIDTH) * rect.width
  }, [hoverIndex, count, sizeNonce])

  const rangeRect =
    range && range[1] > range[0]
      ? {
          x: chartX(range[0]),
          width: Math.max(2, chartX(range[1]) - chartX(range[0])),
        }
      : null

  const brushStart = api.state.brushStart
  const liveRect =
    brushStart !== null &&
    hoverIndex !== null &&
    Math.abs(hoverIndex - brushStart) >= 1
      ? {
          x: xAt(Math.min(brushStart, hoverIndex), count),
          width: Math.max(
            2,
            xAt(Math.max(brushStart, hoverIndex), count) -
              xAt(Math.min(brushStart, hoverIndex), count),
          ),
        }
      : null

  const keyBase = hoverIndex ?? obsIndex
  const keyIndex = (delta: number) =>
    count === 0 ? 0 : Math.min(count - 1, Math.max(0, keyBase + delta))
  const selDatum = hoverIndex === null ? obsDatum : hoverDatum ?? obsDatum
  const empty = count === 0

  const ticks = tickIndices(windowCount).map(i => i + windowStart)
  const diffMode = showDiff && hasPlan && diff !== null

  return (
    <section className="panel trend-panel">
      <div className="panel-head trend-head">
        <h2>供需趋势</h2>
        <button type="button" className="btn ghost" aria-pressed={dynamic} onClick={() => setDynamic(v => !v)}>{dynamic ? "动态回放 · 16桶" : "全段静态比较"}</button>
        <div className="trend-legend" role="group" aria-label="曲线显示开关">
          <button
            type="button"
            className="legend-btn"
            aria-pressed={showDemand && !diffMode}
            aria-label={`需求（m³/min），当前${showDemand && !diffMode ? '显示' : '隐藏'}`}
            title="需求（m³/min）"
            onClick={() => {
              setShowDiff(false)
              setShowDemand((v) => !v)
            }}
          >
            <i className="legend-line demand" /> 需求
          </button>
          <button
            type="button"
            className="legend-btn"
            aria-pressed={showSupply && !diffMode}
            aria-label={`${planLabel}供气（虚线），当前${showSupply && !diffMode ? '显示' : '隐藏'}`}
            title={`${planLabel}供气（虚线）`}
            disabled={!hasPlan}
            onClick={() => {
              setShowDiff(false)
              setShowSupply((v) => !v)
            }}
          >
            <i className="legend-line supply" /> 供气
          </button>
          <button
            type="button"
            className="legend-btn"
            aria-pressed={showBranch && !diffMode}
            aria-label={`选中支路负载（点划），当前${showBranch && !diffMode ? '显示' : '隐藏'}`}
            title="选中支路负载（点划）"
            disabled={!hasBranch}
            onClick={() => {
              setShowDiff(false)
              setShowBranch((v) => !v)
            }}
          >
            <i className="legend-line branch" /> 支路
          </button>
          <button
            type="button"
            className="legend-btn"
            aria-pressed={diffMode}
            aria-label="看差额（供气−需求）"
            title="看差额（供气−需求）"
            disabled={!hasPlan}
            onClick={() => setShowDiff((v) => !v)}
          >
            <i className="legend-line diff" /> 差额
          </button>
        </div>
      </div>

      <div className="trend-plot">
        <svg
          ref={svgRef}
          className="trend-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="供需趋势与选中支路"
          tabIndex={0}
          onFocus={() => {
            if (api.hoverIndex === null) api.hover(obsIndex)
          }}
          onBlur={() => api.hover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              api.hover(keyIndex(-1))
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              api.hover(keyIndex(1))
            } else if (e.key === 'Enter' && api.hoverIndex !== null) {
              e.preventDefault()
              api.lockIndex(api.hoverIndex)
            } else if (e.key === 'Escape') {
              api.cancelBrush()
            }
          }}
        >
          <line
            className="axis"
            x1={PAD.left}
            y1={PAD.top + PLOT_H}
            x2={PAD.left + PLOT_W}
            y2={PAD.top + PLOT_H}
          />
          <line
            className="axis"
            x1={PAD.left}
            y1={PAD.top}
            x2={PAD.left}
            y2={PAD.top + PLOT_H}
          />

          {ticks.map((t) => (
            <g key={`tick-${t}`}>
              <line
                className="axis-tick"
                x1={chartX(t)}
                y1={PAD.top + PLOT_H}
                x2={chartX(t)}
                y2={PAD.top + PLOT_H + 3}
              />
              <text
                className="axis-text tick-text"
                x={chartX(t)}
                y={PAD.top + PLOT_H + 14}
                textAnchor="middle"
              >
                {points[t]?.label ?? ''}
              </text>
            </g>
          ))}

          {rangeRect ? (
            <rect
              className="range-shade"
              x={rangeRect.x}
              y={PAD.top}
              width={rangeRect.width}
              height={PLOT_H}
            />
          ) : null}
          {liveRect ? (
            <rect
              className="range-shade live"
              x={liveRect.x}
              y={PAD.top}
              width={liveRect.width}
              height={PLOT_H}
            />
          ) : null}

          <line
            className="obs-marker"
            x1={obsX}
            y1={PAD.top}
            x2={obsX}
            y2={PAD.top + PLOT_H}
          />
          <text className="axis-text" x={obsX + 3} y={PAD.top + 10}>
            观察 {points[obsIndex]?.label ?? ''}
          </text>

          {hoverIndex !== null && hoverIndex !== obsIndex ? (
            <>
              <line
                className="cursor-line"
                x1={chartX(hoverIndex)}
                y1={PAD.top}
                x2={chartX(hoverIndex)}
                y2={PAD.top + PLOT_H}
              />
              <text
                className="axis-text cursor-text"
                x={chartX(hoverIndex) + 3}
                y={PAD.top + PLOT_H + 14}
              >
                {points[hoverIndex]?.label ?? ''}
              </text>
            </>
          ) : null}

          {!diffMode ? (
            <>
              <text className="axis-text" x={4} y={PAD.top + 6}>
                {max.toFixed(0)}
              </text>
              <text className="axis-text" x={4} y={PAD.top + PLOT_H}>
                0
              </text>
            </>
          ) : (
            <>
              <text className="axis-text" x={4} y={PAD.top + 6}>
                {diffMax.toFixed(1)}
              </text>
              <text className="axis-text" x={4} y={PAD.top + PLOT_H}>
                {diffMin.toFixed(1)}
              </text>
              <line
                className="axis zero-line"
                x1={PAD.left}
                y1={zeroLineY}
                x2={PAD.left + PLOT_W}
                y2={zeroLineY}
              />
            </>
          )}

          {diffMode && diff ? (
            <path className="series diff" d={pathFor(diff.slice(windowStart, windowEnd), diffY)} fill="none" />
          ) : null}
          {!diffMode && showBranch && branch ? (
            <path className="series branch" d={pathFor(branch.slice(windowStart, windowEnd), seriesY)} fill="none" />
          ) : null}
          {!diffMode && hasPlan && showSupply ? (
            <path className="series supply" d={pathFor(supply.slice(windowStart, windowEnd), seriesY)} fill="none" />
          ) : null}
          {!diffMode && showDemand ? (
            <path className="series demand" d={pathFor(demand.slice(windowStart, windowEnd), seriesY)} fill="none" />
          ) : null}

          <rect
            className="trend-overlay"
            x={PAD.left}
            y={PAD.top}
            width={PLOT_W}
            height={PLOT_H}
            onPointerDown={(e) => {
              if (empty) return
              const touch = e.pointerType !== 'mouse'
              downRef.current = { x: e.clientX, y: e.clientY, touch }
              if (!touch) {
                e.currentTarget.setPointerCapture(e.pointerId)
                draggingRef.current = true
                api.beginBrush(indexFromClientX(e.clientX))
              }
            }}
            onPointerMove={(e) => {
              if (empty) return
              const i = indexFromClientX(e.clientX)
              if (draggingRef.current) { api.moveBrush(i); return }
              const d = downRef.current
              if (d?.touch) {
                const dx = e.clientX - d.x
                const dy = e.clientY - d.y
                if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { downRef.current = null; return }
                if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
                  draggingRef.current = true
                  try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
                  api.beginBrush(indexFromClientX(d.x)); api.moveBrush(i)
                }
                return
              }
              api.hover(i)
            }}
            onPointerUp={(e) => {
              const i = indexFromClientX(e.clientX)
              if (draggingRef.current) { api.endBrush(i); draggingRef.current = false }
              else if (downRef.current?.touch) api.hover(i)
              downRef.current = null
              try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
            }}
            onPointerCancel={() => {
              draggingRef.current = false
              downRef.current = null
              api.cancelBrush()
            }}
            onPointerLeave={() => {
              if (!draggingRef.current && !downRef.current?.touch) api.hover(null)
            }}
          />
        </svg>

        {hoverDatum && tipLeft !== null ? (
          <div className="trend-tip" style={{ left: `${tipLeft}px` }}>
            <strong>{hoverDatum.label}</strong>
            <span>需求 {hoverDatum.demand.toFixed(1)} m³/min</span>
            <span>
              方案供气{' '}
              {hoverDatum.supply === null
                ? '未观测'
                : `${hoverDatum.supply.toFixed(1)} m³/min`}
            </span>
            <span>
              余量{' '}
              {hoverDatum.margin === null
                ? '未观测'
                : `${hoverDatum.margin >= 0 ? '+' : ''}${hoverDatum.margin.toFixed(1)} m³/min`}
            </span>
            {branch ? (
              <span>
                支路 {activeUnitId}{' '}
                {hoverDatum.branch === null
                  ? '未观测'
                  : `${hoverDatum.branch.toFixed(1)} m³/min`}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="trend-obsbar" role="group" aria-label="当前选择观察">
        <button type="button" className="trend-step" aria-label="前一桶" disabled={empty} onClick={() => api.hover(keyIndex(-1))}>‹</button>
        <span className="trend-obsbar-body" data-testid="sd-obsbar">
          <strong>{empty ? '暂无数据' : selDatum.label}</strong>
          <span>需求 {selDatum.demand.toFixed(1)} m³/min</span>
          <span>供气 {selDatum.supply === null ? '未观测' : `${selDatum.supply.toFixed(1)} m³/min`}</span>
          <span>余量 {selDatum.margin === null ? '未观测' : `${selDatum.margin >= 0 ? '+' : ''}${selDatum.margin.toFixed(1)} m³/min`}</span>
        </span>
        <button type="button" className="trend-step" aria-label="后一桶" disabled={empty} onClick={() => api.hover(keyIndex(1))}>›</button>
        <button type="button" className="trend-step" aria-label="取消探查" onClick={() => { api.cancelBrush(); api.hover(null) }}>✕</button>
      </div>

      <div className="trend-foot">
        <p className="hint trend-status">
          观察 {obsDatum.label}：需求 {obsDatum.demand.toFixed(1)} · 供气{' '}
          {obsDatum.supply === null ? '未观测' : obsDatum.supply.toFixed(1)} · 余量{' '}
          {obsDatum.margin === null
            ? '未观测'
            : `${obsDatum.margin >= 0 ? '+' : ''}${obsDatum.margin.toFixed(1)}`}{' '}
          m³/min。{!hasPlan
            ? '建议不可行，仅需求曲线；不绘制零供气线。'
            : demandSupplyCoincide
              ? '供气与需求在本方案逐桶重合（差额≈0），曲线重叠，可切到“看差额”。'
              : activeUnitId && !activeHasBranch
                ? '选中对象仅监测。'
                : activeUnitId
                  ? `已高亮 ${activeUnitId} 支路。`
                  : `${planLabel}，非现场实测。`}
        </p>
        <details className="trend-help">
          <summary>交互说明</summary>
          <p className="hint">
            悬停只显示 tooltip 与十字线，不改主读数；←/→ 探查，Enter 锁定，水平拖动跨至少一桶刷选观察区间；
            也可用上方起止时刻应用同一区间。图例按钮可分别开关需求 / 供气 / 支路，或切到“看差额”。
            {plan.planType === 'baseline'
              ? '基线仅作对照，已标注硬约束违规。'
              : '建议已通过独立硬约束复验。'}
          </p>
        </details>
      </div>
    </section>
  )
}
