import { describe, expect, it } from 'vitest'
import { resolveTheme, THEME_OPTIONS } from './theme'

describe('主题偏好解析', () => {
  it('显式日间与夜间不受系统偏好影响', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('系统偏好跟随 prefers-color-scheme', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('臻彩按夜间底色解析（vivid→dark）', () => {
    expect(resolveTheme('vivid', true)).toBe('dark')
    expect(resolveTheme('vivid', false)).toBe('dark')
  })

  it('默认顺序：跟随系统 / 日间 / 夜间 / 臻彩', () => {
    expect(THEME_OPTIONS.map((o) => o.id)).toEqual(['system', 'light', 'dark', 'vivid'])
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual(['跟随系统', '日间', '夜间', '臻彩'])
  })
})