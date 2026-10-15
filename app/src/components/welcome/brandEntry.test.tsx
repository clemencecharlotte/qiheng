/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest'

/**
 * M3 回归：欢迎页品牌入口的**输出元素合同**。
 *
 * M2 写了回顶处理函数，但 `<a className="qh-brand">` 漏接 onClick，
 * 同 hash 点品牌不回顶。这里不测孤立的处理函数，而是拦截 JSX runtime，
 * 捕获真实组件渲染出的品牌元素，断言它确实带 onClick（接线合同）。
 * SSR（renderToString）不执行 effect，也不序列化事件——所以必须看元素 props。
 */
type CapturedEl = { type: unknown; props: Record<string, unknown> }
const captured = vi.hoisted(() => [] as CapturedEl[])

vi.mock('react/jsx-runtime', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, (...a: unknown[]) => unknown>
  const wrap =
    (fn: (...a: unknown[]) => unknown) =>
    (type: unknown, props: unknown, key?: unknown) => {
      captured.push({ type, props: (props || {}) as Record<string, unknown> })
      return fn(type, props, key)
    }
  return { ...actual, jsx: wrap(actual.jsx), jsxs: wrap(actual.jsxs) }
})

vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, (...a: unknown[]) => unknown>
  const wrap =
    (fn: (...a: unknown[]) => unknown) =>
    (type: unknown, props: unknown, ...rest: unknown[]) => {
      captured.push({ type, props: (props || {}) as Record<string, unknown> })
      return fn(type, props, ...rest)
    }
  return { ...actual, jsxDEV: wrap(actual.jsxDEV) }
})

import { renderToString } from 'react-dom/server'
import WelcomePage from '../WelcomePage'

describe('欢迎页品牌入口接线（输出元素合同）', () => {
  it('品牌 <a> 带 onClick、href="#/welcome"、键盘原生可达', () => {
    captured.length = 0
    const html = renderToString(<WelcomePage onEnter={() => {}} />)

    const brand = captured.find((e) => e.props.className === 'qh-brand')
    expect(brand, '渲染输出必须包含 .qh-brand 元素').toBeTruthy()
    // 接线合同：品牌元素必须挂 onClick（这正是 M2 漏掉的一处）
    expect(typeof brand?.props.onClick).toBe('function')
    // 路由合同：走现有 #/welcome，hash 语义不变
    expect(brand?.props.href).toBe('#/welcome')
    // 键盘原生可达：<a> 不得带 tabIndex=-1
    expect(brand?.props.tabIndex).toBeUndefined()
    // SSR 输出确实含该锚点
    expect(html).toContain('class="qh-brand"')
    expect(html).toContain('href="#/welcome"')
  })
})
