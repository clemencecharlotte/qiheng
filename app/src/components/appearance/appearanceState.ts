/**
 * M16 r01 · 外观受控状态 v2（唯一宿主 state）。
 * 共用：environmentPosition[0,5]、appearanceMode(system|day|night|vivid)、
 *       followLocalTime:boolean、glassIntensity[0,1]（连续，UI 0–100% 步长 0.01）。
 * 旧字段名不同：adapter 明确映射；**版本化**——仅当缺 v2 字段时 g=oldLevel/5
 * （避免旧的 glassLevel=1 被当成新的 100%）。
 * 环境 palette 采用旧设计正式源（D11，未交付）——本模块只持状态，不含 palette。
 */
export type AppearanceMode = 'system' | 'day' | 'night' | 'vivid'

export interface AppearanceStateV2 {
  version: 2
  environmentPosition: number // [0,5]
  appearanceMode: AppearanceMode
  followLocalTime: boolean
  glassIntensity: number // [0,1]
}

export const APPEARANCE_V2_KEY = 'qh.appearance.v2'
export const APPEARANCE_V1_KEY = 'qh.appearance.v1' // { scenePosition, glassLevel[0..5], followRealTime }

export const DEFAULT_APPEARANCE_V2: AppearanceStateV2 = {
  version: 2,
  environmentPosition: 2,
  appearanceMode: 'vivid',
  followLocalTime: true,
  glassIntensity: 0.5,
}

function clampPos(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 2
  return Math.min(5, Math.max(0, n))
}
function clampG(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_APPEARANCE_V2.glassIntensity
  return Math.min(1, Math.max(0, n))
}

/** 旧字段名映射：scenePosition→environmentPosition；glassLevel[0..5]→g=level/5；followRealTime→followLocalTime。 */
export function mapLegacyV1(v1: unknown): Partial<AppearanceStateV2> {
  if (!v1 || typeof v1 !== 'object') return {}
  const o = v1 as Record<string, unknown>
  const out: Partial<AppearanceStateV2> = {}
  if (typeof o.scenePosition === 'number') out.environmentPosition = clampPos(o.scenePosition)
  if (typeof o.glassLevel === 'number') out.glassIntensity = clampG((o.glassLevel as number) / 5) // 关键：旧 0..5 → 0..1
  if (typeof o.followRealTime === 'boolean') out.followLocalTime = o.followRealTime
  return out
}

/** 主题偏好（theme.ts 的 light/dark）与新 appearanceMode 的显式映射。 */
export function themeToAppearanceMode(theme: string | null | undefined): AppearanceMode {
  if (theme === 'light') return 'day'
  if (theme === 'dark') return 'night'
  if (theme === 'vivid') return 'vivid'
  return 'system'
}
export function appearanceModeToTheme(mode: AppearanceMode): 'system' | 'light' | 'dark' | 'vivid' {
  if (mode === 'day') return 'light'
  if (mode === 'night') return 'dark'
  if (mode === 'vivid') return 'vivid'
  return 'system'
}

export function normalizeAppearance(v: Partial<AppearanceStateV2> | null | undefined): AppearanceStateV2 {
  const base = { ...DEFAULT_APPEARANCE_V2, ...(v ?? {}) }
  const mode: AppearanceMode = (['system', 'day', 'night', 'vivid'] as const).includes(base.appearanceMode as AppearanceMode)
    ? (base.appearanceMode as AppearanceMode)
    : 'system'
  return {
    version: 2,
    environmentPosition: clampPos(base.environmentPosition),
    appearanceMode: mode,
    followLocalTime: base.followLocalTime === true,
    glassIntensity: clampG(base.glassIntensity),
  }
}

export function loadAppearanceState(): AppearanceStateV2 {
  try {
    const rawV2 = window.localStorage.getItem(APPEARANCE_V2_KEY)
    if (rawV2) return normalizeAppearance(JSON.parse(rawV2))
    const rawV1 = window.localStorage.getItem(APPEARANCE_V1_KEY)
    if (rawV1) {
      // 仅在缺 v2 字段时按旧值映射（明确 ≥0 版本化）。
      return normalizeAppearance({ ...DEFAULT_APPEARANCE_V2, ...mapLegacyV1(JSON.parse(rawV1)) })
    }
  } catch {
    /* 忽略 */
  }
  return { ...DEFAULT_APPEARANCE_V2 }
}

export function saveAppearanceState(s: AppearanceStateV2): void {
  try {
    window.localStorage.setItem(APPEARANCE_V2_KEY, JSON.stringify(normalizeAppearance(s)))
  } catch {
    /* 忽略 */
  }
}
