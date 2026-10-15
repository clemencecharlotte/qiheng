import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import './demo-fleet.css'
import { useMechPhase } from './mechClock'
import { INFORMATIVE_PHASE } from './deviceKinematics'

export type FleetState = 'standby' | 'running' | 'fault' | 'loading'
export interface FleetType { id: string; name: string; tag: string }
const names: Record<FleetState, string> = { standby: '待机', running: '模拟运行', fault: '模拟故障', loading: '模拟加载' }
const order: FleetState[] = ['standby', 'running', 'fault', 'loading']
interface Setting { state: FleetState; model: 'standard' | 'compact' }

/** r41 · 单卡消费共享机构相位：moving 才订阅（离屏/后台/待机/故障不推进）；
 *  loading=2.6× 示意倍率；reduce 由 useMechPhase 落静态关键相位。纯展示，不触设备/审批。 */
function MachineCard({ item, value, moving, onUpdate, onInspect, renderGlyph }: {
  item: { id: string; n: number; type: FleetType }
  value: Setting
  moving: boolean
  onUpdate: (delta: Partial<Setting>) => void
  onInspect?: (typeId: string, state: FleetState) => void
  renderGlyph: (typeId: string, phase: number) => ReactNode
}) {
  const rate = value.state === 'loading' ? 2.6 : 1
  const phase = useMechPhase(moving, INFORMATIVE_PHASE[item.type.id] ?? 0) * rate
  const style = { '--mech-rate': rate } as CSSProperties
  return <article className={`qh-demo-machine${value.model === 'compact' ? ' is-compact' : ''}`}
    data-instance={item.id} data-device={item.type.id} data-state={value.state} data-motion={moving ? 'active' : 'paused'} style={style}>
    <div className="qh-machine-top"><h4>{item.type.name} <small>{item.n === 1 ? 'A' : 'B'}</small></h4><span>{item.type.tag}</span></div>
    <div className="qh-fleet-glyph" role="img" aria-label={`${item.type.name}演示实例${item.n}：${names[value.state]}`}>{renderGlyph(item.type.id, phase)}</div>
    <div className="qh-machine-state"><span className="qh-state-dot" aria-hidden="true" />{names[value.state]} · 演示
      {value.state === 'fault' ? <span className="qh-fault-hint" role="note">故障停机构</span> : null}
      {value.state === 'loading' ? <span className="qh-pace-hint" role="note">2.6× 示意</span> : null}
    </div>
    <div className="qh-machine-fields">
      <label>外形 <select aria-label={`${item.type.name}演示实例${item.n}外形`} value={value.model}
        onChange={e => onUpdate({ model: e.target.value as Setting['model'] })}>
        <option value="standard">标准外形</option><option value="compact">紧凑外形</option>
      </select></label>
      <label>状态 <select aria-label={`${item.type.name}演示实例${item.n}状态`} value={value.state}
        onChange={e => onUpdate({ state: e.target.value as FleetState })}>
        {order.map(state => <option key={state} value={state}>{names[state]}</option>)}
      </select></label>
    </div>
    <div className="qh-machine-actions">
      <button type="button" role="switch" aria-checked={value.state === 'running'}
        aria-label={`${item.type.name}演示实例${item.n}开关`} onClick={() => onUpdate({ state: value.state === 'running' ? 'standby' : 'running' })}>
        {value.state === 'running' ? '关闭演示' : '开启演示'}</button>
      {onInspect && <button type="button" onClick={() => onInspect(item.type.id, value.state)} aria-label={`${item.type.name}演示实例${item.n}类型资料`}>类型资料 ↗</button>}
    </div>
    <details className="qh-machine-detail"><summary>实例详情</summary><small className="qh-machine-id">{item.id} · 非工业对象 ID（demo）</small></details>
  </article>
}

/** Presentation-only instances; never copies unit values or invokes device/approval APIs. */
export default function DemoFleet({ types, renderGlyph, onInspect, targetType }: {
  types: FleetType[]; renderGlyph: (typeId: string, phase: number) => ReactNode
  onInspect?: (typeId: string, state: FleetState) => void
  targetType?: string | null
}) {
  const instances = useMemo(() => types.flatMap(type => [1, 2].map(n => ({ id: `demo/${type.id}/${n}`, n, type }))), [types])
  const [settings, setSettings] = useState<Record<string, Setting>>({})
  const [filter, setFilter] = useState(targetType && types.some(t => t.id === targetType) ? targetType : 'all')
  useEffect(() => { if (targetType && types.some(t => t.id === targetType)) setFilter(targetType) }, [targetType, types])
  const [foreground, setForeground] = useState(() => typeof document === 'undefined' || !document.hidden)
  const [visible, setVisible] = useState<Set<string>>(() => new Set(instances.map(item => item.id)))
  const root = useRef<HTMLElement>(null)
  const shown = filter === 'all' ? instances : instances.filter(item => item.type.id === filter)
  useEffect(() => {
    const change = () => setForeground(!document.hidden)
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => setVisible(old => {
      const next = new Set(old)
      for (const entry of entries) {
        const id = entry.target.getAttribute('data-instance')
        if (id) { if (entry.isIntersecting) next.add(id); else next.delete(id) }
      }
      return next
    }))
    for (const card of root.current.querySelectorAll('[data-instance]')) observer.observe(card)
    return () => observer.disconnect()
  }, [instances, filter])
  const setting = (id: string): Setting => settings[id] ?? { state: 'standby', model: 'standard' }
  const update = (id: string, delta: Partial<Setting>) => setSettings(old => ({ ...old, [id]: { ...(old[id] ?? { state: 'standby', model: 'standard' }), ...delta } }))
  return <section className="qh-demo-fleet" ref={root} aria-label="多实例设备演示库">
    <header className="qh-fleet-head"><div><h3>设备演示库</h3><p>{types.length} 类 · {instances.length} 个演示实例</p></div>
      <label>展示类型 <select aria-label="演示库展示类型" value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="all">全部类型</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
      </select></label>
    </header>
    <details className="qh-fleet-boundary"><summary>演示库说明</summary><p>以下开关只改变演示，不连接设备、不改变调度或审批。压力、露点、压差等真值未提供，均为未知；演示实例非当前站机组、非工业对象。机构相位与序幕舞台共享同一回放时钟：暂停冻结、恢复续相、定位到确定终态。</p></details>
    <div className="qh-fleet-grid">
      {shown.map(item => {
        const value = setting(item.id)
        const moving = foreground && visible.has(item.id) && (value.state === 'running' || value.state === 'loading')
        return <MachineCard key={item.id} item={item} value={value} moving={moving}
          onUpdate={(delta) => update(item.id, delta)} onInspect={onInspect} renderGlyph={renderGlyph} />
      })}
    </div>
  </section>
}
