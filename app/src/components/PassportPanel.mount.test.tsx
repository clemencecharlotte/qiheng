// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PassportPanel from './PassportPanel'
import { buildPortfolioFixture, capturePortfolioSnapshot, canonicalPortfolioInput } from '../domain/portfolio'
import { makeUnfinishedAttempt, sealPortfolioPassport } from '../domain/passport'

const f = buildPortfolioFixture('p_capacity_rise')
const snapshot = capturePortfolioSnapshot(f)
const canonical = canonicalPortfolioInput(f).id
const attempt = makeUnfinishedAttempt({ epoch: 1, inputCanonical: canonical, inputSnapshot: snapshot }, 'lab_energy_first')
const result = sealPortfolioPassport({ epoch: 1, inputSnapshot: snapshot, inputCanonical: canonical, attempts: [attempt], status: 'canceled', startedAt: '2026-10-11T00:00:00.000Z' })
if (!result.ok || !result.passport) throw new Error(result.reason ?? 'fixture seal failed')
const passport = result.passport
const V = (cid: string) => `verify-${passport.passportId}-${cid}`
const RV = (cid: string) => `ref-verify-${passport.passportId}-${cid}`
const RC = (cid: string) => `ref-cand-${passport.passportId}-${cid}`
let host: HTMLDivElement
let root: Root
beforeEach(async () => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  await act(async () => root.render(<PassportPanel mode="compare" latest={passport} />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
it('actual consumer shows not-run candidate unknown rather than green', () => {
  expect(host.querySelector('.passport-candidate .u-status')?.getAttribute('data-status')).toBe('unknown')
})
it('verification reference opens and focuses actual initially unmounted verification evidence', async () => {
  const refs = [...host.querySelectorAll('details')].find(x => x.querySelector('summary')?.textContent === '复验与证据引用')!
  refs.open = true
  const trigger = host.querySelector<HTMLButtonElement>(`[id="${RV(attempt.candidateId)}"]`)!
  await act(async () => trigger.click())
  const target = host.querySelector(`[id="${V(attempt.candidateId)}"]`)
  expect(target, '真实引用点击必须挂载复验内容，不能对不存在的DOM静默返回').not.toBeNull()
  expect(document.activeElement).toBe(target)
})
it('input reference opens real input details rather than focusing its collapsed summary', async () => {
  const refs = [...host.querySelectorAll('details')].find(x => x.querySelector('summary')?.textContent === '复验与证据引用')!
  refs.open = true
  await act(async () => host.querySelector<HTMLButtonElement>(`[id="ref-input-${passport.passportId}"]`)!.click())
  const target = host.querySelector<HTMLDetailsElement>(`[id="input-${passport.passportId}"]`)!
  expect(target.open, '输入引用必须展示真实输入，不仅focus折叠的details').toBe(true)
})
it('两次不同引用各自返回自身来源入口（连续两次不回上次）', async () => {
  const refs = [...host.querySelectorAll('details')].find(x => x.querySelector('summary')?.textContent === '复验与证据引用')!
  refs.open = true
  await act(async () => host.querySelector<HTMLButtonElement>(`[id="ref-input-${passport.passportId}"]`)!.click())
  const back = (): HTMLButtonElement => [...host.querySelectorAll('button')].find(b => b.textContent === '← 返回证据引用') as HTMLButtonElement
  await act(async () => back().click())
  expect(document.activeElement).toBe(host.querySelector(`[id="ref-input-${passport.passportId}"]`))
  await act(async () => host.querySelector<HTMLButtonElement>(`[id="${RV(attempt.candidateId)}"]`)!.click())
  await act(async () => back().click())
  expect(document.activeElement).toBe(host.querySelector(`[id="${RV(attempt.candidateId)}"]`))
})
it('破损/跨护照引用 → 就近不可用反馈，不静默按 ID 定位、不改原文', async () => {
  const broken = { ...passport, references: { ...passport.references, verifications: [...passport.references.verifications, { candidateId: 'missing-x', ref: `${passport.passportId}#verify:missing-x` }] } }
  await act(async () => root.render(<PassportPanel mode="compare" latest={broken as typeof passport} />))
  const refs = [...host.querySelectorAll('details')].find(x => x.querySelector('summary')?.textContent === '复验与证据引用')!
  refs.open = true
  const btn = host.querySelector<HTMLButtonElement>(`[id="${RV('missing-x')}"]`)
  expect(btn, '破损引用按钮仍渲染但需反馈').not.toBeNull()
  await act(async () => btn!.click())
  expect(host.textContent).toContain('引用不可用')
  expect(host.querySelector(`[id="${V('missing-x')}"]`)).toBeNull()
})
it('返回输入引用恢复原来折叠状态', async () => {
  const trigger = host.querySelector<HTMLButtonElement>(`[id="ref-input-${passport.passportId}"]`)!
  await act(async () => trigger.click())
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '← 返回证据引用')!.click())
  expect(host.querySelector<HTMLDetailsElement>(`[id="input-${passport.passportId}"]`)!.open).toBe(false)
})
it('候选引用提供本次显式返回动作', async () => {
  await act(async () => host.querySelector<HTMLButtonElement>(`[id="${RC(attempt.candidateId)}"]`)!.click())
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '← 返回证据引用')).toBe(true)
})
it('切记录护照废弃旧目标且新护照不继承输入展开', async () => {
  const { savePassport, PASSPORT_STORE_KEY } = await import('../domain/passport')
  const result2 = sealPortfolioPassport({ epoch: 2, inputSnapshot: snapshot, inputCanonical: canonical, attempts: [makeUnfinishedAttempt({ epoch: 2, inputCanonical: canonical, inputSnapshot: snapshot }, 'lab_energy_first')], status: 'canceled', startedAt: '2026-10-11T00:01:00.000Z' })
  if (!result2.ok || !result2.passport) throw Error('second fixture')
  const p2 = result2.passport
  window.localStorage.removeItem(PASSPORT_STORE_KEY)
  expect(savePassport(passport).ok).toBe(true)
  expect(savePassport(p2).ok).toBe(true)
  await act(async () => root.render(<PassportPanel key="records" mode="records" latest={passport} />))
  await act(async () => host.querySelector<HTMLButtonElement>(`[id="ref-input-${passport.passportId}"]`)!.click())
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.passport-list button')].find(b => b.textContent?.includes(p2.passportId))!.click())
  expect(host.querySelector<HTMLDetailsElement>(`[id="input-${p2.passportId}"]`)!.open).toBe(false)
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '← 返回证据引用')).toBe(false)
  window.localStorage.removeItem(PASSPORT_STORE_KEY)
})
