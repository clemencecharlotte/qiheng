import type { DeviceState, OverviewSnapshot } from '../domain/overview'
import './ContextRail.css'

const STATE_LABEL: Record<DeviceState, string> = {
  running: '在役',
  idle: '待机',
  fault: '单机故障',
  unknown: '边界未知 · 仅监测',
}

const KIND_LABEL: Record<'screw' | 'centrifugal', string> = {
  screw: '螺杆机',
  centrifugal: '离心机',
}

interface Props {
  snapshot: OverviewSnapshot
  scenarioLabel: string
  linkedUnitId: string | null
  hoverUnitId: string | null
  onToggleLock: (id: string) => void
  onClearLock: () => void
}

export default function ContextRail({
  snapshot,
  scenarioLabel,
  linkedUnitId,
  hoverUnitId,
  onToggleLock,
  onClearLock,
}: Props) {
  // 固定详情优先锁定对象；hover 只在不存在锁定时提供临时预览。
  const effectiveId = linkedUnitId ?? hoverUnitId
  const view = effectiveId
    ? snapshot.units.find((u) => u.unit.id === effectiveId) ?? null
    : null
  const isLocked = Boolean(view && linkedUnitId === view.unit.id)
  const isPreview = Boolean(view && !isLocked)

  return (
    <aside
      className="context-rail context-evidence-rail"
      aria-label="对象上下文"
      data-context-mode={isLocked ? 'locked' : isPreview ? 'preview' : 'overview'}
    >
      <div className="context-head">
        {view ? (
          <span className={`tag ${isPreview ? 'warn' : 'ok'}`}>
            {isPreview ? '临时预览（未锁定）' : '已锁定'}
          </span>
        ) : null}
      </div>

      <div className="context-source">
        <span className="context-source-label">同源快照</span>
        <dl>
          <div>
            <dt>观察时刻</dt>
            <dd>{snapshot.label}</dd>
          </div>
          <div>
            <dt>场景</dt>
            <dd>{scenarioLabel}</dd>
          </div>
        </dl>
      </div>

      {!view ? (
        <div className="context-body">
          <h3>站点证据总览</h3>
          <details className="context-section">
            <summary>站快照数值（与舞台同源）</summary>
            <section className="context-section" aria-label="观察快照">
            <h4><span aria-hidden="true">01</span> 观察快照</h4>
            <div className="context-tags">
              <span className={`tag ${snapshot.planFeasible ? 'ok' : 'warn'}`}>
                {snapshot.planLabel}
              </span>
            </div>
            <dl className="context-facts">
              <div>
                <dt>需求</dt>
                <dd>{snapshot.demand.toFixed(1)} m³/min</dd>
              </div>
              <div>
                <dt>方案供气</dt>
                <dd>
                  {snapshot.supply === null
                    ? '未知'
                    : `${snapshot.supply.toFixed(1)} m³/min`}
                </dd>
              </div>
              <div>
                <dt>余量</dt>
                <dd className={snapshot.margin !== null && snapshot.margin < 0 ? 'neg mono' : 'mono'}>
                  {snapshot.margin === null
                    ? '未知'
                    : `${snapshot.margin >= 0 ? '+' : ''}${snapshot.margin.toFixed(1)} m³/min`}
                </dd>
              </div>
              <div>
                <dt>方案投运</dt>
                <dd>
                  {snapshot.plannedRunningUnitIds.length === 0
                    ? '全停'
                    : snapshot.plannedRunningUnitIds.join(' / ')}
                </dd>
              </div>
            </dl>
            {snapshot.planFeasible ? <details><summary>方案口径</summary><p className="context-note">{snapshot.planNote}</p></details> : <p className="context-note">{snapshot.planNote}</p>}
          </section>
          </details>

          <div className="context-empty">
            <p>尚未选定对象：点击设备卡锁定后，本栏显示同一观察时刻的机组证据。</p>
          </div>
        </div>
      ) : (
        <div className="context-body">
          <h3>
            {view.unit.name}
            <span className="unit-id">{view.unit.id}</span>
          </h3>
          <div className="context-tags">
            <span className="tag">{KIND_LABEL[view.unit.kind]}</span>
            <span className="tag muted">{STATE_LABEL[view.state]}</span>
            {isPreview ? <span className="tag warn">临时预览</span> : null}
          </div>

          <section className="context-section" aria-label="观察快照">
            <h4><span aria-hidden="true">01</span> 观察快照</h4>
            <div className="context-tags">
              <span className={`tag ${snapshot.planFeasible ? 'ok' : 'warn'}`}>
                {snapshot.planLabel}
              </span>
            </div>
            <dl className="context-facts">
              <div>
                <dt>供气</dt>
                <dd>{view.load === null ? '未知' : `${view.load.toFixed(1)} m³/min`}</dd>
              </div>
              <div>
                <dt>负载率</dt>
                <dd>
                  {view.loadRatio === null
                    ? '未知'
                    : `${(view.loadRatio * 100).toFixed(0)}%`}
                </dd>
              </div>
              <div>
                <dt>功率（估算）</dt>
                <dd>{view.powerKw === null ? '未监测' : `${view.powerKw.toFixed(0)} kW`}</dd>
              </div>
            </dl>
            <p className="context-note">{snapshot.planNote}</p>
          </section>

          <section className="context-section" aria-label="机组参数">
            <h4><span aria-hidden="true">02</span> 机组参数</h4>
            <dl className="context-facts">
              <div>
                <dt>额定供气</dt>
                <dd>{view.unit.ratedCapacity} m³/min</dd>
              </div>
              <div>
                <dt>最小稳定负载</dt>
                <dd>{(view.unit.minLoadRatio * 100).toFixed(0)}%</dd>
              </div>
              <div>
                <dt>额定功率</dt>
                <dd>{view.unit.ratedPower} kW</dd>
              </div>
              <div>
                <dt>最小启停间隔</dt>
                <dd>{view.unit.minStartStopInterval} min</dd>
              </div>
            </dl>
          </section>

          <section className="context-section" aria-label="资格边界">
            <h4><span aria-hidden="true">03</span> 资格边界</h4>
            <dl className="context-facts context-boundary-facts">
              <div>
                <dt>自动调度资格</dt>
                <dd>{view.eligible ? '已纳入候选' : '未纳入候选'}</dd>
              </div>
              <div>
                <dt>支路映射</dt>
                <dd>{view.hasBranch ? '有对应支路' : '无对应支路 · 仅监测'}</dd>
              </div>
              <div>
                <dt>喘振边界</dt>
                <dd className={view.unit.surgeBoundaryVerified ? undefined : 'context-boundary-unverified'}>
                  {view.unit.surgeBoundaryVerified ? '已核实' : '未核实'}
                </dd>
              </div>
            </dl>
            <p className="context-note context-boundary-note">
              {view.hasBranch
                ? '该对象已纳入自动调度候选，支路曲线来自同一方案快照。'
                : '该对象无对应支路映射，仅监测；不生成支路数据或启停建议。'}
            </p>
            {view.note ? <p className="context-help">{view.note}</p> : null}
          </section>

          <div className="context-actions">
            {isLocked ? (
              <button type="button" className="btn" onClick={onClearLock}>
                取消锁定（Esc）
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={() => onToggleLock(view.unit.id)}
              >
                锁定该对象
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
