import { describe, expect, it } from 'vitest'
import { consoleDataBus } from './consoleDataBus'

describe('M10 r02 consoleDataBus refresh bridge', () => {
  it('requestRefresh invokes registered refresher once; unregister works', () => {
    let n = 0
    const off = consoleDataBus.registerRefresh(() => { n += 1 })
    consoleDataBus.requestRefresh()
    expect(n).toBe(1)
    off()
    consoleDataBus.requestRefresh()
    expect(n).toBe(1)
  })
})
