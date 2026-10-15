import { useId, type ReactNode } from 'react'
import {
  poseFor, INFORMATIVE_PHASE, ADS_STAGE_LABEL, screwChamberVolume,
  type AdsorberPose, type CentrifugalPose, type DryerPose, type FilterPose,
  type PistonPose, type ScrewPose, type TankPose, type ValvePose,
} from './deviceKinematics'

/** User-approved original AI artwork; generic structure, never a site/model identity. */
/**
 * r41 居中裁切：由 tools/bbox_center_r41.py 对批准 atlas 做连通域可见 bbox 测量得出
 *（证据 00-control/.../tools/atlas-bbox-r41.json）。每帧以"可见内容中心"为框中心，
 * 逐边 pad 受邻机间隙/atlas 边界约束；残差(resid)由 RESID 整组 translate 系统补偿
 *（同一坐标系内机身+机构一起平移，不是单类 magic value，也不是 transform-origin 技巧）。
 */
const FRAMES: Record<string, [number, number, number, number]> = {
  screw: [7.2, 55.2, 489.8, 399.6], centrifugal: [483, 26.6, 535.4, 424.4],
  piston: [1000.4, 34.4, 477.1, 444.1], tank: [1464.9, 2, 269.2, 471.1],
  dryer: [22.9, 455.9, 402.2, 412.2], adsorber: [480.2, 439, 519.7, 446],
  filter: [1027.9, 478.9, 307.1, 393.1], valve: [1340, 517, 430.1, 360.1],
}
const RESID: Record<string, [number, number]> = {
  screw: [5.41, 0], centrifugal: [-6.7, 7.7], piston: [0, 0], tank: [0, -8.05],
  dryer: [0, 0], adsorber: [0, -3], filter: [0, 0], valve: [0, 0],
}
/** 机构锚点沿用 r40 的 atlas px 基点（hand-calibrated + 连通域 body-centre 证据）。 */
const ANCHORS: Record<string, [number, number]> = {
  screw: [249, 254], centrifugal: [744, 246], piston: [1279, 240], tank: [1602, 235],
  dryer: [301, 655], adsorber: [748, 661], filter: [1185, 677], valve: [1477, 573],
}

const PRINCIPLE_LABELS: Record<string, string[]> = {
  screw: ['互啮转子 4:6 反向', '封闭容积 入口→出口 缩小', '气流沿腔体轴向排出'],
  centrifugal: ['叶轮旋转 径向甩出', '扩压器 速度能→压力', '蜗壳汇集 出气路径固定'],
  piston: ['曲柄连杆 精确相位', '进/排气阀 与冲程同步', '教学慢速 非真实 rpm'],
  tank: ['压力缓冲 不是液位', '表针随缓冲波动', '底部独立排凝过程'],
  dryer: ['换热气路 + 冷媒回路', '凝露分离 间歇排凝', '出口持续干燥'],
  adsorber: ['一塔吸附 一塔再生', '切换含均压阶段', '干燥出口持续'],
  filter: ['穿透滤芯 上游截留', '压差随加载上升（示意）', '干净出口'],
  valve: ['球阀阀芯开度', '开度→示意流量', '支路路径高亮'],
}

const dash = (flow: number, len: number) => ({ strokeDasharray: `${(len / 6).toFixed(1)} ${(len / 9).toFixed(1)}`, strokeDashoffset: (-flow * len).toFixed(1) })

function ScrewMech(p: ScrewPose): ReactNode {
  const lobe = (n: number, r: number) => {
    let d = ''
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const a2 = ((i + 0.5) / n) * Math.PI * 2
      d += `${i ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)} Q${(Math.cos(a2) * r * 0.62).toFixed(1)} ${(Math.sin(a2) * r * 0.62).toFixed(1)} ${(Math.cos(((i + 1) / n) * Math.PI * 2) * r).toFixed(1)} ${(Math.sin(((i + 1) / n) * Math.PI * 2) * r).toFixed(1)} `
    }
    return d + 'Z'
  }
  return <>
    <rect className="mech-window" x="-46" y="-24" width="92" height="48" rx="10" />
    <g transform="translate(-16 0)"><g className="mech-cw" transform={`rotate(${p.angleDeg.toFixed(1)})`}>
      <path className="mech-line" d={lobe(4, 15)} /><circle className="mech-core" r="2.6" />
    </g></g>
    <g transform="translate(16 0)"><g className="mech-ccw" transform={`rotate(${p.femaleDeg.toFixed(1)})`}>
      <path className="mech-line" d={lobe(6, 14)} /><circle className="mech-core" r="2.4" />
    </g></g>
    {p.chambers.map((c, i) => (
      <rect key={i} className="mech-fill chamber" x={-34 + c * 62} y="-4" width={8 * screwChamberVolume(c) + 2} height="8" rx="3"
        opacity={(0.25 + 0.5 * screwChamberVolume(c)).toFixed(2)} />
    ))}
    <path className="mech-flow" d="M-42 14 H42" style={dash(p.flow, 84)} />
    <path className="mech-line thin" d="M-42 14 h6 M36 14 h6" />
  </>
}
function CentrifugalMech(p: CentrifugalPose): ReactNode {
  return <>
    <circle className="mech-window" r="30" />
    {[0, 32.7, 65.5, 98.2, 130.9, 163.6, 196.4, 229.1, 261.8, 294.5].map((a) => (
      <path key={a} className="mech-line thin vane" transform={`rotate(${a})`} d="M0 -22 Q4 -26 2 -29" />
    ))}
    <g className="mech-cw" transform={`rotate(${p.impellerDeg.toFixed(1)})`}>
      {[0, 51.4, 102.9, 154.3, 205.7, 257.1, 308.6].map((a) => (
        <path key={a} className="mech-line" transform={`rotate(${a})`} d="M0 -4 Q9 -10 14 -18" />
      ))}
      <circle className="mech-core" r="4" />
    </g>
    <path className="mech-flow" d="M0 -22 V-30 M22 0 H30" style={dash(p.diffuserFlow, 16)} />
    <path className="mech-flow" d="M30 0 Q34 10 26 16" style={dash(p.voluteFlow, 30)} />
  </>
}
function PistonMech(p: PistonPose): ReactNode {
  const y = -22 + p.pistonTravel * 26            // 活塞顶位置
  const crankC = { x: 0, y: 20 }
  const rad = (p.crankDeg * Math.PI) / 180
  const pin = { x: crankC.x + 7 * Math.sin(rad), y: crankC.y - 7 * Math.cos(rad) }
  return <>
    <rect className="mech-window" x="-20" y="-34" width="40" height="70" rx="10" />
    <path className="mech-line" d="M-12 8 V-24 Q-12 -30 -5 -30 H5 Q12 -30 12 -24 V8" />
    <g className="mech-valve in" opacity={(0.35 + 0.65 * p.intakeLift).toFixed(2)} transform={`translate(-7 -30)`}>
      <path className="mech-line thin" d={`M0 ${(-p.intakeLift * 4).toFixed(1)} v-4`} /><circle className="mech-fill" cy={(-p.intakeLift * 4).toFixed(1)} r="2.2" />
    </g>
    <g className="mech-valve ex" opacity={(0.35 + 0.65 * p.exhaustLift).toFixed(2)} transform="translate(7 -30)">
      <path className="mech-line thin" d={`M0 ${(-p.exhaustLift * 4).toFixed(1)} v-4`} /><circle className="mech-fill" cy={(-p.exhaustLift * 4).toFixed(1)} r="2.2" />
    </g>
    {p.compression ? <rect className="mech-fill chamber" x="-11" y={y - 6} width="22" height="6" opacity="0.5" /> : null}
    <g className="mech-piston"><rect className="mech-fill" x="-10" y={y.toFixed(1)} width="20" height="8" rx="2" /></g>
    <path className="mech-line" d={`M0 ${(y + 8).toFixed(1)} L${pin.x.toFixed(1)} ${pin.y.toFixed(1)}`} />
    <g transform={`translate(${crankC.x} ${crankC.y})`}>
      <circle className="mech-line" r="9" />
      <g className="mech-crank" transform={`rotate(${p.crankDeg.toFixed(1)})`}>
        <path className="mech-line thin" d="M0 0 V-7" /><circle className="mech-core" cy="-7" r="2.4" /><circle className="mech-fill" cy="4" r="2.6" />
      </g>
    </g>
  </>
}
function TankMech(p: TankPose): ReactNode {
  const dots = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2 + p.jitter * Math.PI * 2
    return { x: Math.cos(a) * (5 + (i % 3) * 2.4), y: Math.sin(a * 1.3) * (8 + (i % 2) * 5) }
  })
  return <>
    <rect className="mech-window" x="-15" y="-28" width="30" height="56" rx="10" />
    <g className="mech-gauge" transform="translate(0 -34)">
      <path className="mech-line" d="M-8 0 A8 8 0 0 1 8 0" />
      <path className="mech-line thin" d="M-8 0 h2 M6 0 h2 M0 -8 v2" />
      <path className="mech-needle" d="M0 0 L0 -6.5" transform={`rotate(${p.needleDeg.toFixed(1)})`} />
      <circle className="mech-core" r="1.4" />
    </g>
    {dots.map((d, i) => <circle key={i} className="mech-fill particle" cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r="1.5" opacity="0.75" />)}
    <path className="mech-flow" d="M-15 -14 h-5 M15 -14 h5" style={dash(p.jitter, 10)} />
    <g className="mech-drain" opacity={(0.3 + 0.7 * p.drainOpen).toFixed(2)}>
      <path className="mech-line thin" d="M0 28 v5" /><circle className="mech-fill" cy="35" r={1 + p.drainOpen * 1.6} />
    </g>
  </>
}
function DryerMech(p: DryerPose): ReactNode {
  return <>
    <rect className="mech-window" x="-34" y="-22" width="68" height="44" rx="10" />
    <path className="mech-flow air" d="M-30 -12 H-8 Q0 -12 0 -4 V6 Q0 12 8 12 H30" style={dash(p.airFlow, 78)} />
    <path className="mech-flow cold" d="M30 -14 H10 Q4 -14 4 -8" style={dash(p.coldOut, 34)} />
    <g className="mech-refrig">
      <path className="mech-line thin loop" d="M-24 16 H20 Q26 16 26 10 V2 Q26 -4 20 -4 H-18 Q-24 -4 -24 2 Z" style={dash(p.refrigFlow, 108)} />
      <circle className="mech-core" cx="-24" cy="6" r="2.2" /><circle className="mech-line thin" cx="26" cy="-1" r="2.2" />
    </g>
    <g className="mech-sep" transform="translate(14 2)">
      <path className="mech-line" d="M-4 -6 V6 Q-4 9 0 9 Q4 9 4 6 V-6" />
      <rect className="mech-fill drop" x="-3" y={(9 - p.droplet * 12).toFixed(1)} width="6" height={(p.droplet * 12).toFixed(1)} rx="2" opacity="0.7" />
    </g>
    <g className="mech-drain" opacity={(0.3 + 0.7 * p.drainOpen).toFixed(2)}>
      <path className="mech-line thin" d="M14 11 v5" /><circle className="mech-fill" cy="18" r={0.8 + p.drainOpen * 1.4} />
    </g>
  </>
}
function AdsorberMech(p: AdsorberPose): ReactNode {
  const eq = p.stage.startsWith('equalize')
  const tower = (dx: number, cls: string, adsorbing: boolean) => (
    <g transform={`translate(${dx} 0)`}>
      <rect className="mech-line" x="-9" y="-14" width="18" height="32" rx="4" />
      <rect className={`${cls} bed`} x="-7" y="-12" width="14" height="28" rx="3" opacity={adsorbing ? 0.85 : 0.4} />
      <path className={`mech-flow ${adsorbing ? 'down' : 'up'}`} d={adsorbing ? 'M0 -12 V16' : 'M0 16 V-12'} style={dash(eq ? 0.15 : p.flow, 28)} opacity={eq ? 0.35 : 1} />
    </g>
  )
  return <>
    <rect className="mech-window" x="-42" y="-26" width="84" height="52" rx="10" />
    <path className="mech-line" d="M-24 -18 H24" />
    {tower(-24, 'mech-tower-a', p.adsorb === 'A')}
    {tower(24, 'mech-tower-b', p.adsorb === 'B')}
    <path className="mech-flow eq" d="M-24 -18 Q0 -24 24 -18" style={dash(p.inStage, 52)} opacity={eq ? 1 : 0} />
    <path className="mech-flow dry" d="M0 -18 V-24 H40" style={dash(p.dryOut, 46)} />
    <text className="mech-stage" x="0" y="24" textAnchor="middle">{ADS_STAGE_LABEL[p.stage]}</text>
  </>
}
function FilterMech(p: FilterPose): ReactNode {
  return <>
    <rect className="mech-window" x="-34" y="-18" width="68" height="36" rx="9" />
    <path className="mech-line pleat mech-pleat" d="M-12 -10 L-8 10 L-4 -10 L0 10 L4 -10 L8 10 L12 -10" />
    {[0, 1, 2, 3, 4].map((i) => (
      <circle key={i} className="mech-fill trapped" cx={(-16 - (i % 2) * 3).toFixed(1)} cy={(-8 + i * 4).toFixed(1)} r="1.6"
        opacity={Math.min(1, Math.max(0, p.trapped * 1.4 - i * 0.22)).toFixed(2)} />
    ))}
    <path className="mech-flow" d="M-30 0 H-14" style={dash(p.flow, 16)} />
    <path className="mech-flow clean" d="M14 0 H30" style={dash(p.clean, 16)} />
    <g className="mech-dp" transform="translate(0 -24)">
      <path className="mech-line thin" d="M-7 0 A7 7 0 0 1 7 0" />
      <path className="mech-needle" d="M0 0 L0 -5.5" transform={`rotate(${(-50 + p.dp * 100).toFixed(1)})`} />
    </g>
  </>
}
function ValveMech(p: ValvePose): ReactNode {
  return <>
    <rect className="mech-window" x="-30" y="-18" width="60" height="36" rx="9" />
    <path className="mech-line thick" d="M-28 0 H-11 M11 0 H28" />
    <g className="mech-ball" transform={`rotate(${(p.ballDeg - 45).toFixed(1)})`}>
      <circle className="mech-line" r="11" />
      <rect className="mech-fill bore" x="-11" y="-3.4" width="22" height="6.8" rx="3" />
    </g>
    <path className="mech-line thin" d="M0 -11 V-15" /><circle className="mech-line" cy="-17" r="2.4" />
    <path className="mech-flow" d="M-28 6 H28" style={dash(p.flow, 56)} opacity={(0.25 + 0.75 * p.opening).toFixed(2)} />
    <path className="mech-flow branch" d="M0 11 V16 H24" style={dash(p.flow, 30)} opacity={(p.branch * 0.9).toFixed(2)} />
    <text className="mech-stage" x="0" y="-22" textAnchor="middle">{`开度 ${(p.opening * 100).toFixed(0)}%`}</text>
  </>
}

function mechFor(typeId: string, t: number): ReactNode {
  const pose = poseFor(typeId, t)
  switch (pose.type) {
    case 'screw': return ScrewMech(pose.v)
    case 'centrifugal': return CentrifugalMech(pose.v)
    case 'piston': return PistonMech(pose.v)
    case 'tank': return TankMech(pose.v)
    case 'dryer': return DryerMech(pose.v)
    case 'adsorber': return AdsorberMech(pose.v)
    case 'filter': return FilterMech(pose.v)
    case 'valve': return ValveMech(pose.v)
  }
}
function phaseNote(typeId: string, t: number): string {
  const pose = poseFor(typeId, t)
  switch (pose.type) {
    case 'piston': return pose.v.intakeLift > 0 ? '进气冲程' : pose.v.compression ? '压缩冲程' : '排气冲程'
    case 'adsorber': return ADS_STAGE_LABEL[pose.v.stage]
    case 'valve': return `开度 ${(pose.v.opening * 100).toFixed(0)}%`
    case 'filter': return `加载 ${(pose.v.load * 100).toFixed(0)}%（示意）`
    case 'tank': return `缓冲压力相位 ${(pose.v.pressure * 100).toFixed(0)}（示意）`
    case 'dryer': return pose.v.drainOpen > 0 ? '排凝中' : '凝露分离中'
    case 'screw': return `腔体行程 ${(pose.v.chambers[0] * 100).toFixed(0)}%`
    case 'centrifugal': return '叶轮→扩压→蜗壳'
  }
}

export default function DeviceArtwork({ typeId, phase = 0, mode = 'shell' }: { typeId: string; phase?: number; mode?: 'shell' | 'principle' }) {
  const f = FRAMES[typeId] ?? FRAMES.screw
  const resid = RESID[typeId] ?? [0, 0]
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const clip = `device-art-${uid}`
  const anchor = ANCHORS[typeId] ?? ANCHORS.screw
  const t = phase
  if (mode === 'principle') {
    return <span className={`qh-device-art art-${typeId} is-principle`}>
      <svg viewBox="0 0 220 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <g className="qh-mech principle" transform="translate(110 66) scale(1.55)">{mechFor(typeId, t)}</g>
        <g className="mech-labels">
          {(PRINCIPLE_LABELS[typeId] ?? []).map((s, i) => (
            <text key={s} className="mech-label" x="12" y={118 + i * 11}>{s}</text>
          ))}
        </g>
        <text className="mech-phase" x="208" y="16" textAnchor="end">{phaseNote(typeId, t)}</text>
      </svg>
    </span>
  }
  // 外观层：批准 atlas 稳定机身 + 同坐标系矢量机构窗；居中=测量框+残差补偿+meet。
  return <span className={`qh-device-art art-${typeId}`}>
    <svg viewBox={f.join(' ')} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs><clipPath id={clip}><rect x={f[0]} y={f[1]} width={f[2]} height={f[3]} /></clipPath></defs>
      <g transform={`translate(${(-resid[0]).toFixed(2)} ${(-resid[1]).toFixed(2)})`}>
        <g clipPath={`url(#${clip})`}><image href="/assets/devices/device-family-r01.png" width="1774" height="887" /></g>
        <g className="qh-mech" transform={`translate(${anchor[0]} ${anchor[1]})`}>{mechFor(typeId, t)}</g>
      </g>
    </svg>
  </span>
}
export { INFORMATIVE_PHASE }
export const DEVICE_FRAMES_R41 = FRAMES
export const DEVICE_RESID_R41 = RESID
