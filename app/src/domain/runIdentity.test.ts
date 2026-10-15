import { describe, expect, it } from 'vitest'
import { computeRunIdentity, RUN_IDENTITY_VERSION, type RunIdentityParts } from './runIdentity'
import { UNITS } from './units'
import { evaluateUnits } from './engine'

const evaluation = evaluateUnits(UNITS, 'normal')

const base: RunIdentityParts = {
  mode: 'legacy',
  persistentRunRef: 'synthetic_schedule:normal:seed=20260929',
  scenario: 'normal',
  ruleVersion: 'qiheng-rules-v0.5.0',
  candidateRef: 'AC-01+AC-02',
  planSignature: 'F|96|plan-A',
  initial: { runningUnitIds: [], minutesSinceChange: {} },
  stepMinutes: 15,
  seed: 20260929,
  points: [
    { minuteOfDay: 0, demand: 12 },
    { minuteOfDay: 15, demand: 15 },
  ],
  units: UNITS,
  eligibility: evaluation.eligibility,
  faultUnitId: null,
}

describe('完整确认身份（run-identity-v2）', () => {
  it('含权威输入签名要素', () => {
    const id = computeRunIdentity(base)
    expect(id).toContain(RUN_IDENTITY_VERSION)
    expect(id).toContain('runRef=synthetic_schedule:normal:seed=20260929')
    expect(id).toContain('rule=qiheng-rules-v0.5.0')
    expect(id).toContain('points=0:12,15:15')
    expect(id).toContain('units=AC-01:')
    expect(id).toContain('eligibility=')
    expect(id).toContain('plan=F|96|plan-A')
  })

  it('同 runRef 同 plan 下 rule / 机组参数 / demand / minuteOfDay / initial 变化都不同', () => {
    const id = computeRunIdentity(base)
    expect(computeRunIdentity({ ...base, ruleVersion: 'other' })).not.toBe(id)

    const heavier = base.units.map((u) =>
      u.id === 'AC-01' ? { ...u, ratedPower: u.ratedPower + 1 } : u,
    )
    expect(computeRunIdentity({ ...base, units: heavier })).not.toBe(id)

    expect(
      computeRunIdentity({
        ...base,
        points: [
          { minuteOfDay: 0, demand: 12.5 },
          { minuteOfDay: 15, demand: 15 },
        ],
      }),
    ).not.toBe(id)

    expect(
      computeRunIdentity({
        ...base,
        points: [
          { minuteOfDay: 30, demand: 12 },
          { minuteOfDay: 15, demand: 15 },
        ],
      }),
    ).not.toBe(id)

    expect(
      computeRunIdentity({
        ...base,
        initial: { runningUnitIds: ['AC-01'], minutesSinceChange: { 'AC-01': 5 } },
      }),
    ).not.toBe(id)
  })

  it('0.00001 级 demand 差异产生不同身份（不四舍五入）', () => {
    const id = computeRunIdentity(base)
    const tiny = computeRunIdentity({
      ...base,
      points: [
        { minuteOfDay: 0, demand: 12.00001 },
        { minuteOfDay: 15, demand: 15 },
      ],
    })
    expect(tiny).not.toBe(id)
    const micro = computeRunIdentity({
      ...base,
      points: [
        { minuteOfDay: 0, demand: 12.00000001 },
        { minuteOfDay: 15, demand: 15 },
      ],
    })
    expect(micro).not.toBe(id)
  })

  it('lab 仍保留完整 lab 身份且外层绑定规则', () => {
    const id = computeRunIdentity({
      ...base,
      mode: 'lab',
      ruleVersion: 'qiheng-rules-v0.5.0',
      labIdentity: 'lab-full-identity',
    })
    expect(id).toContain('lab=lab-full-identity')
    expect(id).toContain('rule=qiheng-rules-v0.5.0')
    expect(id).toContain('mode=lab')
  })

  it('相同输入稳定', () => {
    expect(computeRunIdentity(base)).toBe(computeRunIdentity(base))
  })
})
