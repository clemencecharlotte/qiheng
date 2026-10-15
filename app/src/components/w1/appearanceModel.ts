/**
 * D08-W1 r04 · 外观模式（AppearanceMode）与真实世界时间同步。
 *
 * 合同（协调本轮）：
 * - 四档：'system' 跟随系统（默认，初次进入）/ 'day' 日间 / 'night' 夜间 / 'vivid' 臻彩
 *   （六环境动态背景）。主题与环境分离合同不变：vivid 不改阅读主题。
 * - 小地球 = 「随现实时间变化」开关：开启后背景 scenePosition 由真实本地时间连续映射
 *   （timeToScenePosition，Date 为真实功能时钟，非合成夹具）；IP 时区推测为后续项
 *   （本版用浏览器本地时区，报告如实）。
 * - 重置 = 回默认：mode=system、地球关、手动滑动值清。
 * - 背景 scenePosition 决策为纯函数 effectiveScenePosition（可测）。
 */

export type AppearanceMode = 'system' | 'day' | 'night' | 'vivid'

export const APPEARANCE_MODES: Array<{ key: AppearanceMode; label: string }> = [
  { key: 'system', label: '跟随系统' },
  { key: 'day', label: '日间' },
  { key: 'night', label: '夜间' },
  { key: 'vivid', label: '臻彩' },
]

/**
 * 真实本地时间 → 六环境连续位置 [0,5]。
 * 锚点表（小时, 位置）：0=晨前、1=晨启、2=日间、3=暮色、4=晚间、5=夜班。
 * 真实昼夜节奏：夜班跨午夜；凌晨→晨前快速天亮；日间长驻；暮色→晚间→夜班渐暗。
 */
const TIME_ANCHORS: Array<[number, number]> = [
  [0, 5],
  [4.2, 4.72],
  [5.0, 0.1],
  [6.8, 1.0],
  [8.2, 1.85],
  [12.5, 2.0],
  [16.8, 2.6],
  [17.8, 3.0],
  [19.3, 4.0],
  [21.0, 4.95],
  [24, 5],
]

export function timeToScenePosition(hours: number): number {
  const h = ((hours % 24) + 24) % 24
  for (let i = 0; i < TIME_ANCHORS.length - 1; i++) {
    const [h0, p0] = TIME_ANCHORS[i]
    const [h1, p1] = TIME_ANCHORS[i + 1]
    if (h >= h0 && h <= h1) {
      const t = h1 === h0 ? 0 : (h - h0) / (h1 - h0)
      return p0 + (p1 - p0) * t
    }
  }
  return 5
}

export function localTimeHours(d: Date = new Date()): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

export interface SceneDecisionInput {
  mode: AppearanceMode
  globeOn: boolean
  manualScene: number
  /** 解析后的阅读主题（system 已按 prefers-color-scheme 解析） */
  themeResolved: 'light' | 'dark'
  /** 真实时钟（注入便于测试） */
  now?: Date
}

/** 背景位置决策：地球优先（真实世界同步）→ 模式 → 系统明暗 */
export function effectiveScenePosition(input: SceneDecisionInput): number {
  if (input.globeOn) return timeToScenePosition(localTimeHours(input.now))
  switch (input.mode) {
    case 'vivid':
      return input.manualScene
    case 'day':
      return 2
    case 'night':
      return 5
    case 'system':
      return input.themeResolved === 'light' ? 2 : 5
  }
}

/** 阅读主题决策：vivid 不改主题（环境与主题分离合同） */
export function effectiveTheme(input: Pick<SceneDecisionInput, 'mode' | 'themeResolved'>): 'light' | 'dark' {
  if (input.mode === 'day') return 'light'
  if (input.mode === 'night') return 'dark'
  return input.themeResolved
}
