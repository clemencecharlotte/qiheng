/**
 * D08-W1 r03 · 六环境「真实光线」色板 v2（Stripe 级饱和柔和 + 页面级动态背景）。
 *
 * 设计依据（协调本轮明确）：
 * - 颜色变化最终落实为**页面动态背景**（天空渐变 + 太阳/环境光斑 + 雾霭层），
 *   随 scenePosition 连续变化，像现实昼夜光线的移动；整体即交互测试位，
 *   无独立交互卡片。
 * - 光感优先：光斑大而柔（径向渐变自然衰减 + 页面 blur 层），色相按真实太阳
 *   轨迹走（晨前冷辉→晨启金橙→日间清朗→暮色紫红→晚间橙红余晖→夜班冷月），
 *   亮度/饱和度拉开昼夜差；stripe.com/en-de 的多层柔光叠加为参考（不复制资产）。
 * - 可读性合同：每环境自带 ink/inkMuted，按该环境天空实际亮度选择深/浅字，
 *   ink 对 skyTop/Mid/Horizon 三停对比全部 ≥4.5（scenePalette.test 断言）；
 *   浮卡内容用 --pm-surface 实底，正文永不被背景着色遮罩。
 * - 小数位置全字段插值（hex mix），chase 单驱动（r02 合同保留）。
 */

export interface SceneEnv {
  id: 'preDawn' | 'sunrise' | 'daytime' | 'dusk' | 'sunset' | 'night'
  name: string
  /** 天空三停垂直渐变（顶→中→地平线） */
  skyTop: string
  skyMid: string
  skyHorizon: string
  /** 主光斑（太阳/月亮）：颜色 + 位置(%) + 半径(vmax 比例系数) */
  sunColor: string
  sunX: number
  sunY: number
  sunR: number
  /** 环境反光斑（对侧柔和补光） */
  ambColor: string
  ambX: number
  ambY: number
  /** 雾霭/大气层（低透明大范围，柔化接缝） */
  hazeColor: string
  /** SVG 主体（气流环）高光/暗部/流点 */
  coreHi: string
  coreLo: string
  flow: string
  /** 文字（按天空亮度选深/浅；对三停对比 ≥4.5 已测） */
  ink: string
  inkMuted: string
  /** 交互控件强调（slider 填充/刻度高亮） */
  accent: string
}

export const SCENE_ENVS: SceneEnv[] = [
  {
    id: 'preDawn', name: '晨前',
    skyTop: '#060b1c', skyMid: '#0d1730', skyHorizon: '#1f3054',
    sunColor: '#46639c', sunX: 28, sunY: 76, sunR: 0.55,
    ambColor: '#2a3a66', ambX: 78, ambY: 30,
    hazeColor: '#18264a',
    coreHi: '#8fb8e0', coreLo: '#33507a', flow: '#a8ccf0',
    ink: '#e9effc', inkMuted: '#a8bcd8', accent: '#7fa8e0',
  },
  {
    id: 'sunrise', name: '晨启',
    skyTop: '#15223f', skyMid: '#41507c', skyHorizon: '#f2ac66',
    sunColor: '#ffc27a', sunX: 33, sunY: 70, sunR: 0.72,
    ambColor: '#d8869a', ambX: 74, ambY: 34,
    hazeColor: '#7a6f9a',
    coreHi: '#ffd9a4', coreLo: '#8a6244', flow: '#ffcf96',
    ink: '#fff3e2', inkMuted: '#f0d9c0', accent: '#ffb066',
  },
  {
    id: 'daytime', name: '日间',
    skyTop: '#28609e', skyMid: '#6fb0dc', skyHorizon: '#d2ecf8',
    sunColor: '#ffffff', sunX: 50, sunY: 14, sunR: 0.5,
    ambColor: '#a8d8f0', ambX: 16, ambY: 40,
    hazeColor: '#b8ddf2',
    coreHi: '#ffffff', coreLo: '#3d7ab8', flow: '#e8f6ff',
    /* 统一浅字体系：copy 区局部暗晕衬底（Stripe 同款），地平线亮区由晕兜底 */
    ink: '#f4fafd', inkMuted: '#e2f1fa', accent: '#9adcff',
  },
  {
    id: 'dusk', name: '暮色',
    skyTop: '#221a4e', skyMid: '#5c3c80', skyHorizon: '#d4718e',
    sunColor: '#ff9a80', sunX: 67, sunY: 66, sunR: 0.66,
    ambColor: '#8a62b4', ambX: 20, ambY: 30,
    hazeColor: '#4c3a74',
    coreHi: '#e8ccf4', coreLo: '#5c4478', flow: '#d4b0ec',
    ink: '#f7f0fc', inkMuted: '#d8c6e8', accent: '#c084d8',
  },
  {
    id: 'sunset', name: '晚间',
    skyTop: '#170f30', skyMid: '#50284a', skyHorizon: '#ec7452',
    sunColor: '#ff7e56', sunX: 75, sunY: 72, sunR: 0.68,
    ambColor: '#a44e66', ambX: 24, ambY: 28,
    hazeColor: '#3c2a56',
    coreHi: '#ffc0a0', coreLo: '#7c4450', flow: '#ffa888',
    ink: '#fdf0e8', inkMuted: '#f0ccb8', accent: '#ff8a62',
  },
  {
    id: 'night', name: '夜班',
    skyTop: '#02040e', skyMid: '#081220', skyHorizon: '#13253e',
    sunColor: '#5a7ca8', sunX: 64, sunY: 18, sunR: 0.4,
    ambColor: '#1c3050', ambX: 22, ambY: 66,
    hazeColor: '#0c1a30',
    coreHi: '#78a4cc', coreLo: '#24405c', flow: '#8cb8e0',
    ink: '#e2ecf8', inkMuted: '#9cb4cc', accent: '#6a94c4',
  },
]

export function clampScenePosition(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(5, Math.max(0, v))
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')
}

export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return rgbToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t])
}

function mixNum(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 相对亮度（WCAG）与文字对比（r03 供 ink 自检/测试用） */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255)
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export interface InterpolatedEnv extends Omit<SceneEnv, 'id' | 'name'> {
  id: SceneEnv['id']
  name: string
  indexA: number
  indexB: number
  t: number
}

/** 小数 scenePosition → 两邻档全字段插值（端点即该档原色；连续、无 NaN） */
export function interpolateEnv(pos: number): InterpolatedEnv {
  const p = clampScenePosition(pos)
  const iA = Math.min(5, Math.floor(p))
  const iB = Math.min(5, iA + 1)
  const t = p - iA
  const a = SCENE_ENVS[iA]
  const b = SCENE_ENVS[iB]
  return {
    id: t < 0.5 ? a.id : b.id,
    name: t < 0.5 ? a.name : b.name,
    indexA: iA,
    indexB: iB,
    t,
    skyTop: mixHex(a.skyTop, b.skyTop, t),
    skyMid: mixHex(a.skyMid, b.skyMid, t),
    skyHorizon: mixHex(a.skyHorizon, b.skyHorizon, t),
    sunColor: mixHex(a.sunColor, b.sunColor, t),
    sunX: mixNum(a.sunX, b.sunX, t),
    sunY: mixNum(a.sunY, b.sunY, t),
    sunR: mixNum(a.sunR, b.sunR, t),
    ambColor: mixHex(a.ambColor, b.ambColor, t),
    ambX: mixNum(a.ambX, b.ambX, t),
    ambY: mixNum(a.ambY, b.ambY, t),
    hazeColor: mixHex(a.hazeColor, b.hazeColor, t),
    coreHi: mixHex(a.coreHi, b.coreHi, t),
    coreLo: mixHex(a.coreLo, b.coreLo, t),
    flow: mixHex(a.flow, b.flow, t),
    ink: mixHex(a.ink, b.ink, t),
    inkMuted: mixHex(a.inkMuted, b.inkMuted, t),
    accent: mixHex(a.accent, b.accent, t),
  }
}

/** D08-W1 r02 · chase 单驱动（输入 target 与实际 visual 分离） */
export const CHASE_K = 0.085 // r05：更缓收敛（0→5 约 88 帧 ≈1.47s@60fps；1.47s 落 800–1200ms 档上限附近，观感从容）
export const CHASE_EPS = 0.002
/** r05 闪屏修复：色彩插值 30fps 足够平滑（原 60fps 每帧 setState 触发大面积重绘=闪屏根因之一） */
export const CHASE_FRAME_DIVISOR = 2

export function chaseStep(current: number, target: number, k: number = CHASE_K): number {
  return current + (target - current) * k
}

export function chaseSettled(current: number, target: number, eps: number = CHASE_EPS): boolean {
  return Math.abs(target - current) < eps
}

/**
 * r06 chase hook · 回调式（闪屏根因修复核心）：
 * 逐帧值通过 onFrame 回调直写 DOM（CSS 变量/opacity/transform），**完全绕过 React setState**——
 * 页面零 re-render、零 reconcile；透明度/位移走合成器路径（不触发全屏 paint）。
 * 30fps 采样（CHASE_FRAME_DIVISOR=2）；reduce 立即送达 target 一次；settle 即停。
 */
import { useEffect, useRef } from 'react'

export function useSceneChase(target: number, onFrame: (visual: number) => void, opts?: { enabled?: boolean }): void {
  const enabled = opts?.enabled ?? true
  const targetRef = useRef(target)
  const visualRef = useRef(target)
  const onFrameRef = useRef(onFrame)
  const raf = useRef<number | null>(null)
  const parity = useRef(0)

  onFrameRef.current = onFrame
  targetRef.current = target

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || !enabled) {
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current)
        raf.current = null
      }
      if (visualRef.current !== targetRef.current) {
        visualRef.current = targetRef.current
        onFrameRef.current(targetRef.current)
      }
      return
    }
    const loop = () => {
      parity.current = (parity.current + 1) % CHASE_FRAME_DIVISOR
      if (parity.current === 0) {
        const next = chaseStep(visualRef.current, targetRef.current)
        if (next !== visualRef.current) {
          visualRef.current = next
          onFrameRef.current(next)
        }
      }
      if (chaseSettled(visualRef.current, targetRef.current)) {
        if (visualRef.current !== targetRef.current) {
          visualRef.current = targetRef.current
          onFrameRef.current(targetRef.current)
        }
        raf.current = null
        return
      }
      raf.current = requestAnimationFrame(loop)
    }
    if (raf.current === null) raf.current = requestAnimationFrame(loop)
    return () => {
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current)
        raf.current = null
      }
    }
  }, [targetRef.current, enabled])
}

/** r06 · 合成器权重：层 i 在 visual 处的交叉透明度（相邻线性、端点=1、和恒 1 可归一） */
export function layerWeights(visual: number, count: number): number[] {
  const p = clampScenePosition(visual)
  const w = Array.from({ length: count }, (_, i) => Math.max(0, 1 - Math.abs(p - i)))
  const sum = w.reduce((a, b) => a + b, 0) || 1
  return w.map((x) => x / sum)
}
