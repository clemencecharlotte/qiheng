import { describe, expect, it } from 'vitest'
import { RELATION_BUDGET, RELATION_EVIDENCE_KEYS, RELATION_OBJECT_KINDS } from './evidenceContract'

describe('M12 r02 R6/M13 数据合同', () => {
  it('本片已落地对象仅 source/batch/event；其余标 landed=false（不冒称完整图）', () => {
    const landed = RELATION_OBJECT_KINDS.filter((k) => RELATION_EVIDENCE_KEYS[k].landed)
    expect(landed).toEqual(['source', 'batch', 'event'])
    expect(RELATION_OBJECT_KINDS).toContain('device')
    expect(RELATION_OBJECT_KINDS).toContain('verification')
    expect(RELATION_EVIDENCE_KEYS.execution.landed).toBe(false)
  })

  it('预算确定性 12–18 节点、depth 1–2', () => {
    expect(RELATION_BUDGET.maxNodes).toBeGreaterThanOrEqual(12)
    expect(RELATION_BUDGET.maxNodes).toBeLessThanOrEqual(18)
    expect(RELATION_BUDGET.minDepth).toBe(1)
    expect(RELATION_BUDGET.maxDepth).toBe(2)
  })
})
