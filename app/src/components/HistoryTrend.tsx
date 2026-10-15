import { replayWindow } from './replayWindow'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { QualityGrade } from '../domain/quality'
import type { ObservationClockApi } from './useObservationClock'

export interface TrendPoint {
  label: string
  value: number | null
  grade: QualityGrade
  /** 功率覆盖说明（实际字段）。 */
  coverage?: string
}

const GRADE_COLOR: Record<QualityGrade, string> = {
  pass: 'var(--success)',
  review: 'var(--warning)',
  invalid: 'var(--danger)',
}

const GRADE_LABEL: Record<QualityGrade, string> = {
  pass: '通过',
  review: '待复核',
  invalid: '无效',
}

interface Props {
  points: TrendPoint[]
  /** 数值物理单位（如 kWh）——不是对象名。 */
  unit: string
  /** 对象/来源标签（如 STATION / 机组 ID）——与数值单位分离旁置。 */
  objectLabel?: string
  metricLabel: string
  api: ObservationClockApi
}

export default function HistoryTrend({ points, unit, objectLabel, metricLabel, api }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const draggingRef = useRef(false)
  const downRef = useRef<{ x: number; y: number; touch: boolean } | null>(null)
  const plotRef = useRef<HTMLDivElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const [boxW, setBoxW] = useState(0)
  const [tipBoxW, setTipBoxW] = useState(0)
  const empty = points.length === 0
  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    if (typeof ResizeObserver === 'undefined') { setBoxW(el.clientWidth); return }
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth))
    ro.observe(el); setBoxW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const width = 680
  const height = 200
  const padding = { top: 16, right: 12, bottom: 34, left: 44 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom
  const count = points.length
  const [dynamic, setDynamic] = useState(true)
  const projection = useRef(replayWindow(count, api.effectiveIndex, dynamic))
  // Preserve the exact screen-to-index mapping throughout a drag; a saved range does not disable replay.
  if (api.state.brushStart === null) projection.current = replayWindow(count, api.effectiveIndex, dynamic)
  const [windowStart, windowEnd] = projection.current
  const visibleCount = windowEnd - windowStart
  const max = Math.max(1, ...points.map((p) => p.value ?? 0))
  const barGap = 4
  const barW = count ? Math.max(2, plotW / Math.max(1, visibleCount) - barGap) : 2
  const slot = count ? plotW / Math.max(1, visibleCount) : plotW
  const centerX = (i: number) => padding.left + (i - windowStart) * slot + slot / 2
  // r40 ④·3：轴标签按槽宽自适应抽稀（按桌面 9px/窄屏强制 16px 的较大者估算 ~48px/签），
  // 首末刻度必显并以 start/end 端点锚定；全段 96 桶（slot≈6.5px）不再互相重叠。
  const labelEvery = Math.max(1, Math.ceil(48 / Math.max(1, slot)))
  const showTickLabel = (li: number) =>
    visibleCount <= 2 || li === 0 || li === visibleCount - 1 ||
    (li % labelEvery === 0 && li <= visibleCount - 1 - labelEvery)

  const indexFromClientX = (clientX: number): number => {
    const svg = svgRef.current
    if (!svg || count === 0) return api.effectiveIndex
    const rect = svg.getBoundingClientRect()
    const svgX = ((clientX - rect.left) / rect.width) * width
    const raw = windowStart + Math.floor((svgX - padding.left) / slot)
    return Math.min(windowEnd - 1, Math.max(windowStart, raw))
  }

  const obsIndex = Math.min(Math.max(0, api.effectiveIndex), Math.max(0, count - 1))
  const hoverIndex = api.hoverIndex
  useLayoutEffect(() => { setTipBoxW(tipRef.current?.offsetWidth ?? 0) }, [hoverIndex, points.length])
  const range = api.range
  const obsX = centerX(obsIndex)
  const hoverDatum = hoverIndex === null ? null : points[hoverIndex]
  const keyBase = hoverIndex ?? obsIndex
  const keyIndex = (delta: number) =>
    count === 0 ? 0 : Math.min(count - 1, Math.max(0, keyBase + delta))

  const rangeRect =
    range && range[1] > range[0]
      ? {
          x: centerX(range[0]) - slot / 2,
          width: Math.max(2, centerX(range[1]) - centerX(range[0]) + slot),
        }
      : null

  const brushStart = api.state.brushStart
  const liveRect =
    brushStart !== null &&
    hoverIndex !== null &&
    Math.abs(hoverIndex - brushStart) >= 1
      ? {
          x: centerX(Math.min(brushStart, hoverIndex)) - slot / 2,
          width: Math.max(
            2,
            centerX(Math.max(brushStart, hoverIndex)) -
              centerX(Math.min(brushStart, hoverIndex)) +
              slot,
          ),
        }
      : null

  return (
    <div className="trend qh-history-trend">
      <div className="trend-head">
        <button type="button" className="btn ghost" aria-pressed={dynamic} onClick={() => setDynamic(v => !v)}>{dynamic ? "动态回放 · 16桶" : "全段静态比较"}</button>
        <span>
          {unit} · {metricLabel}
        </span>
        <span className="trend-legend">
          <i className="dot pass" /> 通过
          <i className="dot review" /> 待复核
          <i className="dot invalid" /> 无效
          <i className="dot missing" /> 未观测
        </span>
      </div>
      <div className="trend-plot" ref={plotRef}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="历史桶趋势与探查游标"
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
            } else if (e.key === 'Enter' && !empty && api.hoverIndex !== null) {
              e.preventDefault()
              api.lockIndex(api.hoverIndex)
            } else if (e.key === 'Escape') {
              api.cancelBrush()
            }
          }}
        >
          <line
            x1={padding.left}
            y1={padding.top + plotH}
            x2={padding.left + plotW}
            y2={padding.top + plotH}
            stroke="var(--border)"
          />

          {rangeRect ? (
            <rect
              className="range-shade"
              x={rangeRect.x}
              y={padding.top}
              width={rangeRect.width}
              height={plotH}
            />
          ) : null}
          {liveRect ? (
            <rect
              className="range-shade live"
              x={liveRect.x}
              y={padding.top}
              width={liveRect.width}
              height={plotH}
            />
          ) : null}

          {points.slice(windowStart, windowEnd).map((p, localIndex) => {
            const i = localIndex + windowStart
            const h = ((p.value ?? 0) / max) * plotH
            const x = padding.left + localIndex * slot + barGap / 2
            const y = padding.top + plotH - h
            return (
              <g key={p.label}>
                {p.value === null ? (
                  <rect
                    className="missing-tick"
                    x={padding.left + localIndex * slot + barGap / 2}
                    y={padding.top + plotH - 3}
                    width={barW}
                    height={3}
                  >
                    <title>
                      {p.label}：未观测（不可完整积分；{p.coverage ?? '功率/时间不齐'}）
                    </title>
                  </rect>
                ) : (
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(h, 0)}
                    style={{ x, y, width:barW, height:Math.max(h,0) } as CSSProperties}
                    fill={GRADE_COLOR[p.grade]}
                    opacity={0.85}
                  >
                    <title>
                      {p.label}：{objectLabel ? `${objectLabel} · ` : ''}{p.value.toFixed(2)} {unit}（{GRADE_LABEL[p.grade]}）
                      {p.coverage ? `；功率覆盖 ${p.coverage}` : ''}
                    </title>
                  </rect>
                )}
                {showTickLabel(localIndex) ? (
                  <text
                    x={centerX(i)}
                    y={height - 12}
                    fontSize="9"
                    fill="var(--muted)"
                    textAnchor={localIndex === 0 ? 'start' : localIndex === visibleCount - 1 ? 'end' : 'middle'}
                  >
                    {p.label.slice(0, 5)}
                  </text>
                ) : null}
              </g>
            )
          })}

          <line
            className="obs-marker"
            x1={obsX}
            y1={padding.top}
            x2={obsX}
            y2={padding.top + plotH}
          />
          {hoverIndex !== null && hoverIndex !== obsIndex ? (
            <line
              className="cursor-line"
              x1={centerX(hoverIndex)}
              y1={padding.top}
              x2={centerX(hoverIndex)}
              y2={padding.top + plotH}
            />
          ) : null}

          <text x={4} y={padding.top + 8} fontSize="10" fill="var(--muted)">
            {max.toFixed(1)}
          </text>
          <text x={4} y={padding.top + plotH} fontSize="10" fill="var(--muted)">
            0
          </text>

          <rect
            className="trend-overlay"
            x={padding.left}
            y={padding.top}
            width={plotW}
            height={plotH}
            onPointerDown={(e) => {
              if (empty) return
              // 鼠标：立即进入刷选（保持既有行为）；触屏：仅记录起点，待横向阈值判定，
              // 纵向手势放行页面滚动（touch-action: pan-y），不劫持所有 touch。
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
                if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { downRef.current = null; return } // 纵向滚动
                if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
                  draggingRef.current = true
                  try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
                  api.beginBrush(indexFromClientX(d.x))
                  api.moveBrush(i)
                }
                return
              }
              api.hover(i)
            }}
            onPointerUp={(e) => {
              const i = indexFromClientX(e.clientX)
              if (draggingRef.current) {
                api.endBrush(i)
                draggingRef.current = false
              } else if (downRef.current?.touch) {
                api.hover(i) // 触屏点选：持续可读（内联观察条）
              }
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

        {hoverDatum ? (
          <div
            ref={tipRef}
            className="trend-tip"
            style={boxW > 0 && tipBoxW > 0
              ? { left: Math.min(Math.max((centerX(hoverIndex as number) / width) * boxW - tipBoxW / 2, 8), Math.max(8, boxW - tipBoxW - 8)) }
              : { left: `${(centerX(hoverIndex as number) / width) * 100}%` }}
          >
            <strong>{hoverDatum.label}{objectLabel ? ` · ${objectLabel}` : ''}</strong>
            <span>
              当前值{' '}
              {hoverDatum.value === null ? '未观测（不补 0）' : `${hoverDatum.value.toFixed(3)} ${unit}`}
            </span>
            <span>质量 {GRADE_LABEL[hoverDatum.grade]}</span>
            {hoverDatum.coverage ? <span>功率覆盖 {hoverDatum.coverage}</span> : null}
          </div>
        ) : null}
      </div>
      <div className="trend-obsbar" role="group" aria-label="当前选择观察">
        <button type="button" className="trend-step" aria-label="前一桶" disabled={empty} onClick={() => api.hover(keyIndex(-1))}>‹</button>
        <span className="trend-obsbar-body" data-testid="trend-obsbar">
          <strong>{empty ? '暂无数据' : `${points[keyBase]?.label ?? ''}${objectLabel ? ` · ${objectLabel}` : ''}`}</strong>
          <span>{points[keyBase]?.value === null || points[keyBase] === undefined ? `未观测（不补 0）` : `${(points[keyBase]!.value as number).toFixed(2)} ${unit}`}</span>
          {points[keyBase] ? <span>质量 {GRADE_LABEL[points[keyBase]!.grade]}</span> : null}
          {points[keyBase]?.coverage ? <span>覆盖 {points[keyBase]!.coverage}</span> : null}
        </span>
        <button type="button" className="trend-step" aria-label="后一桶" disabled={empty} onClick={() => api.hover(keyIndex(1))}>›</button>
        <button type="button" className="trend-step" aria-label="取消探查" onClick={() => { api.cancelBrush(); api.hover(null) }}>✕</button>
      </div>
      <p className="hint">
        缺值显示为“未观测”且不补零 / 不插值；观察 {points[obsIndex]?.label ?? ''}。
      </p>
    </div>
  )
}