/**
 * D08-W1 r06 · SceneBackdrop——合成器路径重写（闪屏根因消除）。
 *
 * 根因（r03–r05 实测闪屏）：每帧把插值颜色写成 CSS 变量 → background-image
 * （多层 gradient + color-mix）每帧重新 paint **整个视口**——paint 路径无法走合成器，
 * 慢机器上表现为全屏闪烁。r01 无此层故无闪屏。
 *
 * r06 架构（全部动画走 compositor，零全屏 repaint）：
 * - 6 层**静态**环境层（每环境一张完整天空：渐变+雾霭+反光斑，paint 一次后缓存为纹理），
 *   运行时每帧只写各层 `opacity`（相邻线性交叉权重 layerWeights）→ 合成器混合；
 * - 太阳/月亮单独两层：`transform: translate3d + scale`（合成器动画）+ opacity，
 *   位置沿真实轨迹连续移动；
 * - 颗粒层静态；
 * - chase 回调式（useSceneChase）**直写 DOM style，零 setState、零 React reconcile**；
 *   30fps 采样；reduce 即时单次。
 */
import { useEffect, useRef } from 'react'
import { SCENE_ENVS, interpolateEnv, layerWeights, useSceneChase } from './scenePalette'
import './SceneBackdrop.css'

/** 太阳轨迹（visual 0→5）：x 从偏东到偏西，y 晨启升起→日间顶→晚间没入→夜班升为冷月 */
function sunPose(visual: number): { x: number; y: number; scale: number; warm: number; cool: number } {
  const keys: Array<[number, number, number]> = [
    [0, 28, 76], // 晨前：低东冷辉
    [1, 33, 70], // 晨启：升起
    [2, 50, 14], // 日间：顶中
    [3, 67, 66], // 暮色：西垂
    [4, 75, 72], // 晚间：没入
    [5, 64, 18], // 夜班：冷月高位
  ]
  const p = Math.min(5, Math.max(0, visual))
  const i = Math.min(4, Math.floor(p))
  const t = p - i
  const [x0, y0] = keys[i]
  const [x1, y1] = keys[i + 1]
  const x = x0 + (x1 - x0) * t
  const y = y0 + (y1 - y0) * t
  const warm = Math.max(0, 1 - Math.abs(p - 1.2) / 2.6) // 晨启最强
  const cool = Math.max(0, 1 - Math.abs(p - 5) / 1.6) // 夜班最强
  const scale = 0.85 + 0.35 * Math.max(0, 1 - Math.abs(p - 2) / 2.2) // 日间最大
  return { x, y, scale, warm, cool }
}

export default function SceneBackdrop({ visualPosition }: { visualPosition: number }) {
  const skyRefs = useRef<Array<HTMLDivElement | null>>([])
  const sunRef = useRef<HTMLDivElement | null>(null)
  const moonRef = useRef<HTMLDivElement | null>(null)

  const lastInk = useRef('')

  // 每帧直写 opacity/transform（合成器路径，零 setState/零 repaint）
  useSceneChase(visualPosition, (visual) => {
    const weights = layerWeights(visual, SCENE_ENVS.length)
    for (let i = 0; i < SCENE_ENVS.length; i++) {
      const el = skyRefs.current[i]
      if (el) el.style.opacity = weights[i].toFixed(4)
    }
    const pose = sunPose(visual)
    const sun = sunRef.current
    if (sun) {
      sun.style.transform = `translate3d(${pose.x.toFixed(2)}vw, ${pose.y.toFixed(2)}vh, 0) scale(${pose.scale.toFixed(3)})`
      sun.style.opacity = (0.28 + 0.6 * pose.warm).toFixed(3)
    }
    const moon = moonRef.current
    if (moon) {
      moon.style.transform = `translate3d(${(pose.x + 6).toFixed(2)}vw, ${(pose.y - 4).toFixed(2)}vh, 0) scale(${(0.5 + 0.5 * pose.cool).toFixed(3)})`
      moon.style.opacity = (0.5 * pose.cool).toFixed(3)
    }
    // D09 r06 · 文字对比设计（离散档位，不做逐帧变色——避免文字层持续重绘）：
    // 跨档过半时把该环境 ink/inkMuted/accent 写到根元素（页面级变量，CSS 160ms 过渡），
    // 卡外压背景文字随之切换到与背景成对比的色；多层 text-shadow 作贴身兜底（CSS 层）。
    const env = interpolateEnv(visual)
    const key = `${env.ink}|${env.inkMuted}|${env.accent}`
    if (key !== lastInk.current) {
      lastInk.current = key
      const root = document.documentElement
      root.style.setProperty('--w1-ink', env.ink)
      root.style.setProperty('--w1-ink-muted', env.inkMuted)
      root.style.setProperty('--w1-accent', env.accent)
    }
  })

  // 首帧对齐（SSR 后 hydration 前的静态 fallback：初始 opacity 由内联渲染）
  useEffect(() => {
    const weights = layerWeights(visualPosition, SCENE_ENVS.length)
    for (let i = 0; i < SCENE_ENVS.length; i++) {
      const el = skyRefs.current[i]
      if (el) el.style.opacity = weights[i].toFixed(4)
    }
  }, [visualPosition])

  return (
    <div className="u-w1-backdrop" aria-hidden="true">
      {SCENE_ENVS.map((e, i) => (
        <div
          key={e.id}
          ref={(el) => {
            skyRefs.current[i] = el
          }}
          className="u-w1-backdrop__sky"
          data-env={e.id}
          style={{
            background: `radial-gradient(120% 70% at 50% 78%, ${e.hazeColor}b8 0%, ${e.hazeColor}4d 48%, transparent 78%), radial-gradient(circle at ${e.ambX}% ${e.ambY}%, ${e.ambColor}9e 0%, ${e.ambColor}40 42%, transparent 72%), linear-gradient(180deg, ${e.skyTop} 0%, ${e.skyMid} 52%, ${e.skyHorizon} 100%)`,
            opacity: i === 0 ? 1 : 0,
            willChange: 'opacity',
          }}
        />
      ))}
      <div ref={sunRef} className="u-w1-backdrop__orb u-w1-backdrop__orb--sun" style={{ transform: 'translate3d(28vw, 76vh, 0)' }} />
      <div ref={moonRef} className="u-w1-backdrop__orb u-w1-backdrop__orb--moon" style={{ opacity: 0 }} />
      <div className="u-w1-backdrop__grain" />
    </div>
  )
}
