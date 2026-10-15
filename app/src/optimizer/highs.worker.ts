/// <reference lib="webworker" />
import loadHighs, { type Highs } from 'highs'
import wasmUrl from 'highs/runtime?url'
import { solveFlowMilp, type FlowMilpInput } from '../domain/optimizer/flowMilp'

/**
 * 单线程 WASM Worker（不设 COOP/COEP）。同源打包 WASM，无运行时 CDN。
 * 主线程以 requestId 隔离，watchdog 超时用 terminate 取消。
 */
let highsPromise: Promise<Highs> | null = null

self.onmessage = async (event: MessageEvent) => {
  const data = event.data as { requestId: string; input: FlowMilpInput }
  const { requestId, input } = data
  try {
    if (!highsPromise) {
      highsPromise = loadHighs({ locateFile: () => wasmUrl })
    }
    const highs = await highsPromise
    const result = await solveFlowMilp(input, () => Promise.resolve(highs))
    ;(self as unknown as Worker).postMessage({ requestId, ok: true, result })
  } catch (error) {
    ;(self as unknown as Worker).postMessage({
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : '求解 Worker 异常',
    })
  }
}
