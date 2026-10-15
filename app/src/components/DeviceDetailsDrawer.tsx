import { useEffect, useRef } from 'react'
import type { DeviceState, OverviewSnapshot, SnapshotUnitView } from '../domain/overview'
import './DeviceDetailsDrawer.css'

const STATE_LABEL: Record<DeviceState, string> = {
  running: '在役',
  idle: '待机',
  fault: '单机故障',
  unknown: '边界未知 · 仅监测',
}

interface Props {
  id: string
  snapshot: OverviewSnapshot
  view: SnapshotUnitView
  returnFocus: HTMLButtonElement | null
  onClose: () => void
}

/** 当前观察时刻的只读详情；原生 modal dialog 提供焦点陷阱和背景 inert。 */
export default function DeviceDetailsDrawer({ id, snapshot, view, returnFocus, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.showModal()
    titleRef.current?.focus({ preventScroll: true })
    return () => {
      if (dialog.open) dialog.close()
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
    }
  }, [returnFocus])

  const participationValue = view.state === 'idle' ? '未参与此时刻方案' : '未知'

  return (
    <dialog
      id={id}
      ref={dialogRef}
      className="device-details-drawer"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-boundary`}
      onKeyDownCapture={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onCancel={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      onClose={(event) => {
        // StrictMode 的 cleanup 会排入 close 事件；重开后晚到的旧事件不能关闭新 modal。
        if (!event.currentTarget.open) onClose()
      }}
    >
      <header className="device-details-drawer__header">
        <div>
          <p className="device-details-drawer__eyebrow">设备详情 · 只读</p>
          <h2 id={`${id}-title`} ref={titleRef} tabIndex={-1}>{view.unit.name}</h2>
          <p className="device-details-drawer__identity">
            <span>{view.unit.id}</span>
            <span>{view.unit.kind === 'screw' ? '螺杆机' : '离心机'}</span>
          </p>
        </div>
        <button type="button" className="device-details-drawer__close" onClick={onClose}>
          关闭<span aria-hidden="true"> ×</span>
        </button>
      </header>

      <div className="device-details-drawer__body">
        <p id={`${id}-boundary`} className="device-details-drawer__notice">
          此处仅展示方案快照，不代表实时设备状态；
          查看或关闭详情不会改变对象锁定、方案或执行状态。
        </p>

        <section className="device-details-drawer__section" aria-labelledby={`${id}-observation`}>
          <h3 id={`${id}-observation`}>当前观察快照</h3>
          <p className="device-details-drawer__source">{snapshot.label} · {snapshot.planLabel}</p>
          <dl className="device-details-drawer__facts">
            <div><dt>方案状态</dt><dd>{STATE_LABEL[view.state]}</dd></div>
            <div><dt>供气</dt><dd>{view.load === null ? participationValue : `${view.load.toFixed(1)} m³/min`}</dd></div>
            <div><dt>负载率</dt><dd>{view.loadRatio === null ? participationValue : `${(view.loadRatio * 100).toFixed(0)}%`}</dd></div>
            <div><dt>功率（估算）</dt><dd>{view.powerKw === null ? '未监测' : `${view.powerKw.toFixed(0)} kW`}</dd></div>
          </dl>
          {view.note ? <p className="device-details-drawer__note">{view.note}</p> : null}
        </section>

        <details className="device-details-drawer__section">
          <summary id={`${id}-parameters`}>当前合成机组参数</summary>
          <dl className="device-details-drawer__facts">
            <div><dt>额定供气</dt><dd>{view.unit.ratedCapacity} m³/min</dd></div>
            <div><dt>额定功率</dt><dd>{view.unit.ratedPower} kW</dd></div>
            <div><dt>最小稳定负载</dt><dd>{(view.unit.minLoadRatio * 100).toFixed(0)}%</dd></div>
            <div><dt>最小启停间隔</dt><dd>{view.unit.minStartStopInterval} min</dd></div>
            <div><dt>喘振边界</dt><dd>{view.unit.surgeBoundaryVerified ? '已核实（合成参数）' : '未核实'}</dd></div>
            <div><dt>自动调度候选</dt><dd>{view.eligible ? '已纳入当前候选' : '未纳入当前候选'}</dd></div>
          </dl>
        </details>

        <section className="device-details-drawer__section" aria-labelledby={`${id}-provenance`}>
          <h3 id={`${id}-provenance`}>来源与边界</h3>
          <p className="device-details-drawer__note">{snapshot.planNote}</p>
          <p className="device-details-drawer__note">
            {view.hasBranch
              ? '该对象已纳入自动调度候选，支路曲线来自同一方案快照。'
              : '该对象无对应支路映射，仅监测；不生成支路数据或启停建议。'}
          </p>
          <details>
            <summary className="device-details-drawer__note">遥测与健康评分口径</summary>
            <p className="device-details-drawer__note">没有生产遥测或经核实的健康评分；缺值保留未知，不补零。</p>
          </details>
        </section>
      </div>
    </dialog>
  )
}
