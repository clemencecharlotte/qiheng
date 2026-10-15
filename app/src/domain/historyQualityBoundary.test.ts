import { describe, expect, it } from 'vitest'
import { buildHistoryFixture } from './history'
import {
  SYNTHETIC_HISTORY_UNITS,
  isFiniteNonNegative,
  validateHistoryFixture,
} from './historyQualityBoundary'
import { aggregateQuality, summarizeQuality } from './quality'

function clone<T>(v: T): T {
  return structuredClone(v)
}
function codesAt(f: ReturnType<typeof buildHistoryFixture>, i: number): string[] {
  const rep = validateHistoryFixture(f)
  return rep.sampleIssues.find((x) => x.sampleIndex === i)?.codes ?? []
}

describe('B05b2 边界：缺键/非有限/负值/真实0', () => {
  it('fx_clean 边界通过', () => {
    expect(validateHistoryFixture(buildHistoryFixture('fx_clean')).ok).toBe(true)
  })

  it('null flow / 缺 flow 键 / 缺字段', () => {
    const f = clone(buildHistoryFixture('fx_clean'))
    f.samples[0].flow = null
    expect(codesAt(f, 0)).toContain('MISSING_FLOW')
    const g = clone(buildHistoryFixture('fx_clean'))
    delete (g.samples[0] as { flow?: unknown }).flow
    expect(codesAt(g, 0)).toContain('MISSING_FIELD')
  })

  it('NaN / Infinity / 负值', () => {
    const f = clone(buildHistoryFixture('fx_clean'))
    f.samples[0].power = NaN
    f.samples[1].flow = Infinity
    f.samples[2].pressure = -1
    expect(codesAt(f, 0)).toContain('NON_FINITE_VALUE')
    expect(codesAt(f, 1)).toContain('NON_FINITE_VALUE')
    expect(codesAt(f, 2)).toContain('NEGATIVE_VALUE')
    expect(isFiniteNonNegative(0)).toBe(true)
    expect(isFiniteNonNegative(NaN)).toBe(false)
    expect(isFiniteNonNegative(-1)).toBe(false)
    expect(isFiniteNonNegative(null)).toBe(false)
  })

  it('未知机组 / 重复 / 错序 / 时间不一致 / 越窗', () => {
    const f = clone(buildHistoryFixture('fx_clean'))
    f.samples[0].machineId = 'C-99'
    expect(validateHistoryFixture(f).fixtureInvalid).toBe(true)
    expect(codesAt(f, 0)).toContain('UNKNOWN_MACHINE')

    const dup = clone(buildHistoryFixture('fx_clean'))
    dup.samples.push(clone(dup.samples[0]))
    expect(codesAt(dup, dup.samples.length - 1)).toContain('DUPLICATE_SAMPLE')

    const order = clone(buildHistoryFixture('fx_clean'))
    const a = order.samples[0].minuteIndex
    order.samples[0] = { ...order.samples[0], minuteIndex: order.samples[1].minuteIndex }
    expect(validateHistoryFixture(order).sampleIssues.some((x) => x.codes.includes('BAD_TIMESTAMP'))).toBe(true)
    void a

    const mi = clone(buildHistoryFixture('fx_clean'))
    mi.samples[0].minuteOfDay = 12345
    expect(codesAt(mi, 0)).toContain('MINUTE_INCONSISTENT')

    const oob = clone(buildHistoryFixture('fx_clean'))
    oob.samples[0].minuteIndex = 999
    expect(codesAt(oob, 0)).toContain('BAD_TIMESTAMP')
  })

  it('单位冲突拒绝（未知/冲突），canonical 通过', () => {
    const f = buildHistoryFixture('fx_clean')
    expect(validateHistoryFixture(f, { units: SYNTHETIC_HISTORY_UNITS }).ok).toBe(true)
    const bad = { ...SYNTHETIC_HISTORY_UNITS, pressure: 'bar' as unknown as 'MPa' }
    const rep = validateHistoryFixture(f, { units: bad })
    expect(rep.fixtureInvalid).toBe(true)
    expect(rep.fixtureReasons).toContain('UNIT_MISMATCH')
  })
})

describe('B05b2 边界：站级唯一覆盖与积分分母', () => {
  it('两条同机冒充站覆盖 → 站桶 invalid、不补 0 完整', () => {
    const f = clone(buildHistoryFixture('fx_clean'))
    // 桶0 的 C-02 样本全部改成 C-01 → 每分钟 C-01 重复、C-02 缺失
    for (const s of f.samples) {
      if (s.minuteIndex < 15 && s.machineId === "C-02") {
        // 保持 minuteIndex 但冒充 C-01
        ;(s as { machineId: string }).machineId = 'C-01'
      }
    }
    const station = aggregateQuality(f).find((b) => b.machineId === 'STATION' && b.bucketIndex === 0)!
    expect(station.grade).toBe('invalid')
    expect(station.reasonCodes).toContain('DUPLICATE_SAMPLE')
    expect(station.energyIntegralKwh).toBeNull()
    // 缺 C-02 的唯一覆盖 → 不是 15 完整分钟
    expect(station.missingTimestamps).toBeGreaterThan(0)
  })

  it('真实 0 功率为有效、缺功率 null 完整桶能量 null 且排除分母', () => {
    const f = clone(buildHistoryFixture('fx_clean'))
    for (const s of f.samples) if (s.machineId === 'C-01' && s.minuteIndex < 15) s.power = 0
    const m0 = aggregateQuality(f).find((b) => b.machineId === 'C-01' && b.bucketIndex === 0)!
    expect(m0.missingPowerMinutes).toBe(0)
    expect(m0.energyIntegralKwh).toBe(0)
    expect(m0.grade).toBe('pass')

    const g = clone(buildHistoryFixture('fx_clean'))
    for (const s of g.samples) if (s.machineId === 'C-01' && s.minuteIndex < 15) s.power = null
    const buckets = aggregateQuality(g)
    const m = buckets.find((b) => b.machineId === 'C-01' && b.bucketIndex === 0)!
    expect(m.energyIntegralKwh).toBeNull()
    expect(m.observedPartialEnergyKwh).toBe(0)
    const summary = summarizeQuality(buckets)
    expect(Number.isFinite(summary.energyIntegralTrustedKwh)).toBe(true)
    expect(summary.excludedFromRates).toBe(summary.review + summary.invalid)
    for (const k of ['pass', 'review', 'invalid'] as const) expect(summary[k]).toBeGreaterThanOrEqual(0)
  })
})
