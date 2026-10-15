import type { FlowMilpInput, FlowMilpResult } from '../domain/optimizer/flowMilp'

export type FlowMilpWorkerState =
  | 'loading'
  | 'solving'
  | 'watchdog_terminated'
  | 'canceled'
  | 'worker_error'
  | 'ok'

export interface FlowMilpRunOutcome {
  requestId: string
  state: 'ok' | 'worker_error' | 'watchdog_terminated' | 'canceled'
  result: FlowMilpResult | null
  error?: string
}

export interface FlowMilpCancelReceipt {
  requestId: string
  state: 'canceled'
}

/**
 * 主线程控制器：每次 run 派生一个 Worker；requestId + inputIdentity + worker 实例三重核验，
 * 替代/取消/卸载立即 terminate 并隔离迟到回调；watchdog 超时 terminate。
 */
export class FlowMilpController {
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private seq = 0
  private current: { requestId: string; identity: string; worker: Worker } | null = null

  run(
    input: FlowMilpInput,
    identity: string,
    handlers: {
      onDone: (outcome: FlowMilpRunOutcome) => void
      onStatus?: (state: FlowMilpWorkerState) => void
    },
    opts?: { timeoutMs?: number },
  ): string {
    this.cancel()
    const requestId = `milp-${Date.now().toString(36)}-${++this.seq}`
    handlers.onStatus?.('loading')
    const worker = new Worker(new URL('./highs.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.current = { requestId, identity, worker }
    const isCurrent = (rid: string, w: Worker): boolean =>
      this.current !== null &&
      this.current.requestId === rid &&
      this.current.worker === w &&
      this.current.identity === identity
    const finished = { done: false }
    const settle = (outcome: FlowMilpRunOutcome) => {
      if (finished.done) return
      if (!isCurrent(outcome.requestId, worker)) return // 迟到/旧实例：隔离，不 clear 新 worker
      finished.done = true
      this.clearCurrent()
      handlers.onDone(outcome)
    }
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { requestId: string; ok: true; result: FlowMilpResult }
        | { requestId: string; ok: false; error: string }
      if (!isCurrent(data.requestId, worker)) return
      handlers.onStatus?.('solving')
      if (data.ok) settle({ requestId, state: 'ok', result: data.result })
      else settle({ requestId, state: 'worker_error', result: null, error: data.error })
    }
    worker.onerror = (event) => {
      if (!isCurrent(requestId, worker)) return
      settle({
        requestId,
        state: 'worker_error',
        result: null,
        error: event.message || 'Worker error',
      })
    }
    worker.postMessage({ requestId, input })
    const timeoutMs = opts?.timeoutMs ?? 8000
    this.watchdog = setTimeout(() => {
      if (this.current?.requestId !== requestId) return
      handlers.onStatus?.('watchdog_terminated')
      this.terminateCurrent(requestId)
      settle({ requestId, state: 'watchdog_terminated', result: null })
    }, timeoutMs)
    return requestId
  }

  /** 显式取消回执：终止当前 worker 并返回 canceled，不丢失状态/rereasons。 */
  cancel(handlers?: { onCanceled?: (receipt: FlowMilpCancelReceipt) => void }): FlowMilpCancelReceipt | null {
    const current = this.current
    if (!current) {
      if (this.watchdog) {
        clearTimeout(this.watchdog)
        this.watchdog = null
      }
      return null
    }
    const receipt: FlowMilpCancelReceipt = { requestId: current.requestId, state: 'canceled' }
    this.clearCurrent()
    handlers?.onCanceled?.(receipt)
    return receipt
  }

  private terminateCurrent(requestId: string): void {
    if (this.current?.requestId === requestId) {
      this.current.worker.terminate()
    }
  }

  private clearCurrent(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog)
      this.watchdog = null
    }
    if (this.current) {
      try {
        this.current.worker.terminate()
      } catch {
        // 幂等
      }
    }
    this.current = null
  }
}
