/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest'

/**
 * M11 · 欢迎页真实登录/注册入口接线窄验：
 * 用 JSX runtime 捕获真实渲染元素，断言 welcome-auth 按钮的 onClick 真接到 onAuth，
 * 且以本次按钮元素为 origin 传入（不是旧来源 / 未禁用占位）。
 */
type CapturedEl = { type: unknown; props: Record<string, unknown> }
const captured = vi.hoisted(() => [] as CapturedEl[])

vi.mock('react/jsx-runtime', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, (...a: unknown[]) => unknown>
  const wrap = (fn: (...a: unknown[]) => unknown) => (type: unknown, props: unknown, key?: unknown) => {
    captured.push({ type, props: (props || {}) as Record<string, unknown> })
    return fn(type, props, key)
  }
  return { ...actual, jsx: wrap(actual.jsx), jsxs: wrap(actual.jsxs) }
})
vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, (...a: unknown[]) => unknown>
  const wrap = (fn: (...a: unknown[]) => unknown) => (type: unknown, props: unknown, ...rest: unknown[]) => {
    captured.push({ type, props: (props || {}) as Record<string, unknown> })
    return fn(type, props, ...rest)
  }
  return { ...actual, jsxDEV: wrap(actual.jsxDEV) }
})

import { renderToString } from 'react-dom/server'
import WelcomePage from './WelcomePage'

describe('M11 欢迎页登录/注册入口接线', () => {
  it('welcome-auth 按钮 onClick 以本次按钮为 origin 调用 onAuth', () => {
    captured.length = 0
    const onAuth = vi.fn()
    renderToString(<WelcomePage onEnter={() => {}} onAuth={onAuth} />)
    const btn = captured.find((e) => e.props['data-action'] === 'welcome-auth')
    expect(btn, '缺少 welcome-auth 按钮').toBeTruthy()
    expect(btn?.props.disabled).toBeUndefined() // 不再是禁用占位
    const fakeEl = { tagName: 'BUTTON' } as unknown as HTMLElement
    ;(btn?.props.onClick as (e: unknown) => void)({ currentTarget: fakeEl })
    expect(onAuth).toHaveBeenCalledTimes(1)
    expect(onAuth).toHaveBeenCalledWith(fakeEl)
  })
})
