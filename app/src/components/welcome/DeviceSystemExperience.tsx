import DeviceArtwork from './DeviceArtwork'
import { replayWindow } from '../replayWindow'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Popover } from '../ui/Disclosure'
import DemoFleet from './DemoFleet'
import { formatLoadPercent, type HostPlayback, type HostPlaybackUnit } from './hostPlayback'
import { useMechPhase, motionReduced } from './mechClock'
import { INFORMATIVE_PHASE } from './deviceKinematics'

/**
 * M28/M29 · 序幕「设备系统体验」代表。
 * M29 r05 · 1：消费宿主真实观察快照 HostPlayback（复用 ObservationClockApi 与合法既有长序列）：
 * 真实需求/供气趋势、逐桶柱、功率/能量、时间标签与播放控制同刻同源；调度/回放分源不串分母；缺值 null 不补零。
 * 设备类型映射真实机组（screw→AC-01/02、centrifugal→AC-03）；tank/dryer 无真数据诚实空态，不套 AC 值。
 * 演示开停只改展示，不调审批/Start/advance/设备指令；未知边界不渲染为可启动。
 */
interface DeviceType {
  id: string
  name: string
  tag: string
  statusNote: string
  boundary: 'known' | 'unknown'
  boundaryNote: string
  sheet: string[]
  realUnits: string[]
}

type DemoState = 'running' | 'standby' | 'fault' | 'loading'
const STATE_ORDER: DemoState[] = ['running', 'standby', 'fault', 'loading']
const STATE_LABEL: Record<DemoState, string> = {
  running: '运行（演示）', standby: '待机（演示）', fault: '故障（演示）', loading: '加载（演示）',
}

export const DEMO_DEVICE_TYPES: DeviceType[] = [
  { id: 'screw', name: '螺杆空压机', tag: '容积式', statusNote: '真实关联：AC-01 / AC-02（合成调度候选机组）。', boundary: 'known', boundaryNote: '边界已核实（演示口径）', sheet: ['形态：双螺杆转子啮合', '真实关联：AC-01 / AC-02', '演示开停只改展示，不调设备'], realUnits: ['AC-01', 'AC-02'] },
  { id: 'centrifugal', name: '离心空压机', tag: '离心式', statusNote: '真实关联：AC-03（喘振边界未核实，仅监测、排除调度）。', boundary: 'unknown', boundaryNote: '安全边界未知：不据此启动', sheet: ['形态：蜗壳 + 叶轮', '真实关联：AC-03（仅监测）', '边界未知，不据此启停'], realUnits: ['AC-03'] },
  { id: 'tank', name: '储气罐', tag: '储气缓冲', statusNote: '演示：缓冲与供气示意；当前无对应真实对象数据。', boundary: 'known', boundaryNote: '容量参数为演示', sheet: ['形态：立式罐体', '无对应真实对象数据'], realUnits: [] },
  { id: 'dryer', name: '冷干机', tag: '后处理', statusNote: '演示：与露点/含水示意；露点真值缺失。', boundary: 'unknown', boundaryNote: '露点真值未知：只读示意', sheet: ['形态：换热器 + 盘管', '露点真值缺失（未知）'], realUnits: [] },
  { id: 'piston', name: '活塞空压机', tag: '容积式', statusNote: '演示：往复活塞；压力/流量真值缺失。', boundary: 'unknown', boundaryNote: '真值缺失：只读示意', sheet: ['形态：活塞往复 + 曲轴', '真值缺失（未知）'], realUnits: [] },
  { id: 'adsorber', name: '吸附式干燥机', tag: '后处理', statusNote: '演示：双塔吸附/再生交替；切换规律为示意。', boundary: 'unknown', boundaryNote: '再生真值未知：只读示意', sheet: ['形态：双塔交替', '再生真值未知'], realUnits: [] },
  { id: 'filter', name: '过滤器', tag: '后处理', statusNote: '演示：压差随累计流量上升；压差真值缺失。', boundary: 'unknown', boundaryNote: '压差未知：只读示意', sheet: ['形态：滤芯', '压差真值缺失'], realUnits: [] },
  { id: 'valve', name: '阀门/支路', tag: '管网', statusNote: '演示：开度对支路流量影响；为示意管网，未核。', boundary: 'unknown', boundaryNote: '管网未核：只读示意', sheet: ['形态：阀座 + 支路', '物理管网未核实'], realUnits: [] },
]

export function DeviceGlyph({ id, phase = 0, mode = 'shell' }: { id: string; phase?: number; mode?: 'shell' | 'principle' }) {
  return <DeviceArtwork typeId={id} phase={phase} mode={mode} />
}

const VB_W = 520, VB_H = 130, PAD = 12
function pathFor(values: (number | null)[], lo: number, hi: number): string {
  const span = Math.max(0.001, hi - lo)
  const x = (i: number) => PAD + (i / Math.max(1, values.length - 1)) * (VB_W - PAD * 2)
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (VB_H - PAD * 2)
  let d = '', pen = false
  values.forEach((v, i) => { if (v === null) { pen = false; return } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; pen = true })
  return d.trim()
}

function unitText(u: HostPlaybackUnit | undefined): string {
  if (!u) return '未收录'
  return u.eligible ? '候选（可选）' : `不参与调度：${u.reason ?? '原因未提供'}`
}

export default function DeviceSystemExperience({ hostObservation, hostPlayback, deviceView, onDeviceViewChange, onOpenDemo }: {
  hostObservation?: { source: 'schedule' | 'history'; label: string }
  hostPlayback?: HostPlayback
  onOpenDemo?: (typeId: string, originId: string) => void
  deviceView?: { deviceId: string; demoState: string } | null
  onDeviceViewChange?: (v: { deviceId: string; demoState: string }) => void
}) {
  const [selectedId, setSelectedId] = useState<string>(deviceView?.deviceId ?? DEMO_DEVICE_TYPES[0].id)
  // r41 · 主展示精选一台默认运行（明确演示、可暂停），让人一眼发现动效；入口快照优先。
  const [state, setState] = useState<DemoState>((deviceView?.demoState as DemoState) ?? 'running')
  const [viewMode, setViewMode] = useState<'shell' | 'principle'>('shell')
  // 入口快照恢复：deviceView 变化时同步选中/演示状态（不新增 store）。
  useEffect(() => {
    if (deviceView?.deviceId && DEMO_DEVICE_TYPES.some((t) => t.id === deviceView.deviceId)) setSelectedId(deviceView.deviceId)
    if (deviceView?.demoState && STATE_ORDER.includes(deviceView.demoState as DemoState)) setState(deviceView.demoState as DemoState)
  }, [deviceView?.deviceId, deviceView?.demoState])
  const pickDevice = (id: string) => { setSelectedId(id); onDeviceViewChange?.({ deviceId: id, demoState: state }) }
  const pickState = (s: DemoState) => { setState(s); onDeviceViewChange?.({ deviceId: selectedId, demoState: s }) }
  const [pipelineOn, setPipelineOn] = useState(false)
  const visualRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  const [foreground, setForeground] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const onVisibility=()=>setForeground(!document.hidden)
    document.addEventListener('visibilitychange',onVisibility)
    const observer=typeof IntersectionObserver!=='undefined' ? new IntersectionObserver(entries=>setVisible(entries[0]?.isIntersecting ?? false)) : null
    if(visualRef.current) observer?.observe(visualRef.current)
    return ()=>{ observer?.disconnect(); document.removeEventListener('visibilitychange',onVisibility) }
  }, [])

  const selected = DEMO_DEVICE_TYPES.find((t) => t.id === selectedId) ?? DEMO_DEVICE_TYPES[0]
  const unknown = selected.boundary === 'unknown'

  const [dynamic, setDynamic] = useState(true)
  const pb = hostPlayback
  const [windowStart, windowEnd] = replayWindow(pb?.labels.length ?? 0, pb?.index ?? 0, dynamic)
  const localIndex = (pb?.index ?? 0) - windowStart
  const nums = pb ? [...pb.demand, ...pb.supply].filter((v): v is number => v !== null) : []
  const lo = nums.length ? Math.min(...nums) - 0.3 : 0
  const hi = nums.length ? Math.max(...nums) + 0.3 : 1
  const cur = pb ? { label: pb.labels[pb.index] ?? '—', demand: pb.demand[pb.index] ?? null, supply: pb.supply[pb.index] ?? null, power: pb.power[pb.index] ?? null } : null
  const rpbIndex = pb ? pb.index : 0
  const unitRow = (id: string) => pb?.units.find((u) => u.id === id)
  // 同刻联动：累计能量（到当前 index）与当前总功率；缺值不按 0 计入，另记缺数。
  const cumEnergy = pb ? pb.energy.slice(0, pb.index + 1).reduce<number>((s, v) => s + (v ?? 0), 0) : 0
  const missingEnergy = pb ? pb.energy.slice(0, pb.index + 1).filter((v) => v === null).length : 0
  const nowRunning = !!pb && pb.playing && (cur?.supply ?? 0) > 0

  // r43 · 机构相位时钟绑定已上移到 useObservationClock（唯一写者，全路由生效）；本组件只消费相位。
  const stageActive = visible && foreground && (state === 'running' || state === 'loading')
  const stagePhase = useMechPhase(stageActive, INFORMATIVE_PHASE[selected.id] ?? 0) * (state === 'loading' ? 2.6 : 1)
  const [reduced, setReduced] = useState(() => motionReduced())
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])

  return (
    <div className="qh-device-det" aria-label="设备系统体验（只读演示库）">
      <ul className="qh-device-list" role="list">
        {DEMO_DEVICE_TYPES.map((t) => {
          const on = t.id === selectedId
          return (
            <li key={t.id}>
              <button type="button"
                className={`qh-device-item${on ? ' on' : ''}${t.boundary === 'unknown' ? ' is-unknown' : ''}`}
                aria-pressed={on} data-device={t.id} data-boundary={t.boundary}
                onClick={() => pickDevice(t.id)}>
                <span className="qh-device-item-glyph"><DeviceGlyph id={t.id} phase={INFORMATIVE_PHASE[t.id] ?? 0} /></span>
                <span className="qh-device-item-txt"><b>{t.name}</b><span className="qh-device-tag">{t.tag}{t.realUnits.length === 0 ? ' · 演示库' : ''}</span></span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="qh-device-panel">
        {hostObservation ? (
          <p className="qh-device-observ" data-testid="device-host-observation">
            {hostObservation.label} · {hostObservation.source === 'schedule' ? '合成示例' : '回放夹具'}
            <details className="qh-note-details"><summary>来源</summary><p>同源观察时刻 {hostObservation.label}：来源{hostObservation.source === 'schedule' ? '合成调度示例' : '合成回放夹具'}，与控制台同一时刻。</p></details>
          </p>
        ) : null}

        <div ref={visualRef} className={`qh-device-orbit-wrap${unknown ? ' is-unknown' : ''}`} data-demo-state={state} data-device={selected.id}>
          <div className="qh-device-orbit" role="img"
            aria-label={`${selected.name} 演示状态：${STATE_LABEL[state]}${viewMode === 'principle' ? ' · 原理剖视' : ' · 外观'}${unknown ? '；安全边界未知' : ''}`}>
            <DeviceGlyph id={selected.id} phase={stagePhase} mode={viewMode} />
          </div>
          <span className={`qh-device-pipe-node${pipelineOn ? ' on' : ''}${state === 'running' || nowRunning ? ' flow' : ''}`} aria-hidden="true" />
          <div className="qh-orbit-ctrl" role="group" aria-label="舞台视图与演示走带（仅展示）">
            <button type="button" className={`qh-orbit-mode${viewMode === 'shell' ? ' on' : ''}`} aria-pressed={viewMode === 'shell'} onClick={() => setViewMode('shell')}>外观</button>
            <button type="button" className={`qh-orbit-mode${viewMode === 'principle' ? ' on' : ''}`} aria-pressed={viewMode === 'principle'} onClick={() => setViewMode('principle')}>原理</button>
            <button type="button" className="btn ghost qh-orbit-play" aria-pressed={state === 'running'}
              onClick={() => pickState(state === 'running' ? 'standby' : 'running')}>
              {state === 'running' ? '暂停演示' : '精选运行'}
            </button>
            {reduced ? <span className="qh-reduce-note" role="note">减少动效：静态关键相位</span> : null}
          </div>
        </div>

        <p className="qh-device-status" data-device-status={selected.id}><b>{selected.name}</b>：{selected.statusNote}</p>
        <p className={`qh-device-boundary${unknown ? ' warn' : ''}`} role="note">{selected.boundaryNote}</p>

        {selected.realUnits.length > 0 ? (
          <ul className="qh-device-real" data-testid="device-real-units">
            {selected.realUnits.map((uid) => {
              const u = unitRow(uid)
              const abs = pb?.loadsAt(rpbIndex)?.[uid]
              const ratioFinal = pb?.loadRatiosAt(rpbIndex)?.[uid]
              return (
                <li key={uid}>
                  <b className="mono">{uid}</b> · {unitText(u)}
                  {typeof abs === 'number' && Number.isFinite(abs) ? ` · 当前负载 ${formatLoadPercent(ratioFinal)}（${abs.toFixed(1)} m³/min）` : ' · 当前负载 未知'}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="hint" data-testid="device-no-real-data">
            该类型在演示库无对应真数据：不套用实际机组值，也不与真实调度对象混用。
          </p>
        )}

        <div className="qh-device-states" role="group" aria-label="演示状态切换（不改变真实状态）">
          {STATE_ORDER.map((s) => (
            <button type="button" key={s} className={`qh-device-state${state === s ? ' on' : ''}`}
              aria-pressed={state === s} data-demo-state={s} onClick={() => pickState(s)}>{STATE_LABEL[s]}</button>
          ))}
        </div>

        <div className="qh-device-actions">
          {onOpenDemo && <button type="button" className="btn ghost" id={`welcome-demo-open-${selected.id}`} onClick={e => onOpenDemo(selected.id, e.currentTarget.id)}>打开设备演示库</button>}
          <label className="qh-device-switch">
            <input type="checkbox" checked={pipelineOn} onChange={(e) => setPipelineOn(e.target.checked)} />
            <span>演示管路连通</span>
          </label>
          <Popover label="查看该类型的资料与边界" ariaLabel={`${selected.name}：演示库资料与边界`}>
            <div className="source-details-body">
              <p><b>{selected.name}</b>（{selected.tag}）· 演示库，不是当前站机组。</p>
              <ul>{selected.sheet.map((x) => <li key={x}>{x}</li>)}</ul>
              <p className="hint">演示状态只改本区展示；不调用审批 / Start / advance / 设备指令，动画转动不是实际启动证据。</p>
            </div>
          </Popover>
        </div>
      </div>

      {pb ? (
        <div className="qh-host-pb" aria-label="同源真实回放（合成调度序列）">
          <div className="qh-host-pb-head">
            <button type="button" className="btn ghost" aria-pressed={dynamic} onClick={() => setDynamic(v => !v)}>{dynamic ? "动态回放 · 16桶" : "全段静态比较"}</button>
            <span className="tag">{pb.sourceLabel}</span>
            <span className="tag muted" data-testid="host-pb-clock">同源时刻 {cur?.label ?? '—'}</span>
            <span className="tag muted">窗口 {pb.window} · 步长 {pb.stepMinutes}min</span>
          </div>
          <svg className="qh-host-pb-svg" viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label={`需求与供气趋势（${pb.unitDemand}，缺值断开不补零）`}>
            <path className="hpb-line demand" d={pathFor(pb.demand.slice(windowStart, windowEnd), lo, hi)} fill="none" style={{d:`path("${pathFor(pb.demand.slice(windowStart, windowEnd), lo, hi)}")`,fill:"none"} as CSSProperties} />
            <path className="hpb-line supply" d={pathFor(pb.supply.slice(windowStart, windowEnd), lo, hi)} fill="none" style={{d:`path("${pathFor(pb.supply.slice(windowStart, windowEnd), lo, hi)}")`,fill:"none"} as CSSProperties} />
            {cur?.demand !== null && cur?.demand !== undefined ? <circle className="hpb-cursor" cx={PAD + (localIndex / Math.max(1, windowEnd - windowStart - 1)) * (VB_W - PAD * 2)} cy={PAD + (1 - (cur.demand - lo) / Math.max(.001, hi - lo)) * (VB_H - PAD * 2)} r={3} /> : null}
          </svg>
          <div className="qh-host-pb-legend" aria-hidden="true">
            <span className="lg demand" /> 需求（{pb.unitDemand}） <span className="lg supply" /> 供气（{pb.unitDemand}）
          </div>
          <div className="qh-host-pb-bars" role="group" aria-label="逐桶（当前高亮）">
            {pb.demand.slice(windowStart, windowEnd).map((v, local) => { const i = local + windowStart; return (
              <button type="button" key={i}
                className={`hpb-bar${i === pb.index ? ' on' : ''}${v === null ? ' gap' : ''}`}
                aria-pressed={i === pb.index}
                aria-label={`第 ${i + 1} 时段 ${pb.labels[i] ?? ''}${v === null ? ' 缺值' : ` 需求 ${v} ${pb.unitDemand}`}`}
                onClick={() => pb.onSeek(i)}>
                <span style={{ height: v === null ? '8%' : `${Math.min(100, Math.max(8, (v / (hi || 1)) * 100))}%` }} />
              </button>
            )})}
          </div>
          <p className="qh-host-pb-readout" role="status" data-testid="host-pb-readout">
            第 {pb.index + 1} 时段 · 需求 {cur?.demand ?? '缺值（未知）'} {pb.unitDemand} · 供气 {cur?.supply ?? '缺值（未知）'} {pb.unitDemand} · 当前功率 {cur?.power ?? '缺值（未知）'} {pb.unitPower} · 累计能量 {cumEnergy.toFixed(3)} kWh{missingEnergy ? `（含 ${missingEnergy} 处缺值未计入）` : ''}
          </p>
          <div className="qh-host-pb-ctrl" role="group" aria-label="回放控制">
            <button type="button" className="btn ghost" onClick={pb.onToggle} aria-pressed={pb.playing}>{pb.playing ? '暂停' : '播放并跟随'}</button>
            <button type="button" className="btn ghost" aria-label="上一时段" onClick={() => pb.onStep(-1)}>‹</button>
            <input type="range" min={0} max={Math.max(0, pb.labels.length - 1)} step={1} value={pb.index} aria-label="定位时段" onChange={(e) => pb.onSeek(Number(e.target.value))} />
            <button type="button" className="btn ghost" aria-label="下一时段" onClick={() => pb.onStep(1)}>›</button>
            <label className="hint"><input type="checkbox" checked={pb.looping} onChange={(e) => pb.onLoopChange(e.target.checked)} /> 循环</label>
            <label className="hpb-speed">倍速
              <select value={pb.speed} onChange={(e) => pb.onSpeed(Number(e.target.value) as 0.5 | 1 | 2)} aria-label="回放倍速">
                {[0.5, 1, 2].map((s) => <option key={s} value={s}>{s}×</option>)}
              </select>
            </label>
          </div>
          <details><summary>回放说明</summary><p>同一时间轴驱动设备、曲线、柱图与标签。动态展示最近16桶；可切全段静态比较。缺值不补零，不跨来源或跨圈累计，不改变审批与设备状态。</p></details>
        </div>
      ) : null}

      <details><summary>设备体验说明</summary><p>演示库，不是当前站机组；数值为示意，真值缺失即“未知”，不据此启动。机构相位与同源回放共时钟：暂停冻结、恢复续相、定位到确定终态；系统减少动效偏好下展示静态关键相位并在此说明，不假装省性能。</p></details>

      {/* M29 r24 · 多实例演示库（16 独立实例；纯展示，不改真实 3 机组/调度/审批） */}
      <DemoFleet
        types={DEMO_DEVICE_TYPES}
        renderGlyph={(typeId, phase) => <DeviceGlyph id={typeId} phase={phase} />}
        onInspect={(typeId, st) => { pickDevice(typeId); pickState(st as DemoState) }}
      />
    </div>
  )
}
