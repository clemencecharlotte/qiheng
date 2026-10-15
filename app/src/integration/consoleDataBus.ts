/**
 * 气衡 M10 · 控制台已加载数据总线（模块级只读快照）。
 * ConnectionState 拉取后发布；CommandPalette 的“已加载范围”条目与消息弹层消费。
 * 不含命令副作用、不含鉴权；仅反映“当前已加载范围”，非全库搜索。
 */
import type { ConsoleDataState } from './consoleData'

let snapshot: ConsoleDataState | null = null
const listeners = new Set<() => void>()
const refreshers = new Set<() => void>()

export const consoleDataBus = {
  get: (): ConsoleDataState | null => snapshot,
  subscribe: (cb: () => void) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  publish: (next: ConsoleDataState) => {
    snapshot = next
    listeners.forEach((l) => l())
  },
  /** ConnectionState 注册其 load；导入成功等写操作后请求只读刷新（薄桥，POST 仍只一次）。 */
  registerRefresh: (fn: () => void) => {
    refreshers.add(fn)
    return () => refreshers.delete(fn)
  },
  requestRefresh: () => {
    refreshers.forEach((f) => f())
  },
}
