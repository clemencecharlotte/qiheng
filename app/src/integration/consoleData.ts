/**
 * 气衡 M10 · 控制台共享只读数据控制器（纯逻辑，无 React）。
 *
 * 汇总“当前已加载范围”：health + 批次列表 + 治理事件 + 选中来源状态。
 * 状态诚实：unconfigured / loading / error / offline / ready；
 * 离线批次不作为 live；时间戳（observedAt/receivedAt/heartbeatAt）原样呈现，未知不填 0。
 * latest-wins：并发刷新只采纳最后一次；dispose 后不再写回。
 */
import type { DataClient } from './client'
import type { BatchSummary, GovernanceEvent, SourceState } from './contracts'

export type ConsoleStatus = 'unconfigured' | 'loading' | 'error' | 'offline' | 'ready'

export interface ConsoleDataState {
  status: ConsoleStatus
  reason: string
  batches: BatchSummary[]
  events: GovernanceEvent[]
  sourceState: SourceState | null
  error: string | null
}

export interface ConsoleData {
  get: () => ConsoleDataState
  subscribe: (cb: () => void) => () => void
  load: () => Promise<void>
  dispose: () => void
}

const EMPTY: ConsoleDataState = {
  status: 'loading', reason: '正在读取只读数据服务', batches: [], events: [], sourceState: null, error: null,
}

export function createConsoleData(client: Pick<DataClient, 'health' | 'listBatches' | 'listEvents' | 'getSourceState'>): ConsoleData {
  let seq = 0
  let disposed = false
  let state: ConsoleDataState = { ...EMPTY }
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  async function load(): Promise<void> {
    const my = ++seq
    state = { ...state, status: 'loading', error: null, reason: '正在读取只读数据服务' }
    emit()
    try {
      await client.health()
      const [batches, events] = await Promise.all([client.listBatches(), client.listEvents({ limit: 50 })])
      let sourceState: SourceState | null = null
      if (batches.items.length > 0) sourceState = await client.getSourceState(batches.items[0].sourceId)
      if (disposed || my !== seq) return
      state = {
        status: 'ready',
        reason: batches.items.length > 0 ? '仅离线批次（非实时）' : '暂无已加载批次',
        batches: batches.items,
        events: events.items,
        sourceState,
        error: null,
      }
      emit()
    } catch (e) {
      if (disposed || my !== seq) return
      const err = e as { status?: number; code?: string }
      const network = err?.status === 0
      state = {
        status: network ? 'offline' : 'error',
        reason: network ? '无法连接只读数据服务（离线）' : '只读数据服务返回错误',
        batches: [], events: [], sourceState: null,
        error: network ? '无法连接只读数据服务。' : `只读数据服务错误：${err?.code ?? 'unknown'}`,
      }
      emit()
    }
  }

  return {
    get: () => state,
    subscribe: (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    load,
    dispose: () => { disposed = true; seq += 1 },
  }
}
