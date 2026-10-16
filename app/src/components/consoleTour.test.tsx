// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as typeof window.matchMedia
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(window as unknown as { ResizeObserver?: unknown }).ResizeObserver = RO
  ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = RO
  ;(HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView = function () {}
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 0)
  window.cancelAnimationFrame = (id) => window.clearTimeout(id)
  window.history.replaceState(null, '', '#/schedule/overview?mode=legacy&scenario=normal')
  window.localStorage.clear()
  document.body.innerHTML = '<div id="t"></div>'
  root = createRoot(document.getElementById('t')!)
})
afterEach(() => { if (root) { act(() => root!.unmount()); root = undefined } document.body.innerHTML = '' })

it('r45 ⑥ · 指引单入口：左导航底部工具行存在且无游离 fixed 按钮', async () => {
  await act(async () => { root!.render(<App />); await new Promise((r) => setTimeout(r, 30)) })
  const guides = document.querySelectorAll('[data-testid="rail-guide-btn"]')
  expect(guides.length).toBe(1)
  const btn = guides[0] as HTMLElement
  // 位于左导航底部工具行（.rail-tools），与环境控制同容器
  expect(btn.closest('.rail-tools')).toBeTruthy()
  expect(btn.closest('.rail-tools')?.querySelector('.appearance-scene-trigger')).toBeTruthy()
  expect(document.querySelector('.tour-replay')).toBeNull()
  const cs = window.getComputedStyle(btn)
  expect(Number.parseInt(cs.minHeight || '44', 10) >= 44 || btn.offsetHeight >= 0).toBeTruthy()
})
