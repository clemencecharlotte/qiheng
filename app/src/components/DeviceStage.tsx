import { useEffect, useId, useRef, useState } from 'react'
import DeviceDetailsDrawer from './DeviceDetailsDrawer'
import DeviceArtwork from './welcome/DeviceArtwork'
import { bindMechSource, useMechPhase } from './welcome/mechClock'
import { INFORMATIVE_PHASE, SECONDS_PER_HOST_INDEX } from './welcome/deviceKinematics'
import type { ObservationClockApi } from './useObservationClock'
import { usePointerGlow } from './usePointerGlow'
import type { DeviceState, OverviewSnapshot } from '../domain/overview'
import StatusBadge, { type StatusTone } from './console/StatusBadge'

const STATE_LABEL: Record<DeviceState, string> = {
  running: '在役',
  idle: '待机',
  fault: '单机故障',
  unknown: '边界未知 · 仅监测',
}

const STATE_TONE: Record<DeviceState, StatusTone> = {
  running: 'running',
  idle: 'idle',
  fault: 'severe',
  unknown: 'unknown',
}

interface Props {
  snapshot: OverviewSnapshot
  clock?: ObservationClockApi
  runIdentity?: string
  linkedUnitId: string | null
  hoverUnitId: string | null
  onHover: (id: string | null) => void
  onToggleLock: (id: string) => void
  onClearLock: () => void
}

/** Same artwork as the prologue, driven only by the current plan/replay state. */
function StageMachine({ view, clock }: { view: OverviewSnapshot['units'][number]; clock?: ObservationClockApi }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(true)
  const [foreground, setForeground] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const update = () => setForeground(!document.hidden)
    document.addEventListener('visibilitychange', update)
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    if (ref.current) observer?.observe(ref.current)
    return () => { document.removeEventListener('visibilitychange', update); observer?.disconnect() }
  }, [])
  const typeId = view.unit.kind === 'centrifugal' ? 'centrifugal' : 'screw'
  const phase = useMechPhase(Boolean(clock?.state.playing && view.state === 'running' && visible && foreground),
    view.state === 'running' ? (clock?.effectiveIndex ?? 0) * SECONDS_PER_HOST_INDEX : INFORMATIVE_PHASE[typeId])
  return <span ref={ref} className="stage-machine-art" data-state={view.state} aria-hidden="true">
    <DeviceArtwork typeId={typeId} phase={phase} />
  </span>
}

export default function DeviceStage({
  snapshot,
  clock,
  runIdentity = '',
  linkedUnitId,
  hoverUnitId,
  onHover,
  onToggleLock,
  onClearLock,
}: Props) {
  const glow = usePointerGlow<HTMLDivElement>()
  const activeId = hoverUnitId ?? linkedUnitId
  // 只存对象选择，不保存旧快照，不接线任何业务锁定或方案操作。
  const [details, setDetails] = useState<{ unitId: string; runIdentity: string } | null>(null)
  const detailsTrigger = useRef<HTMLButtonElement | null>(null)
  const drawerId = useId()
  const detailView = details?.runIdentity === runIdentity
    ? snapshot.units.find((view) => view.unit.id === details.unitId) ?? null
    : null

  useEffect(() => {
    if (details && !detailView) setDetails(null)
  }, [details, detailView])
  useEffect(() => {
    if (!clock) return
    bindMechSource({ playing: clock.state.playing, speed: clock.state.speed, index: clock.effectiveIndex })
    return () => bindMechSource(null)
  }, [clock?.state.playing, clock?.state.speed, clock?.effectiveIndex])

  return (
    <section className="panel stage-panel" aria-label="设备与供需舞台">
      <h2 className="sr-only">设备与供需舞台</h2>

      <div className="stage-anchors">
        <span className="stage-anchor-time mono">{snapshot.label}</span>
        <div className="stage-anchor">
          <span>需求</span>
          <strong>{snapshot.demand.toFixed(1)}</strong>
          <em>m³/min</em>
        </div>
        <div className="stage-anchor">
          <span>方案供气</span>
          <strong>
            {snapshot.supply === null ? '未知' : snapshot.supply.toFixed(1)}
          </strong>
          <em>{snapshot.supply === null ? '未监测' : 'm³/min'}</em>
        </div>
        <div
          className={`stage-anchor${
            snapshot.margin !== null && snapshot.margin < 0 ? ' neg' : ''
          }`}
        >
          <span>余量</span>
          <strong>
            {snapshot.margin === null
              ? '未知'
              : `${snapshot.margin >= 0 ? '+' : ''}${snapshot.margin.toFixed(1)}`}
          </strong>
          <em>{snapshot.margin === null ? '未监测' : 'm³/min'}</em>
        </div>
        <span className={`tag ${snapshot.planFeasible ? 'ok' : 'warn'}`}>
          {snapshot.planLabel}
        </span>
      </div>

      <div
        className="stage-canvas"
        ref={glow.ref}
        data-active={activeId ?? ''}
        onPointerMove={glow.onPointerMove}
        onPointerLeave={() => {
          glow.onPointerLeave()
          onHover(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && linkedUnitId) {
            onClearLock()
          }
        }}
      >
        <div className="stage-gas">
          <span className="stage-gas-label">供气母管</span>
          <span className="stage-gas-line" />
        </div>

        <div className="stage-units">
          {snapshot.units.map((view) => {
            const id = view.unit.id
            const isLinked = linkedUnitId === id
            const isHover = hoverUnitId === id && !isLinked
            const isActive = activeId === id
            return (
              <div
                className="stage-slot"
                key={id}
                data-active={isActive ? 'on' : undefined}
              >
                <span className="stage-tap" aria-hidden="true" />
                <article
                  className={`stage-card${isLinked ? ' is-linked' : ''}${
                    isHover ? ' is-hover' : ''
                  }`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isLinked}
                  aria-label={`${view.unit.name}（${id}），${STATE_LABEL[view.state]}`}
                  data-evidence={`unit:${id}`}
                  onMouseEnter={() => onHover(id)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(id)}
                  onBlur={() => onHover(null)}
                  onClick={() => onToggleLock(id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onToggleLock(id)
                    }
                  }}
                >
                  <StageMachine view={view} clock={clock} />
                  <div className="stage-card-head">
                    <strong>{view.unit.name}</strong>
                    <span className="unit-id">{id}</span>
                  </div>
                  <div className="stage-card-tags">
                    <StatusBadge tone={STATE_TONE[view.state]} label={STATE_LABEL[view.state]} />
                    {isLinked ? <span className="tag ok">已锁定</span> : null}
                  </div>
                  <dl className="stage-facts">
                    <div>
                      <dt>供气</dt>
                      <dd>
                        {view.load === null
                          ? view.state === 'idle'
                            ? '未参与'
                            : '未知'
                          : `${view.load.toFixed(1)} m³/min`}
                      </dd>
                    </div>
                    <div>
                      <dt>负载率</dt>
                      <dd>
                        {view.loadRatio === null
                          ? view.state === 'idle'
                            ? '未参与'
                            : '未知'
                          : `${(view.loadRatio * 100).toFixed(0)}%`}
                      </dd>
                    </div>
                    <div>
                      <dt>功率</dt>
                      <dd>
                        {view.powerKw === null
                          ? '未监测'
                          : `${view.powerKw.toFixed(0)} kW（估算）`}
                      </dd>
                    </div>
                  </dl>
                </article>
                <button
                  type="button"
                  className="device-details-trigger"
                  aria-label={`查看 ${view.unit.name}（${id}）详情`}
                  aria-haspopup="dialog"
                  aria-controls={detailView?.unit.id === id ? drawerId : undefined}
                  aria-expanded={detailView?.unit.id === id}
                  onClick={(event) => {
                    detailsTrigger.current = event.currentTarget
                    setDetails({ unitId: id, runIdentity })
                  }}
                >
                  查看详情
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
      {detailView ? (
        <DeviceDetailsDrawer
          key={`${runIdentity}:${detailView.unit.id}`}
          id={drawerId}
          snapshot={snapshot}
          view={detailView}
          returnFocus={detailsTrigger.current}
          onClose={() => setDetails(null)}
        />
      ) : null}
    </section>
  )
}
