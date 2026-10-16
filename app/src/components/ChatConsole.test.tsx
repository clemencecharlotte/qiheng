// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ChatConsole from './ChatConsole'
import type { QaView } from './QaPanel'
import type { EvidenceContext } from '../domain/evidence'
import { detectNarratorConfig } from '../domain/narrator'
import { runHistoryChain, runScheduleChain } from '../domain/chain'
import { runScenario } from '../domain/engine'
import { assessHealth } from '../domain/health'
import { aggregateQuality } from '../domain/quality'
import { buildHistoryFixture } from '../domain/history'
import { FIXED_SEED, UNITS } from '../domain/units'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const run = runScenario('normal', UNITS, FIXED_SEED)
const fixture = buildHistoryFixture('fx_clean')
const quality = aggregateQuality(fixture)
const health = assessHealth(fixture)
const ctx: EvidenceContext = {
  run, normalRun: run, fixture, quality, health, scenarioLabel: '常态',
  scheduleChain: runScheduleChain({ scenario: 'normal', scenarioLabel: '常态', run }),
  historyReview: runHistoryChain({ fixture, quality, health }),
}
let host: HTMLDivElement
let root: Root
let captured: QaView | null
const onAnswered = vi.fn()
const onJump = vi.fn()
const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open') })

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  captured = null
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

async function mount(view: QaView | null = null, runIdentity = 'run-a') {
  await act(async () => root.render(<ChatConsole
    ctx={ctx} scenarioLabel="常态" narratorConfig={detectNarratorConfig()} narratorTransport={null}
    safetyAllowsApproval={true} onAnswered={onAnswered} onJump={onJump}
    runIdentity={runIdentity} view={view} onViewChange={(next) => { captured = next }}
    drawerContent={<button>查询设备</button>}
  />))
}
async function ask() {
  const input = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'AC-03 为什么只读？')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

it('uses the native modal lifecycle, places initial focus inside, and returns focus on Escape', async () => {
  await mount()
  const trigger = [...host.querySelectorAll('button')].find((b) => b.textContent === '上下文与工具')!
  await act(async () => { trigger.focus(); trigger.click() })
  const dialog = host.querySelector('dialog')!
  expect(showModal).toHaveBeenCalledOnce()
  expect(dialog.open).toBe(true)
  expect(dialog.contains(document.activeElement)).toBe(true)
  const controls = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
  for (const control of controls) control.getClientRects = () => ({ length: 1 } as DOMRectList)
  const first = controls[0], last = controls[controls.length - 1]
  await act(async () => {
    first.focus()
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  })
  expect(document.activeElement).toBe(last)
  await act(async () => { last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })) })
  expect(document.activeElement).toBe(first)
  await act(async () => { dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(host.querySelector('dialog')).toBeNull()
  expect(close).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(trigger)
  // Native background inertness still requires a real-browser check.
})

it('keeps repeated-answer evidence IDs unique, and restores messages and the exact originating link', async () => {
  await mount()
  await ask(); await ask()
  expect(host.querySelectorAll('.chat-msg')).toHaveLength(4)
  const ids = [...host.querySelectorAll('[id]')].map((e) => e.id)
  expect(new Set(ids).size).toBe(ids.length)
  const details = host.querySelectorAll('details')[1]
  await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')) })
  const link = details.querySelector('button')!
  await act(async () => link.click())
  expect(onJump).toHaveBeenLastCalledWith('schedule', 'unit:AC-03', link.id)
  const saved = captured!
  const originId = link.id
  expect(saved.messages).toHaveLength(4)
  await act(async () => root.unmount())
  root = createRoot(host)
  await mount(saved)
  expect(host.querySelectorAll('.chat-msg')).toHaveLength(4)
  expect(document.getElementById(originId)).not.toBeNull()
  expect(document.getElementById(originId)!.closest('details')!.open).toBe(true)
  expect(onAnswered).toHaveBeenCalledTimes(2)
})

it('clears old answers when the run identity changes instead of presenting them as current evidence', async () => {
  await mount(); await ask()
  await mount(captured, 'run-b')
  expect(host.querySelectorAll('.chat-msg')).toHaveLength(0)
  expect(host.textContent).toContain('你想了解哪个设备或方案')
})
