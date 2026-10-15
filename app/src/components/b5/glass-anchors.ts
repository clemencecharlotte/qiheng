/**
 * B5 · 连续玻璃纯参数层（glass-anchors.ts）
 * ═══════════════════════════════════════════════════════════════════
 * 本文件是 B5 r01 的**首要交付原件**：零 React、零 DOM、纯函数——
 * 可独立 hash 转交（完整 sha256 见 MANIFEST-B5.txt），供主/旧直接消费。
 *
 * 合同（协调 B5 r01）：
 *   - 唯一 g ∈ [0,1]；界面 0–100%、step 0.01；六材质锚点仅作插值锚点，
 *     **不吸附**（滑动经过锚点无档位跳变/停留）；
 *   - x = 5g；i = min(4, floor(x))；t = x - i；g = 1 取末端（t = 1）；
 *   - blur / fill 透明度 / 边线 / 高光 / 阴影 **独立曲线**；
 *   - **表面角色**：hero / button / overlay / card / data 五种，各自响应系数；
 *   - 密集数据（data）保持实底可读下限；无 backdrop-filter 提填充防穿字；
 *   - 统一合同：environmentPosition[0,5] / appearanceMode / followLocalTime 与
 *     glassIntensity[0,1] 彼此独立（本文件只管 glassIntensity 维度）。
 *
 * 锚点来源声明：六档数值**沿用已实收的 B3 六级分层品质锚点**
 * （b3-r5-material-20261009/src/components/b3/glassTokens.ts 的
 *  blur 0/4/8/14/20/28、fill .96/.88/.74/.58/.42/.30、edge、gloss、shadow）——
 *  **非本片新造 palette**；六环境配色锚点沿用 B4 scene.ts fixture（正式源未到，
 *  到位后同源替换，接口见 SCENE_SOURCE 注记）。
 * ═══════════════════════════════════════════════════════════════════ */

/** ── 原锚点数值（原样保留 B3 六级；作为 g∈[0,1] 的六个插值锚点） ── */
export interface GlassAnchor {
  /** 锚点名（材质标签用；**不吸附**——连续滑过时仅作插值参考） */
  name: string
  blur: number
  fillAlpha: number
  edge: number
  gloss: number
  shadow: number
}

export const GLASS_ANCHORS: GlassAnchor[] = [
  { name: '关闭', blur: 0, fillAlpha: 0.96, edge: 0.05, gloss: 0, shadow: 0 },
  { name: '极轻', blur: 4, fillAlpha: 0.88, edge: 0.08, gloss: 0, shadow: 0 },
  { name: '轻', blur: 8, fillAlpha: 0.74, edge: 0.12, gloss: 0.04, shadow: 1 },
  { name: '中', blur: 14, fillAlpha: 0.58, edge: 0.16, gloss: 0.09, shadow: 1 },
  { name: '强', blur: 20, fillAlpha: 0.42, edge: 0.2, gloss: 0.14, shadow: 2 },
  { name: '极强', blur: 28, fillAlpha: 0.3, edge: 0.26, gloss: 0.2, shadow: 2 },
]

/** ── normalize：夹取到 [0,1]（界面 0–100 ↔ g 的唯一入口） ── */
export function normalize(g: number): number {
  if (Number.isNaN(g)) return 0
  return Math.max(0, Math.min(1, g))
}

/** x = 5g（六锚点均匀铺满 [0,5]）；i = min(4, floor(x))；t = x - i；g=1 → t=1 */
export function segment(g: number): { x: number; i: number; t: number; lo: GlassAnchor; hi: GlassAnchor } {
  const gn = normalize(g)
  const x = 5 * gn
  const i = Math.min(4, Math.floor(x))
  const t = gn === 1 ? 1 : x - i          // g=1 时 x=5、floor=5→i=4、t=1（末端取 hi 锚点）
  return { x, i, t, lo: GLASS_ANCHORS[i], hi: GLASS_ANCHORS[i + 1] }
}

/* ── 独立曲线（每通道一个，可解释、可单独替换） ─────────────────────
   linear : 匀速（默认）
   easeIn : 暗部平缓、高段增强（gloss——高级感集中在高段）
   easeOut: 低段变化快（fill——低 g 就快速脱离实底，可读性尽早稳定）
*/
export type CurveName = 'linear' | 'easeIn' | 'easeOut'
export const CURVES: Record<CurveName, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
}

/** ── 五表面角色：各通道响应系数（同一 g，不同表面呈现不同强度） ── */
export type SurfaceRole = 'hero' | 'button' | 'overlay' | 'card' | 'data'

export interface RoleProfile {
  /** 各通道系数（乘在插值结果上；data 有实底下限逻辑） */
  blurK: number
  fillK: number
  edgeK: number
  glossK: number
  /** data 角色实底下限：fill ≥ 此值、blur ≤ 此值 */
  dataFloorFill?: number
  dataFloorBlur?: number
}

export const SURFACE_ROLES: Record<SurfaceRole, RoleProfile> = {
  hero:    { blurK: 1.0,  fillK: 0.9,  edgeK: 1.0,  glossK: 1.0 },   // 大面板：通透
  button:  { blurK: 0.7,  fillK: 1.1,  edgeK: 1.0,  glossK: 0.9 },   // 小件：偏实
  overlay: { blurK: 1.15, fillK: 0.85, edgeK: 1.1,  glossK: 1.1 },   // 浮层：最透、边缘最强
  card:    { blurK: 1.0,  fillK: 1.0,  edgeK: 1.0,  glossK: 1.0 },   // 基准
  data:    { blurK: 0.29, fillK: 1.0,  edgeK: 0.8,  glossK: 0,       // 密集数据：实底下限
             dataFloorFill: 0.92, dataFloorBlur: 4 },
}

/** ── 采样输出（每通道独立插值结果 + 使用提示） ── */
export interface GlassSample {
  g: number
  /** 插值段信息（x/i/t + 两邻锚点名——**仅标签，不吸附**） */
  x: number
  i: number
  t: number
  loName: string
  hiName: string
  /** 各通道最终值（已乘表面角色系数、已夹取合法域） */
  blur: number
  fillAlpha: number
  edge: number
  gloss: number
  shadow: number
  /** data 角色实底下限是否生效 */
  floorApplied: boolean
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const clampBlur = (v: number) => Math.max(0, Math.min(32, v))

/**
 * sampleGlass —— 唯一采样入口（纯函数）。
 * g ∈ [0,1]（内部 normalize）；role 默认 card。
 * 独立曲线：blur/edge/shadow=linear；fill=easeOut（低段快脱实底）；
 *           gloss=easeIn（高段增强）。
 */
export function sampleGlass(g: number, role: SurfaceRole = 'card'): GlassSample {
  const { x, i, t, lo, hi } = segment(g)
  const prof = SURFACE_ROLES[role]
  const fillFloor = prof.dataFloorFill ?? 0
  const blurFloor = prof.dataFloorBlur ?? 0

  let blur = (lo.blur + (hi.blur - lo.blur) * CURVES.linear(t)) * prof.blurK
  let fillAlpha = (lo.fillAlpha + (hi.fillAlpha - lo.fillAlpha) * CURVES.easeOut(t)) * prof.fillK
  let edge = (lo.edge + (hi.edge - lo.edge) * CURVES.linear(t)) * prof.edgeK
  let gloss = (lo.gloss + (hi.gloss - lo.gloss) * CURVES.easeIn(t)) * prof.glossK
  // M16 r02 消费副本：仅取消 shadow 取整（连续 number）；锚点仍 0/1/2，曲线不变。
  const shadow = lo.shadow + (hi.shadow - lo.shadow) * CURVES.linear(t)

  blur = clampBlur(blur)
  edge = clamp01(edge)
  gloss = clamp01(gloss)

  let floorApplied = false
  if (prof.dataFloorFill !== undefined && fillAlpha < fillFloor) {
    fillAlpha = fillFloor
    floorApplied = true
  }
  if (prof.dataFloorBlur !== undefined && blur > blurFloor) {
    blur = blurFloor
    floorApplied = true
  }
  fillAlpha = clamp01(fillAlpha)

  return {
    g: normalize(g), x: Math.round(x * 1000) / 1000, i, t: Math.round(t * 1000) / 1000,
    loName: lo.name, hiName: hi.name,
    blur: Math.round(blur * 100) / 100,
    fillAlpha: Math.round(fillAlpha * 1000) / 1000,
    edge: Math.round(edge * 1000) / 1000,
    gloss: Math.round(gloss * 1000) / 1000,
    shadow: Math.round(shadow * 1000) / 1000,
    floorApplied,
  }
}

/**
 * CSS 写出（消费侧便捷函数；作用域由调用方元素限定）。
 * data 角色：fill 用实底近似（alpha≥.92 时视觉即近实底），blur 交 @supports 兜底。
 */
export function applyGlassSample(el: HTMLElement, s: GlassSample): void {
  el.style.setProperty('--cg-blur', `${s.blur}px`)
  el.style.setProperty('--cg-sat', '140%')
  el.style.setProperty('--cg-fill-a', String(s.fillAlpha))
  el.style.setProperty('--cg-edge', String(s.edge))
  el.style.setProperty('--cg-gloss', String(s.gloss))
  el.style.setProperty('--cg-shadow', String(s.shadow))
}

/* ── 场景独立性声明 ──
   environmentPosition[0,5]（六环境）/ appearanceMode（light/dark/system）/
   followLocalTime / glassIntensity[0,1] 四维**彼此独立**：
   本文件只消费 glassIntensity；六环境锚点（SCENE_ANCHORS 于 scene.ts fixture）与
   本文件 GLASS_ANCHORS 无任何耦合——场景滑动不重置/不改写 g（由宿主保证）。 */

/* ── SCENE_SOURCE 状态 ──
   六环境正式源（旧设计最新正式件）**尚未提供**——当前场景层使用 fixtures/scene-fixture.ts
   （B4 fixture 原样，标记 'fixture'）。正式件到位后：替换该文件、置 'official'，
   消费接口（sampleScene(position)）不变。本片**不再自造正式六环境**。 */
export const SCENE_SOURCE: 'fixture' | 'official' = 'fixture'
