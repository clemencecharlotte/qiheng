/**
 * 气衡 M08 · 批次详情选择控制器（纯逻辑，无 React，便于单测）。
 *
 * 解决“快速 A→B 选择 / 刷新时旧异步响应写回新选择或清错 busy”：
 *   · latest-wins：每次 select/retry 递增序号，只有最后一次的响应被采纳；
 *   · 明确的 idle/loading/ready/error 状态；失败可 retry；
 *   · clear()/dispose() 使在途响应失效（卸载后不再写回）。
 */
import type { DataClient } from './client'
import type { BatchSummary, Observation, QualityReport } from './contracts'

export type DetailStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface IngressDetailState {
  status: DetailStatus
  batchId: string | null
  batch: BatchSummary | null
  quality: QualityReport | null
  observations: Observation[]
  error: string | null
}

export interface IngressSelection {
  get: () => IngressDetailState
  subscribe: (cb: () => void) => () => void
  select: (batchId: string) => void
  retry: () => void
  clear: () => void
  dispose: () => void
}

const IDLE: IngressDetailState = { status: 'idle', batchId: null, batch: null, quality: null, observations: [], error: null }

export function createIngressSelection(
  client: Pick<DataClient, 'getBatch' | 'getQuality' | 'getObservations'>,
): IngressSelection {
  let state: IngressDetailState = IDLE
  let seq = 0
  let disposed = false
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  function invalidate() {
    seq += 1
    return seq
  }

  async function load(batchId: string) {
    const my = invalidate()
    state = { status: 'loading', batchId, batch: null, quality: null, observations: [], error: null }
    emit()
    try {
      const [batch, quality, obs] = await Promise.all([
        client.getBatch(batchId),
        client.getQuality(batchId),
        client.getObservations(batchId, 8, 0),
      ])
      if (disposed || my !== seq) return // latest-wins / 已卸载
      state = { status: 'ready', batchId, batch, quality, observations: obs.items, error: null }
      emit()
    } catch {
      if (disposed || my !== seq) return
      state = { status: 'error', batchId, batch: null, quality: null, observations: [], error: '批次详情加载失败，请重试。' }
      emit()
    }
  }

  return {
    get: () => state,
    subscribe: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    select: (batchId) => {
      void load(batchId)
    },
    retry: () => {
      if (state.batchId) void load(state.batchId)
    },
    clear: () => {
      invalidate()
      state = IDLE
      emit()
    },
    dispose: () => {
      disposed = true
      invalidate()
    },
  }
}
