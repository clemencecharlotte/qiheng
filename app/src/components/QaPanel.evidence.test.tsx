// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import QaPanel, { qaEvidenceTriggerId, type QaView } from './QaPanel'
import { detectNarratorConfig, type NarratedAnswer } from '../domain/narrator'
import { runHistoryChain, runScheduleChain } from '../domain/chain'
import { runScenario } from '../domain/engine'
import { assessHealth } from '../domain/health'
import { aggregateQuality } from '../domain/quality'
import { buildHistoryFixture } from '../domain/history'
import { SCENARIOS } from '../domain/demand'
import { FIXED_SEED, UNITS } from '../domain/units'
import type { EvidenceContext } from '../domain/evidence'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function ctx(): EvidenceContext {
  const scenario = 'normal' as const
  const run = runScenario(scenario, UNITS, FIXED_SEED)
  const normalRun = runScenario('normal', UNITS, FIXED_SEED)
  const fixture = buildHistoryFixture('fx_clean')
  const quality = aggregateQuality(fixture)
  const health = assessHealth(fixture)
  return {
    run,
    normalRun,
    quality,
    health,
    scheduleChain: runScheduleChain({ scenario, scenarioLabel: SCENARIOS[0].label, run }),
    historyReview: runHistoryChain({ fixture, quality, health }),
    fixture,
    scenarioLabel: SCENARIOS[0].label,
  }
}

/** App 受控 QA 视图的等价用法：view/onViewChange 由外层持有（模拟 App 唯一 entry 快照）。 */
function Harness({ onJump, initial, onAnswered, onView }: {
  onJump: (w: string, t: string, o?: string) => void
  initial?: QaView | null
  onAnswered?: (q: string, a: NarratedAnswer) => void
  onView?: (v: QaView | null) => void
}) {
  const [view, setView] = useState<QaView | null>(initial ?? null)
  const update = (v: QaView) => { setView(v); onView?.(v) }
  return (
    <QaPanel
      ctx={ctx()}
      scenarioLabel={SCENARIOS[0].label}
      narratorConfig={detectNarratorConfig()}
      narratorTransport={null}
      safetyAllowsApproval={true}
      onJump={onJump}
      onAnswered={(q, a) => onAnswered?.(q, a)}
      view={view}
      onViewChange={update}
    />
  )
}

let host: HTMLDivElement
let root: Root
let jumps: Array<[string, string, string | undefined]>
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  jumps = []
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

async function clickPreset(label: string) {
  const btn = [...host.querySelectorAll<HTMLButtonElement>('button.chip-btn')].find((b) => b.textContent === label)
  if (!btn) throw new Error(`preset not found: ${label}`)
  await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 0)) })
}

it('QA 证据引用有外部稳定 trigger，点击透传 originId', async () => {
  await act(async () => root.render(<Harness onJump={(w, t, o) => jumps.push([w, t, o])} />))
  await clickPreset('AC-03 为什么只读 / 不能调度？')
  const link = host.querySelector<HTMLButtonElement>(`[id="${qaEvidenceTriggerId('unit:AC-03')}"]`)
  expect(link, 'QA 证据入口须有稳定 id 供返回回焦').not.toBeNull()
  await act(async () => link!.click())
  expect(jumps).toEqual([['schedule', 'unit:AC-03', qaEvidenceTriggerId('unit:AC-03')]])
})

it('允许进入人工评审不等于已授权执行（真实挂载消费者）', async () => {
  await act(async () => root.render(<Harness onJump={() => {}} />))
  await clickPreset('为什么当前调度建议通过复验、允许进入人工评审？')
  const card = host.querySelector('.qa-card')
  expect(card?.textContent).toContain('允许进入人工评审')
  expect(card?.textContent).toContain('不自动授权执行')
  expect(card?.textContent).not.toContain('已授权执行')
})

it('卸载/再挂载：已完成 QA 视图按快照恢复答案与本次 qa-ref，且不重新提问', async () => {
  const onAnswered = vi.fn()
  let captured: QaView | null = null
  await act(async () => root.render(<Harness onJump={() => {}} onAnswered={onAnswered} initial={null} onView={(v) => { captured = v }} />))
  await clickPreset('AC-03 为什么只读 / 不能调度？')
  // 捕获外层持有的真实视图快照（等价 App 存进唯一 entry 的临时快照）。
  expect(captured, '预设提问后应产出视图快照').not.toBeNull()
  expect(captured!.answer, '快照应含已完成答案').not.toBeNull()
  await act(async () => root.unmount())
  root = createRoot(host)
  const answeredBefore = onAnswered.mock.calls.length
  await act(async () => root.render(<Harness onJump={() => {}} onAnswered={onAnswered} initial={captured} />))
  // 视图恢复后：答案文本仍在、qa-ref 入口存在；未重新提问/产生第二审计或模型调用。
  expect(onAnswered.mock.calls.length).toBe(answeredBefore)
  expect(host.querySelector('.qa-card'), '恢复后应保留答案视图').not.toBeNull()
  expect(host.querySelector(`[id="${qaEvidenceTriggerId('unit:AC-03')}"]`), '恢复后本次引用按钮应真实存在').not.toBeNull()
})
