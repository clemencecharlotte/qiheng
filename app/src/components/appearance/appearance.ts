/**
 * M12 · 外观预置（环境六档 + 玻璃六档）纯逻辑。
 * scenePosition:number[0,5] 是外观滑动值（不从时钟推算）；glassLevel:integer[0,5]。
 * 与阅读主题（light/dark/system）分开；不 dispatch 工业动作、不发 fetch。
 * 引擎无可变调色接口：这里只产出可逆外层 ambient tint / 玻璃 token，不改 field-engine 公式。
 */

export interface SceneBucket {
  id: 'preDawn' | 'sunrise' | 'daytime' | 'dusk' | 'sunset' | 'night'
  name: string
  /** 环境底色（叠加 tint，低不透明度；亮/暗主题各自压暗）。 */
  tint: [number, number, number]
}

export const SCENES: SceneBucket[] = [
  { id: 'preDawn', name: '晨前', tint: [38, 54, 84] },
  { id: 'sunrise', name: '晨启', tint: [122, 86, 70] },
  { id: 'daytime', name: '日间', tint: [40, 74, 80] },
  { id: 'dusk', name: '暮色', tint: [98, 74, 94] },
  { id: 'sunset', name: '晚间', tint: [74, 58, 80] },
  { id: 'night', name: '夜班', tint: [18, 28, 46] },
]

export const SCENE_MIN = 0
export const SCENE_MAX = 5

export const GLASS_STEPS = ['关闭', '极轻', '轻', '中', '强', '极强'] as const
export const GLASS_MIN = 0
export const GLASS_MAX = 5

export function clampScene(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(SCENE_MAX, Math.max(SCENE_MIN, v))
}

export function clampGlass(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(GLASS_MAX, Math.max(GLASS_MIN, Math.round(v)))
}

/** 连续 scenePosition → 最近档（用于档名/可点刻度） */
export function nearestSceneIndex(pos: number): number {
  return Math.round(clampScene(pos))
}

export function sceneName(pos: number): string {
  return SCENES[nearestSceneIndex(pos)].name
}

/** 两邻档之间线性插值 tint（快拖反向接续，不排动画队列）。 */
export function interpolateSceneTint(pos: number): string {
  const p = clampScene(pos)
  const lo = Math.floor(p)
  const hi = Math.min(SCENE_MAX, lo + 1)
  const t = p - lo
  const a = SCENES[lo].tint
  const b = SCENES[hi].tint
  const r = Math.round(a[0] + (b[0] - a[0]) * t)
  const g = Math.round(a[1] + (b[1] - a[1]) * t)
  const bl = Math.round(a[2] + (b[2] - a[2]) * t)
  return `rgb(${r}, ${g}, ${bl})`
}

/** 环境叠加不透明度（关闭级仍有极弱基底，避免跳变）。 */
export function sceneOverlayAlpha(pos: number): number {
  return 0.06 + (clampScene(pos) / SCENE_MAX) * 0.1
}

/** 玻璃档 → blur/alpha token（0 档明确无 blur、实底可读）。 */
export function glassTokens(level: number): { blur: number; sat: number; alpha: number } {
  const l = clampGlass(level)
  const table = [
    { blur: 0, sat: 100, alpha: 100 },
    { blur: 4, sat: 108, alpha: 96 },
    { blur: 8, sat: 116, alpha: 92 },
    { blur: 12, sat: 128, alpha: 86 },
    { blur: 18, sat: 140, alpha: 80 },
    { blur: 26, sat: 155, alpha: 74 },
  ]
  return table[l]
}

export function glassName(level: number): string {
  return GLASS_STEPS[clampGlass(level)]
}

/** 外观持久偏好（welcome/console 一致；不含身份/工业状态）。 */
export interface AppearancePrefs {
  scenePosition: number
  glassLevel: number
  followRealTime: boolean
}

const APPEARANCE_KEY = 'qh.appearance.v1'
export const DEFAULT_APPEARANCE: AppearancePrefs = { scenePosition: 2, glassLevel: 2, followRealTime: false }

export function loadAppearancePrefs(): AppearancePrefs {
  try {
    const raw = window.localStorage.getItem(APPEARANCE_KEY)
    if (!raw) return { ...DEFAULT_APPEARANCE }
    const v = JSON.parse(raw) as Partial<AppearancePrefs>
    return {
      scenePosition: clampScene(typeof v.scenePosition === 'number' ? v.scenePosition : DEFAULT_APPEARANCE.scenePosition),
      glassLevel: clampGlass(typeof v.glassLevel === 'number' ? v.glassLevel : DEFAULT_APPEARANCE.glassLevel),
      followRealTime: v.followRealTime === true,
    }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

export function saveAppearancePrefs(p: AppearancePrefs): void {
  try {
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify({
      scenePosition: clampScene(p.scenePosition),
      glassLevel: clampGlass(p.glassLevel),
      followRealTime: p.followRealTime === true,
    }))
  } catch {
    /* 隐私模式等忽略 */
  }
}

/** M16 r01 · 连续玻璃材质：glassIntensity g∈[0,1] → 材质参数（六锚点线性插值，不硬档）。 */
export interface GlassMaterial {
  blur: number
  sat: number
  fillAlpha: number   // 卡片/面板基色（%）
  buttonAlpha: number // 次级按钮基色（%）
  edge: number        // 边缘光强度 0..1
  gloss: number       // 镜面带强度 0..1
  shadow: number      // 阴影强度 0..1
}
const GLASS_ANCHORS: Array<{ g: number } & GlassMaterial> = [
  // r44 B · 外层卡光学曲线（设计起始值，六环境实看可调）：0/25/50/75/100%
  { g: 0, blur: 0, sat: 100, fillAlpha: 100, buttonAlpha: 100, edge: 0.10, gloss: 0.06, shadow: 0.10 },
  { g: 0.25, blur: 6, sat: 110, fillAlpha: 90, buttonAlpha: 94, edge: 0.14, gloss: 0.10, shadow: 0.14 },
  { g: 0.5, blur: 12, sat: 125, fillAlpha: 76, buttonAlpha: 88, edge: 0.18, gloss: 0.12, shadow: 0.20 },
  { g: 0.75, blur: 20, sat: 140, fillAlpha: 64, buttonAlpha: 82, edge: 0.22, gloss: 0.14, shadow: 0.26 },
  { g: 1, blur: 26, sat: 155, fillAlpha: 54, buttonAlpha: 76, edge: 0.26, gloss: 0.16, shadow: 0.30 },
]
export function glassMaterialAt(gRaw: number): GlassMaterial {
  const g = Math.min(1, Math.max(0, Number.isFinite(gRaw) ? gRaw : 0))
  let i = 0
  while (i < GLASS_ANCHORS.length - 2 && g > GLASS_ANCHORS[i + 1].g) i += 1
  const a = GLASS_ANCHORS[i]
  const b = GLASS_ANCHORS[i + 1]
  const t = (g - a.g) / (b.g - a.g)
  const L = (x: number, y: number) => x + (y - x) * t
  return {
    blur: Math.round(L(a.blur, b.blur)),
    sat: Math.round(L(a.sat, b.sat)),
    fillAlpha: Math.round(L(a.fillAlpha, b.fillAlpha)),
    buttonAlpha: Math.round(L(a.buttonAlpha, b.buttonAlpha)),
    edge: Number(L(a.edge, b.edge).toFixed(3)),
    gloss: Number(L(a.gloss, b.gloss).toFixed(3)),
    shadow: Number(L(a.shadow, b.shadow).toFixed(3)),
  }
}
