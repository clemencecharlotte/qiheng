// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import RelationEvidence from './RelationEvidence'
import { consoleDataBus } from '../../integration/consoleDataBus'
import type { DomainSnapshot } from '../../integration/relations'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const domain: DomainSnapshot = {
  units: [
    { id: 'AC-01', name: '1# 螺杆', eligible: true, reason: null },
    { id: 'AC-02', name: '2# 螺杆', eligible: true, reason: null },
    { id: 'AC-03', name: '3# 离心', eligible: false, reason: '喘振边界未核实' },
  ],
  plans: [
    { id: 'baseline', label: '基线', passed: false, violationCount: 2, unitIds: ['AC-01'] },
    { id: 'recommendation', label: '建议', passed: true, violationCount: 0, unitIds: ['AC-01', 'AC-02'] },
  ],
  safety: { verdict: 'allow', reasons: [] },
  reviewedPlanId: 'recommendation',
}

function publishReady() {
  consoleDataBus.publish({
    status: 'ready', reason: '仅离线批次（非实时）',
    batches: [{ id: 'b1', sourceId: 'synth-air-2', entity: 'air', format: 'csv', filename: 'b1.csv', ruleVersion: 'r1', receivedAt: '2026-10-14T00:00:00Z', totalRows: 10, validRows: 10, isolatedRows: 0, rejectedRows: 0, status: 'loaded' } as never],
    events: [{ eventId: 'e1', batchId: 'b1', sourceId: 'synth-air-2', type: 'imported', severity: 'info', receivedAt: '2026-10-14T00:00:00Z' } as never],
    sourceState: { sourceId: 'synth-air-2', sourceObservedAt: '2026-10-14T00:00:00Z', receivedAt: '2026-10-14T00:00:00Z', heartbeatAt: null } as never,
    error: null,
  } as never)
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(window as unknown as { matchMedia?: unknown }).matchMedia = ((q: string) => ({
    matches: true, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

it('MAP 视角过滤后不白屏：坐标与边端点合同一致（P0 回归）', async () => {
  publishReady()
  // 站内视角：仅 device，layout 只含 device；渲染节点必须同子集（此前用全量节点取 layout → undefined.x）。
  await act(async () => { root.render(<RelationEvidence domain={domain} kinds={['device', 'pipeline']} />); await new Promise((r) => setTimeout(r, 0)) })
    const graphBtn = host.querySelector<HTMLButtonElement>('[data-testid="relations-view-graph"]')
  expect(graphBtn, '应有关系图切页').not.toBeNull()
  await act(async () => { graphBtn!.click() })
  expect(host.querySelector('[data-testid="relations-graph"]'), '图应渲染').not.toBeNull()
  expect(host.querySelectorAll('[data-testid^="relations-gnode-device:"]').length).toBe(3)
  expect(host.querySelectorAll('[data-testid^="relations-gnode-pipeline:"]').length).toBe(4)
  // 数据关系
  await act(async () => root.render(<RelationEvidence domain={domain} kinds={['source', 'batch', 'event']} />))
  expect(host.querySelectorAll('[data-testid^="relations-gnode-"]').length).toBe(3)
  // 决策证据
  await act(async () => root.render(<RelationEvidence domain={domain} kinds={['candidate', 'verifier', 'safety']} />))
  expect(host.querySelectorAll('[data-testid^="relations-gnode-"]').length).toBe(5)
})
