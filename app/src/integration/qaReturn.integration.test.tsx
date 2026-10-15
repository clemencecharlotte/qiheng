// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import App from '../App'
import { qaEvidenceTriggerId } from '../components/QaPanel'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(window as unknown as { ResizeObserver?: unknown }).ResizeObserver = RO
  ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = RO
  ;(HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView = function () {}
  ;(Element.prototype as unknown as { getClientRects?: () => unknown }).getClientRects = function () {
    return Object.assign([{ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, x: 0, y: 0 }], { item: (i: number) => (i === 0 ? null : null) })
  }
}

let host: HTMLDivElement
let root: Root
const tick = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

beforeEach(() => {
  stubMatchMedia()
  window.location.hash = '#/records/audit?mode=legacy&scenario=normal'
  window.localStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('QA 引用：显式返回恢复本次 QA 入口与已完成答案', async () => {
  await act(async () => root.render(<App />))
  await tick()
  const ta = host.querySelector<HTMLTextAreaElement>('textarea')
  expect(ta, 'records/audit 应渲染可信问答输入').not.toBeNull()
  if (!ta) throw new Error('missing QA textarea')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(ta, 'AC-03 为什么只读 / 不能调度？')
    ta.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  const form = ta.closest('form')!
  await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 0)) })
  const refId = qaEvidenceTriggerId('unit:AC-03')
  const link = host.querySelector<HTMLButtonElement>(`[id="${refId}"]`)
  expect(link, '提问后应出现本次 qa-ref 证据入口').not.toBeNull()
  await act(async () => { link!.click(); await new Promise((r) => setTimeout(r, 0)) })
  // 证据页（新 entry）
  await tick()
  expect(window.location.hash).toContain('schedule/evidence')
  await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 0)) })
  await tick()
  const backRef = host.querySelector<HTMLButtonElement>(`[id="${refId}"]`)
  expect(backRef, '返回后本次 QA 入口应恢复存在').not.toBeNull()
  expect(host.textContent).toContain('AC-03 离心机喘振边界未经核实')
  expect(document.activeElement).toBe(backRef)
})
