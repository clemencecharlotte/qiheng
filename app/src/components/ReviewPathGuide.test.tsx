// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ReviewPathGuide from './ReviewPathGuide'
import { buildPortfolioFixture, capturePortfolioSnapshot, canonicalPortfolioInput } from '../domain/portfolio'
import { makeUnfinishedAttempt, sealPortfolioPassport, savePassport, PASSPORT_STORE_KEY } from '../domain/passport'

let host: HTMLDivElement
let root: Root
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); window.localStorage.removeItem(PASSPORT_STORE_KEY) })

it('无已封存护照 → 明确提示需先准备，不造成功记录', async () => {
  window.localStorage.removeItem(PASSPORT_STORE_KEY)
  const onNav = vi.fn()
  await act(async () => root.render(<ReviewPathGuide onNavigateSub={onNav} onOpenRecords={vi.fn()} />))
  expect(host.textContent).toContain('暂无已封存护照')
  expect(host.textContent).toContain('不预造成功记录')
})

it('有已封存护照 → 提供可操作的打开入口并触发跳转', async () => {
  const f = buildPortfolioFixture('p_capacity_rise')
  const snapshot = capturePortfolioSnapshot(f)
  const canonical = canonicalPortfolioInput(f).id
  const r = sealPortfolioPassport({ epoch: 1, inputSnapshot: snapshot, inputCanonical: canonical, attempts: [makeUnfinishedAttempt({ epoch: 1, inputCanonical: canonical, inputSnapshot: snapshot }, 'lab_energy_first')], status: 'canceled', startedAt: '2026-10-11T00:00:00.000Z' })
  if (!r.ok || !r.passport) throw new Error('fixture')
  expect(savePassport(r.passport).ok).toBe(true)
  const onNav = vi.fn(); const onRecords = vi.fn()
  await act(async () => root.render(<ReviewPathGuide onNavigateSub={onNav} onOpenRecords={onRecords} />))
  const btn = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '打开已封存护照')
  expect(btn).not.toBeNull()
  await act(async () => btn!.click())
  expect(onRecords).toHaveBeenCalledTimes(1)
})

it('路径步骤由人显式触发子路由（不自动求解/批准）', async () => {
  const onNav = vi.fn()
  await act(async () => root.render(<ReviewPathGuide onNavigateSub={onNav} onOpenRecords={vi.fn()} />))
  const compare = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '去看候选对比')!
  await act(async () => compare.click())
  expect(onNav).toHaveBeenCalledWith('compare')
  expect(host.textContent).toContain('不声称每次冷求解')
  expect(host.textContent).toContain('先在场景栏选择常态')
})
