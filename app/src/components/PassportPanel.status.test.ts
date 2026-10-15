import { describe, expect, it } from 'vitest'
import { statusTone } from './PassportPanel'
import type { PassportCandidateRecord } from '../domain/passport'

const rec = (evaluated: boolean, ok: boolean) => ({ verification: { evaluated, ok } } as unknown as PassportCandidateRecord)

describe('M26 · 护照候选状态 tone（未运行/无解不绿，复验未通过 severe）', () => {
  it('未运行/无解 → unknown（不绿）', () => {
    expect(statusTone(rec(false, false))).toBe('unknown')
    expect(statusTone(rec(false, true))).toBe('unknown')
  })
  it('复验通过 → normal（仅该项复验，不等执行）；复验未通过 → severe', () => {
    expect(statusTone(rec(true, true))).toBe('normal')
    expect(statusTone(rec(true, false))).toBe('severe')
  })
})
