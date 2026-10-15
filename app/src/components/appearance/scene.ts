/**
 * M12 r03 · 六环境连续配色（真实光线感）。
 * scenePosition:number[0,5] 连续；相邻档之间线性插值（无白闪/错色中间帧）。
 * 每个环境是一组「天空上/中/地平线下 + 环境光晕 + 主体高光 + 日轮」颜色；
 * 通过滑动在整块动态背景上连续过渡，模拟天光变化（非天气/现场状态）。
 * 阅读主题 light/dark 各取一套派生（浅色=向浅底 mix，深色=向深底 mix），
 * 正文始终在实底面板上，不被背景着色遮蔽。
 */
export interface ScenePalette {
  id: 'preDawn' | 'sunrise' | 'daytime' | 'dusk' | 'sunset' | 'night'
  name: string
  top: [number, number, number]
  mid: [number, number, number]
  bottom: [number, number, number]
  glow: [number, number, number]
  highlight: [number, number, number]
  sun: [number, number, number]
}

export const SCENES: ScenePalette[] = [
  { id: 'preDawn', name: '晨前',
    top: [10, 16, 38], mid: [24, 32, 64], bottom: [40, 48, 92],
    glow: [90, 110, 200], highlight: [150, 170, 230], sun: [150, 175, 235] },
  { id: 'sunrise', name: '晨启',
    top: [26, 20, 48], mid: [74, 45, 63], bottom: [122, 70, 54],
    glow: [255, 157, 107], highlight: [255, 208, 168], sun: [255, 186, 130] },
  { id: 'daytime', name: '日间',
    top: [14, 42, 74], mid: [27, 90, 134], bottom: [47, 134, 184],
    glow: [191, 227, 255], highlight: [255, 255, 255], sun: [255, 246, 220] },
  { id: 'dusk', name: '暮色',
    top: [36, 26, 61], mid: [90, 51, 88], bottom: [138, 74, 82],
    glow: [217, 139, 106], highlight: [255, 199, 161], sun: [255, 176, 126] },
  { id: 'sunset', name: '晚间',
    top: [42, 19, 48], mid: [110, 43, 69], bottom: [168, 67, 58],
    glow: [255, 122, 77], highlight: [255, 178, 122], sun: [255, 146, 96] },
  { id: 'night', name: '夜班',
    top: [5, 6, 15], mid: [11, 16, 32], bottom: [18, 26, 46],
    glow: [42, 74, 122], highlight: [127, 168, 216], sun: [180, 200, 230] },
]

export const SCENE_MIN = 0
export const SCENE_MAX = 5

function clampScene(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(SCENE_MAX, Math.max(SCENE_MIN, v))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
function lerpRGB(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))]
}
function mix(c: [number, number, number], target: [number, number, number], t: number): [number, number, number] {
  return lerpRGB(c, target, t)
}
export function rgb(c: [number, number, number]): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

/** 插值后的环境色（未按主题派生）。 */
export function interpolateScene(pos: number): {
  top: [number, number, number]; mid: [number, number, number]; bottom: [number, number, number]
  glow: [number, number, number]; highlight: [number, number, number]; sun: [number, number, number]
} {
  const p = clampScene(pos)
  const lo = Math.floor(p)
  const hi = Math.min(SCENE_MAX, lo + 1)
  const t = p - lo
  const A = SCENES[lo]
  const B = SCENES[hi]
  return {
    top: lerpRGB(A.top, B.top, t),
    mid: lerpRGB(A.mid, B.mid, t),
    bottom: lerpRGB(A.bottom, B.bottom, t),
    glow: lerpRGB(A.glow, B.glow, t),
    highlight: lerpRGB(A.highlight, B.highlight, t),
    sun: lerpRGB(A.sun, B.sun, t),
  }
}

const DARK_BASE: [number, number, number] = [5, 7, 12]
const LIGHT_BASE: [number, number, number] = [243, 246, 249]

/** 日轮高度：0 低（地平线）→ 1 高（正午）；端点=0（夜）。滑动连续。 */
export function sceneElevation(pos: number): number {
  return Math.max(0, Math.sin((Math.PI * clampScene(pos)) / SCENE_MAX))
}

/** 环境光晕强度：晨/暮更强（低角度散射），正午更弱，夜最弱。 */
export function sceneGlowAlpha(pos: number): number {
  const p = clampScene(pos)
  const elev = sceneElevation(p)
  const night = p >= 4.6
  const base = night ? 0.12 : 0.34 + (1 - elev) * 0.22
  return Math.min(0.62, base)
}

/** 供宿主写入 CSS 变量的完整派生（light / dark 两套）。 */
export function sceneVars(pos: number): Record<string, string> {
  const s = interpolateScene(pos)
  // 深色：向深底微收（保持深天光）；浅色：向浅底 mix（浅天光，深字可读）
  const dark = {
    top: mix(s.top, DARK_BASE, 0.12), mid: mix(s.mid, DARK_BASE, 0.1), bottom: mix(s.bottom, DARK_BASE, 0.06),
    glow: s.glow, hi: s.highlight, sun: s.sun,
  }
  const light = {
    top: mix(s.top, LIGHT_BASE, 0.72), mid: mix(s.mid, LIGHT_BASE, 0.66), bottom: mix(s.bottom, LIGHT_BASE, 0.6),
    glow: mix(s.glow, LIGHT_BASE, 0.5), hi: mix(s.highlight, LIGHT_BASE, 0.4), sun: mix(s.sun, LIGHT_BASE, 0.15),
  }
  const elev = sceneElevation(clampScene(pos))
  return {
    '--scene-top': rgb(dark.top), '--scene-mid': rgb(dark.mid), '--scene-bottom': rgb(dark.bottom),
    '--scene-glow': rgb(dark.glow), '--scene-hi': rgb(dark.hi), '--scene-sun': rgb(dark.sun),
    '--scene-top-l': rgb(light.top), '--scene-mid-l': rgb(light.mid), '--scene-bottom-l': rgb(light.bottom),
    '--scene-glow-l': rgb(light.glow), '--scene-hi-l': rgb(light.hi), '--scene-sun-l': rgb(light.sun),
    '--scene-glow-alpha': sceneGlowAlpha(pos).toFixed(3),
    '--scene-sun-y': `${Math.round(96 - elev * 82)}%`,
    '--scene-sun-opacity': (0.35 + elev * 0.55).toFixed(3),
  }
}

/** 真实时间 → 环境滑值（供「随现实时间变化」）。夜晚→晨前→晨启→日间→暮色→晚间→夜班连续。 */
export function scenePositionForDate(d: Date): number {
  const h = d.getHours() + d.getMinutes() / 60
  const anchors: Array<[number, number]> = [
    [0, 5], [5, 0], [7, 1], [12, 2], [17, 3], [20, 4], [24, 5],
  ]
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [h0, p0] = anchors[i]
    const [h1, p1] = anchors[i + 1]
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / Math.max(1e-6, h1 - h0)
      return p0 + (p1 - p0) * t
    }
  }
  return 2
}

/** 计算整块背景 CSS（内联，保证生效）：浅/深主题各一套，正文实底不受影响。 */
export function sceneBackground(pos: number, theme: 'light' | 'dark'): string {
  const s = interpolateScene(pos)
  const base = theme === 'light'
    ? { top: mix(s.top, LIGHT_BASE, 0.7), mid: mix(s.mid, LIGHT_BASE, 0.64), bottom: mix(s.bottom, LIGHT_BASE, 0.58), glow: mix(s.glow, LIGHT_BASE, 0.5), sun: mix(s.sun, LIGHT_BASE, 0.16) }
    : { top: mix(s.top, DARK_BASE, 0.12), mid: mix(s.mid, DARK_BASE, 0.1), bottom: mix(s.bottom, DARK_BASE, 0.06), glow: s.glow, sun: s.sun }
  const glowA = Math.round(sceneGlowAlpha(pos) * 100)
  const sunY = `${Math.round(96 - sceneElevation(pos) * 82)}%`
  return [
    `radial-gradient(130% 82% at 50% ${sunY}, color-mix(in srgb, ${rgb(base.glow)} ${glowA}%, transparent) 0%, transparent 58%)`,
    `radial-gradient(58% 40% at 50% ${sunY}, color-mix(in srgb, ${rgb(base.sun)} 34%, transparent) 0%, transparent 70%)`,
    `linear-gradient(180deg, ${rgb(base.top)} 0%, ${rgb(base.mid)} 46%, ${rgb(base.bottom)} 100%)`,
  ].join(', ')
}
