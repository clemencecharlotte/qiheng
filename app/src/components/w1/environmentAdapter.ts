/**
 * D11 r01 · 环境供件 adapter——宿主统一受控字段 ↔ W1 既有组件 props 映射。
 *
 * 合同（协调指定）：
 * - 宿主统一字段：environmentPosition∈[0,5]（唯一位置源）、appearanceMode
 *   （'system'|'day'|'night'|'vivid'，默认 system）、followLocalTime（boolean，随本机时间）。
 *   **宿主持有/持久化/时区**：adapter 为纯函数，不写存储、不取时钟（now 由宿主注入）。
 * - **不复制第二套 palette**：映射目标=既有 appearanceModel（effectiveScenePosition/
 *   effectiveTheme/timeToScenePosition）与组件 props（scenePosition/mode/globeOn）。
 * - 语义：
 *   followLocalTime=true → 位置=timeToScenePosition(本机时间)（随本机时间，真实世界同步）；
 *   否则 **始终** 用宿主手选持久 environmentPosition（**不因 appearanceMode/theme 覆盖**）。
 *   合同（M23 阶段A 更正）：外观模式只决定文字/材质主题；环境决定背景/展台光色；玻璃独立。
 *   旧 day→2/night→5/system→theme 的“模式覆盖环境”与“日间主题+夜班环境合法”冲突，已废。
 * - 映射为纯计算；作用域组件（SceneBackdrop/SceneShowcase/SceneDial/AppearanceDial）
 *   消费映射结果，行为与 D10 r06 完全一致（同 chase/同决策链）。
 */
import { timeToScenePosition, type AppearanceMode } from './appearanceModel'
import { clampScenePosition } from './scenePalette'

/** 宿主统一受控字段（协调命名） */
export interface EnvironmentHostState {
  /** 唯一位置源 [0,5]，可小数（宿主持有+持久化） */
  environmentPosition: number
  appearanceMode: AppearanceMode
  /** 随本机时间（true 时位置由时间锚点表决定） */
  followLocalTime: boolean
  /** 阅读主题解析值（system 已由宿主按 prefers-color-scheme 解析） */
  themeResolved: 'light' | 'dark'
  /** 真实时钟（注入；宿主负责采样频率） */
  now?: Date
}

/** 映射结果：直接喂给 W1 组件的受控 props */
export interface W1EnvironmentBinding {
  /** → SceneBackdrop.visualPosition / SceneShowcase.scenePosition / SceneDial.value */
  scenePosition: number
  /** → AppearanceDial.mode（同名直通） */
  appearanceMode: AppearanceMode
  /** → AppearanceDial.globeOn（followLocalTime 同义映射） */
  globeOn: boolean
}

/** 纯映射：宿主字段 → W1 受控 props（与 D09 appearanceModel 决策链同源，无第二套逻辑） */
export function resolveEnvironment(host: EnvironmentHostState): W1EnvironmentBinding {
  const position = clampScenePosition(host.environmentPosition)
  if (host.followLocalTime) {
    return {
      scenePosition: clampScenePosition(timeToScenePosition(localHours(host.now))),
      appearanceMode: host.appearanceMode,
      globeOn: true,
    }
  }
  // 手选：始终用持久 environmentPosition，不因 theme/mode 覆盖（主题与环境独立）。
  return { scenePosition: position, appearanceMode: host.appearanceMode, globeOn: false }
}

function localHours(now?: Date): number {
  const d = now ?? new Date()
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

/** 反向：宿主从组件回调（onScenePositionChange/onGlobeChange）写回统一字段 */
export function toHostPatch(patch: { scenePosition?: number; globeOn?: boolean }): {
  environmentPosition?: number
  followLocalTime?: boolean
} {
  const out: { environmentPosition?: number; followLocalTime?: boolean } = {}
  if (patch.scenePosition !== undefined) out.environmentPosition = clampScenePosition(patch.scenePosition)
  if (patch.globeOn !== undefined) out.followLocalTime = patch.globeOn
  return out
}
