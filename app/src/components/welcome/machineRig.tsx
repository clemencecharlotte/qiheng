import type { ReactNode } from 'react'
import {
  poseFor, screwChamberVolume, ADS_STAGE_LABEL,
  type AdsorberPose, type CentrifugalPose, type DryerPose, type FilterPose,
  type PistonPose, type ScrewPose, type TankPose, type ValvePose,
} from './deviceKinematics'

/**
 * r45 ④ · 2.5D 分层工业机构 rig：静止机壳 + 剖视窗内连续运动部件 + 过程流向。
 * 统一材质（金属青灰/工业青/黄铜点缀/暗腔体），同一视角与比例语言；
 * 运动全部来自 deviceKinematics.poseFor（单一事实源），timestamp/delta 推进由 mechClock 供给。
 * 不是"静态 PNG + 蓝色贴纸"：剖视窗为机身内嵌层，部件有遮挡/透视/渐变。
 */

const M = {
  metalHi: '#93a3ad',
  metal: '#6d7c86',
  metalLo: '#48545c',
  teal: '#177e6f',
  tealHi: '#2aa198',
  dark: '#0e1519',
  dark2: '#152028',
  brass: '#c9a25a',
  flow: '#7fd6c9',
  glass: 'rgba(255,255,255,0.10)',
}

const dash = (flow: number, len: number) => ({
  strokeDasharray: `${(len / 6).toFixed(1)} ${(len / 9).toFixed(1)}`,
  strokeDashoffset: (-flow * len).toFixed(1),
})

function Defs({ uid }: { uid: string }) {
  return (
    <defs>
      <linearGradient id={`mt-${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={M.metalHi} />
        <stop offset=".45" stopColor={M.metal} />
        <stop offset="1" stopColor={M.metalLo} />
      </linearGradient>
      <linearGradient id={`tl-${uid}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={M.tealHi} />
        <stop offset="1" stopColor={M.teal} />
      </linearGradient>
      <radialGradient id={`cv-${uid}`} cx=".5" cy=".42" r=".75">
        <stop offset="0" stopColor={M.dark2} />
        <stop offset="1" stopColor={M.dark} />
      </radialGradient>
      <linearGradient id={`gl-${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="rgba(255,255,255,.16)" />
        <stop offset="1" stopColor="rgba(255,255,255,0)" />
      </linearGradient>
    </defs>
  )
}

/** 机壳公共层：底撬座 + 主体 + 面板线 + 顶部高光。 */
function Shell({ uid, x = 26, y = 34, w = 168, h = 96, rx = 10, teal = true }: { uid: string; x?: number; y?: number; w?: number; h?: number; rx?: number; teal?: boolean }) {
  return (
    <g className="rig-shell">
      <rect x={x + 6} y={y + h} width={w - 12} height={8} rx={3} fill={M.metalLo} />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={teal ? `url(#tl-${uid})` : `url(#mt-${uid})`} stroke={M.metalLo} strokeWidth="1.4" />
      <rect x={x + 3} y={y + 3} width={w - 6} height={16} rx={rx - 4} fill={`url(#gl-${uid})`} />
      <path d={`M${x + 10} ${y + h - 8} H${x + w - 10}`} stroke="rgba(0,0,0,.28)" strokeWidth="1" />
      <circle cx={x + 8} cy={y + 8} r="1.6" fill={M.metalLo} />
      <circle cx={x + w - 8} cy={y + 8} r="1.6" fill={M.metalLo} />
    </g>
  )
}

/** 剖视窗公共层：暗腔 + 金属框 + 玻璃斜光；部件绘制在其 clip 内。 */
function Cutaway({ uid, clipKey, x, y, w, h, children }: { uid: string; clipKey?: string; x: number; y: number; w: number; h: number; children?: ReactNode }) {
  const cid = `cut-${clipKey ?? uid}`
  return (
    <g className="rig-cut">
      <clipPath id={cid}><rect x={x} y={y} width={w} height={h} rx={8} /></clipPath>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={`url(#cv-${uid})`} />
      <g clipPath={`url(#${cid})`}>{children}</g>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="none" stroke={M.metalHi} strokeWidth="2" />
      <rect x={x + 1.5} y={y + 1.5} width={w - 3} height={h - 3} rx={7} fill="none" stroke="rgba(0,0,0,.5)" strokeWidth="1" />
      <path d={`M${x + 4} ${y + h * 0.7} L${x + w * 0.4} ${y + 4}`} stroke="rgba(255,255,255,.07)" strokeWidth="6" strokeLinecap="round" />
    </g>
  )
}

const lobe = (n: number, r: number) => {
  let d = ''
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const a2 = ((i + 0.5) / n) * Math.PI * 2
    d += `${i ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)} Q${(Math.cos(a2) * r * 0.62).toFixed(1)} ${(Math.sin(a2) * r * 0.62).toFixed(1)} ${(Math.cos(((i + 1) / n) * Math.PI * 2) * r).toFixed(1)} ${(Math.sin(((i + 1) / n) * Math.PI * 2) * r).toFixed(1)} `
  }
  return d + 'Z'
}

function ScrewRig({ p, uid }: { p: ScrewPose; uid: string }) {
  return <>
    <Shell uid={uid} />
    <rect x={150} y={62} width={34} height={26} rx={4} fill={M.metal} stroke={M.metalLo} />
    <Cutaway uid={uid} x={44} y={52} w={96} h={60}>
      <g transform="translate(72 82)"><g transform={`rotate(${p.angleDeg.toFixed(1)})`}>
        <path d={lobe(4, 20)} fill={M.metalHi} stroke={M.metalLo} strokeWidth="1.2" />
        <circle r="4" fill={M.brass} />
      </g></g>
      <g transform="translate(112 82)"><g transform={`rotate(${p.femaleDeg.toFixed(1)})`}>
        <path d={lobe(6, 18)} fill={M.metal} stroke={M.metalLo} strokeWidth="1.2" />
        <circle r="3.4" fill={M.brass} />
      </g></g>
      {p.chambers.map((c, i) => (
        <rect key={i} x={52 + c * 74} y={104} width={10 * screwChamberVolume(c) + 3} height={6} rx={3}
          fill={M.flow} opacity={(0.22 + 0.5 * screwChamberVolume(c)).toFixed(2)} />
      ))}
      <path d="M48 100 H136" stroke={M.flow} strokeWidth="2" fill="none" style={dash(p.flow, 88)} opacity=".8" />
    </Cutaway>
    <rect x={150} y={94} width={26} height={12} rx={3} fill={M.metalLo} />
    <path d="M176 100 H196" stroke={M.metalHi} strokeWidth="5" strokeLinecap="round" />
    <path d="M176 100 H196" stroke={M.flow} strokeWidth="2" style={dash(p.flow, 20)} opacity=".9" />
  </>
}

function PistonRig({ p, uid }: { p: PistonPose; uid: string }) {
  const y = 66 + p.pistonTravel * 26
  const rad = (p.crankDeg * Math.PI) / 180
  const pin = { x: 110 + 9 * Math.sin(rad), y: 112 - 9 * Math.cos(rad) }
  return <>
    <Shell uid={uid} x={30} y={40} w={120} h={86} teal={false} />
    <Cutaway uid={uid} x={76} y={50} w={68} h={76}>
      <path d="M88 56 V96 Q88 102 94 102 H126 Q132 102 132 96 V56" fill="none" stroke={M.metalHi} strokeWidth="2.4" />
      <rect x={90} y={y.toFixed(1)} width={40} height={12} rx={3} fill={M.metalHi} stroke={M.metalLo} />
      {p.compression ? <rect x={90} y={(y - 8).toFixed(1)} width={40} height={8} fill={M.flow} opacity=".3" /> : null}
      <g opacity={(0.35 + 0.65 * p.intakeLift).toFixed(2)}>
        <circle cx={98} cy={54} r={3 + p.intakeLift * 2} fill={M.flow} />
      </g>
      <g opacity={(0.35 + 0.65 * p.exhaustLift).toFixed(2)}>
        <circle cx={122} cy={54} r={3 + p.exhaustLift * 2} fill={M.brass} />
      </g>
      <path d={`M110 ${(y + 12).toFixed(1)} L${pin.x.toFixed(1)} ${pin.y.toFixed(1)}`} stroke={M.metalHi} strokeWidth="3.4" strokeLinecap="round" />
      <g transform={`translate(110 112)`}>
        <circle r="13" fill={M.metalLo} stroke={M.metalHi} strokeWidth="1.6" />
        <g transform={`rotate(${p.crankDeg.toFixed(1)})`}>
          <path d="M0 0 V-9" stroke={M.metalHi} strokeWidth="3" />
          <circle cy="-9" r="3" fill={M.brass} />
          <circle cy="5" r="4" fill={M.metal} />
        </g>
      </g>
    </Cutaway>
    <rect x={150} y={70} width={30} height={18} rx={4} fill={M.metal} stroke={M.metalLo} />
    <path d="M180 79 H198" stroke={M.flow} strokeWidth="2" style={dash(p.exhaustLift, 18)} opacity=".85" />
  </>
}

function CentrifugalRig({ p, uid }: { p: CentrifugalPose; uid: string }) {
  return <>
    <Shell uid={uid} x={20} y={52} w={180} h={76} teal={false} />
    <Cutaway uid={uid} x={52} y={44} w={84} h={84}>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <path key={a} transform={`translate(94 86) rotate(${a})`} d="M0 -30 Q6 -34 4 -40" stroke={M.metalHi} strokeWidth="2.4" fill="none" />
      ))}
      <g transform="translate(94 86)"><g transform={`rotate(${p.impellerDeg.toFixed(1)})`}>
        {[0, 51.4, 102.9, 154.3, 205.7, 257.1, 308.6].map((a) => (
          <path key={a} transform={`rotate(${a})`} d="M0 -6 Q12 -14 18 -26" stroke={M.tealHi} strokeWidth="3.4" fill="none" strokeLinecap="round" />
        ))}
        <circle r="7" fill={M.metalHi} stroke={M.metalLo} strokeWidth="1.4" />
        <circle r="2.6" fill={M.brass} />
      </g></g>
      <path d="M94 46 V38 M134 86 H142" stroke={M.flow} strokeWidth="2.4" fill="none" style={dash(p.diffuserFlow, 16)} />
    </Cutaway>
    <rect x={146} y={64} width={40} height={44} rx={6} fill={M.teal} stroke={M.metalLo} />
    <path d="M150 70 H182 M150 78 H182 M150 86 H182" stroke="rgba(0,0,0,.3)" strokeWidth="1.4" />
    <path d="M136 86 Q150 96 142 108" stroke={M.flow} strokeWidth="2.2" fill="none" style={dash(p.voluteFlow, 30)} opacity=".85" />
  </>
}

function TankRig({ p, uid }: { p: TankPose; uid: string }) {
  const dots = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (i / 6) * Math.PI * 2 + p.jitter * Math.PI * 2
    return { x: 110 + Math.cos(a) * (10 + (i % 3) * 6), y: 84 + Math.sin(a * 1.3) * (14 + (i % 2) * 8) }
  })
  return <>
    <rect x={86} y={34} width={48} height={100} rx={22} fill={`url(#mt-${uid})`} stroke={M.metalLo} strokeWidth="1.6" />
    <rect x={92} y={40} width={36} height={14} rx={7} fill={`url(#gl-${uid})`} />
    <Cutaway uid={uid} x={94} y={58} w={32} h={62}>
      {dots.map((d, i) => <circle key={i} cx={d.x.toFixed(1)} cy={d.y.toFixed(1)} r="2.2" fill={M.flow} opacity=".7" />)}
      <path d="M96 70 H124 M96 108 H124" stroke="rgba(255,255,255,.08)" strokeWidth="4" />
    </Cutaway>
    <g transform="translate(110 30)">
      <path d="M-11 0 A11 11 0 0 1 11 0" fill={M.dark2} stroke={M.metalHi} strokeWidth="2" />
      <path d="M-11 0 h3 M8 0 h3 M0 -11 v3" stroke={M.metalHi} strokeWidth="1.4" />
      <path d="M0 0 L0 -9" stroke={M.brass} strokeWidth="2" transform={`rotate(${p.needleDeg.toFixed(1)})`} />
      <circle r="2" fill={M.metalHi} />
    </g>
    <path d="M86 78 H70 M134 78 H150" stroke={M.metalHi} strokeWidth="5" strokeLinecap="round" />
    <path d="M86 78 H70" stroke={M.flow} strokeWidth="2" style={dash(p.jitter, 16)} />
    <g opacity={(0.3 + 0.7 * p.drainOpen).toFixed(2)}>
      <path d="M110 134 v8" stroke={M.metalHi} strokeWidth="3" />
      <circle cx={110} cy={146} r={2 + p.drainOpen * 2.4} fill={M.flow} />
    </g>
  </>
}

function DryerRig({ p, uid }: { p: DryerPose; uid: string }) {
  return <>
    <Shell uid={uid} x={24} y={44} w={172} h={86} />
    <Cutaway uid={uid} x={40} y={56} w={140} h={62}>
      <path d="M46 74 H84 Q94 74 94 84 V96 Q94 106 104 106 H174" stroke={M.flow} strokeWidth="2.6" fill="none" style={dash(p.airFlow, 128)} />
      <path d="M174 66 H128 Q120 66 120 74" stroke={M.tealHi} strokeWidth="2.2" fill="none" style={dash(p.coldOut, 54)} />
      <path d="M52 108 H150 Q160 108 160 98 V84 Q160 76 150 76 H66 Q56 76 56 86 V98 Q56 108 66 108 Z"
        stroke={M.brass} strokeWidth="1.8" fill="none" style={dash(p.refrigFlow, 216)} opacity=".9" />
      <circle cx={52} cy={92} r="4" fill={M.metalHi} />
      <g transform="translate(146 92)">
        <path d="M-7 -10 V10 Q-7 15 0 15 Q7 15 7 10 V-10" fill="none" stroke={M.metalHi} strokeWidth="2" />
        <rect x="-5" y={(15 - p.droplet * 20).toFixed(1)} width="10" height={(p.droplet * 20).toFixed(1)} rx="3" fill={M.flow} opacity=".65" />
      </g>
      <g opacity={(0.3 + 0.7 * p.drainOpen).toFixed(2)}>
        <path d="M146 110 v6" stroke={M.metalHi} strokeWidth="2.4" />
        <circle cx={146} cy={119} r={1.4 + p.drainOpen * 2} fill={M.flow} />
      </g>
    </Cutaway>
    <rect x={52} y={50} width={26} height={6} rx={3} fill={M.metalLo} />
  </>
}

function AdsorberRig({ p, uid }: { p: AdsorberPose; uid: string }) {
  const eq = p.stage.startsWith('equalize')
  const tower = (dx: number, cls: string, adsorbing: boolean) => (
    <g transform={`translate(${dx} 0)`}>
      <rect x="-16" y="-34" width="32" height="72" rx="10" fill={`url(#mt-${uid})`} stroke={M.metalLo} strokeWidth="1.4" />
      <Cutaway uid={uid} clipKey={`${uid}-${cls}`} x={-11} y={-28} w={22} h={60}>
        <rect className={cls} x="-9" y="-26" width="18" height="56" rx="6" fill={adsorbing ? M.tealHi : M.teal} opacity={adsorbing ? 0.85 : 0.35} />
        <path d={adsorbing ? 'M0 -26 V30' : 'M0 30 V-26'} stroke={M.flow} strokeWidth="2.2" fill="none"
          style={dash(eq ? 0.15 : p.flow, 56)} opacity={eq ? 0.35 : 0.95} />
      </Cutaway>
      <rect x="-16" y="-40" width="32" height="7" rx="3" fill={M.metalLo} />
    </g>
  )
  return <>
    <rect x={40} y={118} width={140} height={10} rx={4} fill={M.metalLo} />
    {tower(80, 'rig-bed-a', p.adsorb === 'A')}
    {tower(140, 'rig-bed-b', p.adsorb === 'B')}
    <path d="M80 76 H140" stroke={M.metalHi} strokeWidth="5" strokeLinecap="round" />
    <path d="M80 76 Q110 62 140 76" stroke={M.flow} strokeWidth="2.2" fill="none" style={dash(p.inStage, 64)} opacity={eq ? 1 : 0} />
    <path d="M110 76 V60 H186" stroke={M.flow} strokeWidth="2.4" fill="none" style={dash(p.dryOut, 92)} opacity=".9" />
    <text x="110" y="146" textAnchor="middle" fontSize="11" fill={M.flow} fontFamily="var(--mono, monospace)">{ADS_STAGE_LABEL[p.stage]}</text>
  </>
}

function FilterRig({ p, uid }: { p: FilterPose; uid: string }) {
  return <>
    <rect x={64} y={40} width={92} height={70} rx={12} fill={`url(#mt-${uid})`} stroke={M.metalLo} strokeWidth="1.5" />
    <Cutaway uid={uid} x={74} y={50} w={72} h={50}>
      <path d="M96 56 L102 94 L108 56 L114 94 L120 56 L126 94 L132 56" stroke={M.metalHi} strokeWidth="2.2" fill="none" />
      {[0, 1, 2, 3, 4].map((i) => (
        <circle key={i} cx={(86 - (i % 2) * 4).toFixed(1)} cy={(60 + i * 8).toFixed(1)} r="2.4"
          fill={M.brass} opacity={Math.min(1, Math.max(0, p.trapped * 1.4 - i * 0.22)).toFixed(2)} />
      ))}
      <path d="M76 75 H94" stroke={M.flow} strokeWidth="2.4" style={dash(p.flow, 18)} opacity=".55" />
      <path d="M134 75 H146" stroke={M.flow} strokeWidth="2.4" style={dash(p.clean, 12)} opacity=".95" />
    </Cutaway>
    <g transform="translate(110 34)">
      <path d="M-10 0 A10 10 0 0 1 10 0" fill={M.dark2} stroke={M.metalHi} strokeWidth="2" />
      <path d="M0 0 L0 -8" stroke={M.brass} strokeWidth="2" transform={`rotate(${(-50 + p.dp * 100).toFixed(1)})`} />
      <circle r="1.8" fill={M.metalHi} />
    </g>
    <path d="M40 75 H64 M156 75 H182" stroke={M.metalHi} strokeWidth="6" strokeLinecap="round" />
    <path d="M40 75 H64" stroke={M.flow} strokeWidth="2.2" style={dash(p.flow, 24)} opacity=".8" />
  </>
}

function ValveRig({ p, uid }: { p: ValvePose; uid: string }) {
  return <>
    <path d="M28 84 H192" stroke={M.metal} strokeWidth="16" strokeLinecap="round" />
    <path d="M28 84 H192" stroke={M.metalLo} strokeWidth="18" strokeLinecap="round" opacity=".35" />
    <Cutaway uid={uid} x={84} y={58} w={52} h={52}>
      <g transform="translate(110 84)">
        <g transform={`rotate(${(p.ballDeg - 45).toFixed(1)})`}>
          <circle r="18" fill={M.metalHi} stroke={M.metalLo} strokeWidth="1.6" />
          <rect x="-18" y="-5.5" width="36" height="11" rx="5" fill={M.dark} />
          <rect x="-18" y="-5.5" width="36" height="11" rx="5" fill={M.flow} opacity={(0.15 + 0.5 * p.opening).toFixed(2)} />
        </g>
      </g>
      <path d="M88 96 H132" stroke={M.flow} strokeWidth="2.4" style={dash(p.flow, 44)} opacity={(0.25 + 0.75 * p.opening).toFixed(2)} />
    </Cutaway>
    <path d="M110 58 V44" stroke={M.metalHi} strokeWidth="4" />
    <rect x={98} y={32} width={24} height={12} rx={4} fill={M.teal} stroke={M.metalLo} />
    <path d="M110 84 V116 H168" stroke={M.metal} strokeWidth="10" strokeLinecap="round" fill="none" />
    <path d="M110 84 V116 H168" stroke={M.flow} strokeWidth="2.2" style={dash(p.flow, 74)} opacity={(p.branch * 0.9).toFixed(2)} fill="none" />
    <text x="110" y="26" textAnchor="middle" fontSize="11" fill={M.flow} fontFamily="var(--mono, monospace)">{`开度 ${(p.opening * 100).toFixed(0)}%`}</text>
  </>
}

export function MachineRig({ typeId, phase, uid }: { typeId: string; phase: number; uid: string }) {
  const pose = poseFor(typeId, phase)
  let body: ReactNode = null
  switch (pose.type) {
    case 'screw': body = <ScrewRig p={pose.v} uid={uid} />; break
    case 'piston': body = <PistonRig p={pose.v} uid={uid} />; break
    case 'centrifugal': body = <CentrifugalRig p={pose.v} uid={uid} />; break
    case 'tank': body = <TankRig p={pose.v} uid={uid} />; break
    case 'dryer': body = <DryerRig p={pose.v} uid={uid} />; break
    case 'adsorber': body = <AdsorberRig p={pose.v} uid={uid} />; break
    case 'filter': body = <FilterRig p={pose.v} uid={uid} />; break
    case 'valve': body = <ValveRig p={pose.v} uid={uid} />; break
  }
  return (
    <svg className="qh-machine-rig" viewBox="0 0 220 160" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <Defs uid={uid} />
      <ellipse cx="110" cy="146" rx="86" ry="8" fill="rgba(0,0,0,.35)" />
      {body}
    </svg>
  )
}
