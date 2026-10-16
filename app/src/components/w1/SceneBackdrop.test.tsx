// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import SceneBackdrop from './SceneBackdrop'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove(); vi.unstubAllGlobals()
  for (const key of ['--scene-copy-text','--w1-ink','--w1-ink-muted','--w1-accent']) document.documentElement.style.removeProperty(key)
})
it.each([false, true])('initial settled scene writes on-sky text even without a chase frame; reduced=%s', async (reduce) => {
  vi.stubGlobal('matchMedia', () => ({ matches: reduce }))
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(<SceneBackdrop visualPosition={2} />))
  expect(document.documentElement.style.getPropertyValue('--scene-copy-text')).toBe('#102d42')
  expect(document.documentElement.style.getPropertyValue('--w1-ink')).not.toBe('')
})
