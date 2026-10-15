export type ThemePreference = 'light' | 'dark' | 'system' | 'vivid'

export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'qiheng.theme.v1'

export const THEME_OPTIONS: Array<{ id: ThemePreference; label: string }> = [
  { id: 'system', label: '跟随系统' },
  { id: 'light', label: '日间' },
  { id: 'dark', label: '夜间' },
  { id: 'vivid', label: '臻彩' },
]

export function resolveTheme(
  preference: ThemePreference,
  prefersDark = false,
): ResolvedTheme {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  if (preference === 'vivid') return 'dark'
  return prefersDark ? 'dark' : 'light'
}

export function loadThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system' || raw === 'vivid') return raw
  } catch {
    // 读取失败回退默认
  }
  // 首次进入默认跟随系统
  return 'system'
}

export function saveThemePreference(preference: ThemePreference): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // 仅偏好持久化；失败不影响主流程
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, systemPrefersDark())
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved
    if (preference === 'vivid') document.documentElement.dataset.vivid = '1'
    else document.documentElement.removeAttribute('data-vivid')
  }
  return resolved
}