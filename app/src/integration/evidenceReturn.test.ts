import { describe, expect, it } from 'vitest'
import { createEvidenceReturnStore, type EvidenceReturnSnapshot } from './evidenceReturn'
import { parseHash } from '../domain/router'

const snap = (hash: string): EvidenceReturnSnapshot => ({
  route: parseHash(hash), filter: 'source', selected: 'device:AC03', linked: 'AC03', depth: 2, scrollY: 480, focusId: 'overview-next-compare',
})

describe('M24 B · 证据来源返回 snapshot', () => {
  it('capture/peek/consume：consume 后清空，peek 不消费', () => {
    const s = createEvidenceReturnStore()
    s.capture(snap('#/schedule/overview?mode=legacy&scenario=normal'))
    expect(s.peek()?.selected).toBe('device:AC03')
    expect(s.peek()).not.toBeNull()
    const c = s.consume()
    expect(c?.route.sub).toBe('overview')
    expect(c?.filter).toBe('source')
    expect(c?.scrollY).toBe(480)
    expect(s.peek()).toBeNull()
  })
  it('同页定位：再 capture 覆盖为本次来源状态（非上次）', () => {
    const s = createEvidenceReturnStore()
    s.capture(snap('#/schedule/overview?mode=legacy&scenario=normal'))
    s.capture({ ...snap('#/schedule/evidence?mode=legacy&scenario=normal'), filter: 'all', selected: 'device:AC01' })
    expect(s.consume()?.selected).toBe('device:AC01')
  })
})
