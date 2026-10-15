/**
 * r41 · 八类设备机构运动学单一事实源（纯函数，无 React/无副作用）。
 * 运行时渲染、SSR 证据快照、reduce 静态关键相位、单元测试全部消费同一组函数，
 * 因此暂停=冻结 t、seek=确定 t、恢复=续 t，终态由 t 唯一决定。
 *
 * 原理依据（资料，非代理指令）：Atlas Copco compressed-air wiki（螺杆互啮反转/
 * 离心叶轮+扩压/活塞曲柄连杆与阀相位/储气罐压力缓冲/吸附双塔切换均压/冷干凝露排凝）、
 * Festo 气源处理资料（过滤截留与压差、阀开度-流量）。教学慢速相位，不伪装真实 rpm/测量：
 * 缺真值的量一律示意（本模块只输出几何相位，不输出工业数值）。
 */
export const MECH_PERIOD = {
  piston: 2.4,        // 曲柄一转（教学慢速，注明非真实 rpm）
  screw: 3.6,         // 转子一个啮合循环
  centrifugal: 2.8,   // 叶轮视觉一转
  tank: 8,            // 压力缓冲波动一周期
  dryer: 12,          // 冷媒回路+排凝一周期
  adsorber: 24,       // 双塔吸附/均压/再生完整切换循环
  filter: 30,         // 滤芯累计加载一周期（示意）
  valve: 10,          // 阀开度调制一周期
} as const

export type MechTypeId = keyof typeof MECH_PERIOD

const TAU = Math.PI * 2
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const frac = (v: number) => v - Math.floor(v)

/* ---- 活塞：曲柄滑块精确解 + 进/排气阀相位 ---- */
export interface PistonPose {
  crankDeg: number; pistonTravel: number; rodDeg: number
  intakeLift: number; exhaustLift: number; compression: boolean
}
export const PISTON_ROD_RATIO = 3.2 // 连杆/曲柄半径比（教学取值）
export function pistonPose(t: number): PistonPose {
  const P = MECH_PERIOD.piston
  const th = frac(t / P) * TAU
  const r = 1, l = PISTON_ROD_RATIO
  const s = Math.sin(th), c = Math.cos(th)
  const x = r * c + Math.sqrt(l * l - r * r * s * s)      // 曲柄中心→活塞销距离
  const pistonTravel = (r + l - x) / (2 * r)              // 0=TDC … 1=BDC
  const rodDeg = (Math.asin((r * s) / l) * 180) / Math.PI // 连杆摆角
  const intakeLift = th < Math.PI ? Math.sin(th) : 0      // 吸气冲程开
  const exStart = Math.PI + 0.6                           // 缸内压建立后排气阀开
  const exhaustLift = th > exStart ? Math.sin((Math.PI * (th - exStart)) / (TAU - exStart)) : 0
  return {
    crankDeg: (th * 180) / Math.PI, pistonTravel, rodDeg,
    intakeLift, exhaustLift, compression: intakeLift === 0 && exhaustLift === 0,
  }
}

/* ---- 螺杆：互啮反转 + 封闭容积沿轴向缩小 ---- */
export interface ScrewPose { angleDeg: number; femaleDeg: number; chambers: number[]; flow: number }
export function screwPose(t: number): ScrewPose {
  const P = MECH_PERIOD.screw
  const angleDeg = frac(t / P) * 360
  return {
    angleDeg,
    femaleDeg: -angleDeg * (4 / 6),                    // 4:6 齿数比反向
    chambers: [0, 1, 2].map((i) => frac(t / P + i / 3)), // 腔体入口→出口行程
    flow: frac(t / P * 2),
  }
}
/** 腔体容积随行程缩小（压缩语义）：1 → 0.25 */
export const screwChamberVolume = (pos: number) => 1 - 0.75 * pos

/* ---- 离心：叶轮旋转 + 径向扩压 + 蜗壳出气（机身/管线不转） ---- */
export interface CentrifugalPose { impellerDeg: number; diffuserFlow: number; voluteFlow: number }
export function centrifugalPose(t: number): CentrifugalPose {
  const P = MECH_PERIOD.centrifugal
  return { impellerDeg: frac(t / P) * 360, diffuserFlow: frac(t / P * 2), voluteFlow: frac(t / P * 2 + 0.45) }
}

/* ---- 储气罐：压力缓冲（表针+粒子），不是液位；排凝独立底部过程 ---- */
export interface TankPose { needleDeg: number; pressure: number; jitter: number; drainOpen: number }
export const TANK_DRAIN_PERIOD = 19
export function tankPose(t: number): TankPose {
  const P = MECH_PERIOD.tank
  const pressure = 0.62 + 0.16 * Math.sin((TAU * t) / P) + 0.05 * Math.sin((4 * Math.PI * t) / P + 1.1)
  const td = t % TANK_DRAIN_PERIOD
  return {
    pressure, needleDeg: -50 + 100 * pressure, jitter: frac(t * 1.7),
    drainOpen: td < 1.4 ? Math.sin((Math.PI * td) / 1.4) : 0,
  }
}

/* ---- 冷干：换热气路 + 冷媒回路 + 凝露分离 + 间歇排凝 ---- */
export interface DryerPose { airFlow: number; refrigFlow: number; coldOut: number; droplet: number; drainOpen: number }
export function dryerPose(t: number): DryerPose {
  const P = MECH_PERIOD.dryer
  const dc = frac(t / P)
  const droplet = dc < 0.82 ? dc / 0.82 : 1 - (dc - 0.82) / 0.18
  return {
    airFlow: frac(t / P * 1.5), refrigFlow: frac(t / P * 3), coldOut: frac(t / P * 1.5 + 0.4),
    droplet, drainOpen: dc >= 0.82 ? Math.sin((Math.PI * (dc - 0.82)) / 0.18) : 0,
  }
}

/* ---- 双塔：吸附/再生/均压阶段机；干燥出口持续 ---- */
export type AdsStage = 'A-adsorb' | 'equalize-ab' | 'B-adsorb' | 'equalize-ba'
export interface AdsorberPose { stage: AdsStage; adsorb: 'A' | 'B'; inStage: number; flow: number; dryOut: number }
export function adsorberPose(t: number): AdsorberPose {
  const c = frac(t / MECH_PERIOD.adsorber)
  if (c < 0.42) return { stage: 'A-adsorb', adsorb: 'A', inStage: c / 0.42, flow: frac(t * 0.9), dryOut: frac(t * 1.1) }
  if (c < 0.5) return { stage: 'equalize-ab', adsorb: 'A', inStage: (c - 0.42) / 0.08, flow: frac(t * 0.9), dryOut: frac(t * 1.1) }
  if (c < 0.92) return { stage: 'B-adsorb', adsorb: 'B', inStage: (c - 0.5) / 0.42, flow: frac(t * 0.9), dryOut: frac(t * 1.1) }
  return { stage: 'equalize-ba', adsorb: 'B', inStage: (c - 0.92) / 0.08, flow: frac(t * 0.9), dryOut: frac(t * 1.1) }
}
export const ADS_STAGE_LABEL: Record<AdsStage, string> = {
  'A-adsorb': 'A 塔吸附 · B 塔再生', 'equalize-ab': '均压（A→B）', 'B-adsorb': 'B 塔吸附 · A 塔再生', 'equalize-ba': '均压（B→A）',
}

/* ---- 过滤：穿过滤芯 + 上游截留 + 压差上升 + 干净出口 ---- */
export interface FilterPose { load: number; dp: number; flow: number; trapped: number; clean: number }
export function filterPose(t: number): FilterPose {
  const load = frac(t / MECH_PERIOD.filter)
  const rate = 1 - 0.35 * load
  return { load, dp: 0.18 + 0.62 * load, flow: frac(t * 0.8 * rate), trapped: load, clean: frac(t * 0.9 * rate + 0.3) }
}

/* ---- 阀门：球阀阀芯开度 → 示意流量与支路 ---- */
export interface ValvePose { opening: number; ballDeg: number; flow: number; branch: number }
export function valvePose(t: number): ValvePose {
  const opening = clamp(0.5 + 0.42 * Math.sin((TAU * t) / MECH_PERIOD.valve), 0.06, 0.96)
  return { opening, ballDeg: opening * 90, flow: frac(t * (0.3 + opening * 1.4)), branch: opening }
}

export type MechPose =
  | { type: 'piston'; v: PistonPose } | { type: 'screw'; v: ScrewPose } | { type: 'centrifugal'; v: CentrifugalPose }
  | { type: 'tank'; v: TankPose } | { type: 'dryer'; v: DryerPose } | { type: 'adsorber'; v: AdsorberPose }
  | { type: 'filter'; v: FilterPose } | { type: 'valve'; v: ValvePose }

export function poseFor(typeId: string, t: number): MechPose {
  switch (typeId) {
    case 'piston': return { type: 'piston', v: pistonPose(t) }
    case 'screw': return { type: 'screw', v: screwPose(t) }
    case 'centrifugal': return { type: 'centrifugal', v: centrifugalPose(t) }
    case 'tank': return { type: 'tank', v: tankPose(t) }
    case 'dryer': return { type: 'dryer', v: dryerPose(t) }
    case 'adsorber': return { type: 'adsorber', v: adsorberPose(t) }
    case 'filter': return { type: 'filter', v: filterPose(t) }
    case 'valve': return { type: 'valve', v: valvePose(t) }
    default: return { type: 'screw', v: screwPose(t) }
  }
}

/** reduce / 待机静态关键相位：每类一个"信息量最大"的静止时刻（阀半开、塔在吸附中段等）。 */
export const INFORMATIVE_PHASE: Record<string, number> = {
  piston: MECH_PERIOD.piston * 0.25,   // 吸气冲程中段：进气阀开、活塞下行
  screw: MECH_PERIOD.screw * 0.5,
  centrifugal: MECH_PERIOD.centrifugal * 0.25,
  tank: MECH_PERIOD.tank * 0.25,       // 表针偏高点
  dryer: MECH_PERIOD.dryer * 0.5,
  adsorber: MECH_PERIOD.adsorber * 0.2,// A 塔吸附中段
  filter: MECH_PERIOD.filter * 0.45,   // 加载中段：压差可见
  valve: MECH_PERIOD.valve * 0.25,     // 开度峰值
}

/** seek 语义：宿主回放第 index 桶 → 机构相位秒（确定性终态）。 */
export const SECONDS_PER_HOST_INDEX = 1.2
export const phaseForHostIndex = (index: number) => index * SECONDS_PER_HOST_INDEX
