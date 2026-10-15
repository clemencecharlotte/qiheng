import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FlowMilpController } from './flowMilpController'
import type { FlowMilpInput, FlowMilpResult } from '../domain/optimizer/flowMilp'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  posted: unknown[] = []
  constructor(_url: URL, _opts?: unknown) {
    FakeWorker.instances.push(this)
  }
  postMessage(message: unknown): void {
    this.posted.push(message)
  }
  terminate(): void {
    this.terminated = true
  }
}

const originalWorker = (globalThis as { Worker?: unknown }).Worker

beforeEach(() => {
  FakeWorker.instances = []
  ;(globalThis as { Worker?: unknown }).Worker = FakeWorker
})
afterEach(() => {
  ;(globalThis as { Worker?: unknown }).Worker = originalWorker
})

const input = { fixtureId: 'x' } as unknown as FlowMilpInput
const dummyResult = { plan: null, verified: false, metricsOk: false } as unknown as FlowMilpResult

describe('FlowMilpController requestId/实例隔离', () => {
  it('取消后旧 Worker 的迟到 onmessage 不回调、不清新 Worker', async () => {
    const controller = new FlowMilpController()
    const doneA: string[] = []
    const idA = controller.run(input, 'idA', {
      onDone: (o) => doneA.push(o.state),
    })
    const workerA = FakeWorker.instances[0]
    const receipt = controller.cancel()
    expect(receipt).toEqual({ requestId: idA, state: 'canceled' })

    const doneB: string[] = []
    controller.run(input, 'idB', { onDone: (o) => doneB.push(o.state) })
    const workerB = FakeWorker.instances[1]
    // A 的迟到消息：requestId 不匹配当前 → 忽略，且不 terminate B
    workerA.onmessage?.({ data: { requestId: idA, ok: true, result: dummyResult } } as MessageEvent)
    expect(doneA).toEqual([])
    expect(workerB.terminated).toBe(false)

    // B 的合法消息通过
    const idB = (workerB.posted[0] as { requestId: string }).requestId
    workerB.onmessage?.({ data: { requestId: idB, ok: true, result: dummyResult } } as MessageEvent)
    expect(doneB).toEqual(['ok'])
  })

  it('旧 Worker 迟到 onerror 不触发旧 onDone，也不终止新 Worker', () => {
    const controller = new FlowMilpController()
    const doneA: string[] = []
    controller.run(input, 'idA', { onDone: (o) => doneA.push(o.state) })
    const workerA = FakeWorker.instances[0]
    controller.run(input, 'idB', { onDone: () => {} })
    const workerB = FakeWorker.instances[1]
    workerA.onerror?.({ message: 'late error' } as ErrorEvent)
    expect(doneA).toEqual([])
    expect(workerB.terminated).toBe(false)
  })

  it('watchdog 超时 terminate 并返回 watchdog_terminated', async () => {
    const controller = new FlowMilpController()
    const outcomes: string[] = []
    controller.run(input, 'idX', { onDone: (o) => outcomes.push(o.state) }, { timeoutMs: 5 })
    await new Promise((r) => setTimeout(r, 20))
    expect(outcomes).toEqual(['watchdog_terminated'])
    expect(FakeWorker.instances[0].terminated).toBe(true)
  })
})
