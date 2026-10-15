import { describe, expect, it } from 'vitest'
import { buildHistoryFixture } from './history'
import { aggregateQuality, summarizeQuality, type QualityBucket } from './quality'

function getBucket(
  buckets: QualityBucket[],
  machineId: string,
  index: number,
): QualityBucket {
  const bucket = buckets.find(
    (b) => b.machineId === machineId && b.bucketIndex === index,
  )
  if (!bucket) throw new Error(`bucket not found ${machineId} ${index}`)
  return bucket
}

describe('质量门分级', () => {
  it('对照夹具全部通过且功率积分可信', () => {
    const fixture = buildHistoryFixture('fx_clean')
    const buckets = aggregateQuality(fixture)
    expect(buckets.every((b) => b.grade === 'pass')).toBe(true)
    expect(buckets.every((b) => b.energyTrusted)).toBe(true)
  })

  it('缺分钟标为 invalid 并记录缺口', () => {
    const buckets = aggregateQuality(buildHistoryFixture('fx_baseline'))
    const machine = getBucket(buckets, 'C-01', 4)
    const station = getBucket(buckets, 'STATION', 4)
    expect(machine.grade).toBe('invalid')
    expect(machine.reasonCodes).toContain('MINUTE_TIMESTAMP_GAP')
    expect(machine.missingTimestamps).toBe(1)
    expect(machine.missingPowerMinutes).toBe(0)
    expect(machine.validSampleCount).toBe(14)
    expect(machine.energyIntegralKwh).toBeNull()
    expect(station.grade).toBe('invalid')
  })

  it('功率缺值标为 invalid 且完整桶能量为未知（不填零）', () => {
    const buckets = aggregateQuality(buildHistoryFixture('fx_baseline'))
    const bucket = getBucket(buckets, 'C-01', 6)
    expect(bucket.grade).toBe('invalid')
    expect(bucket.reasonCodes).toContain('MISSING_POWER')
    expect(bucket.validSampleCount).toBe(0)
    // 缺时间点 0、功率缺值 15 必须分开
    expect(bucket.missingTimestamps).toBe(0)
    expect(bucket.missingPowerMinutes).toBe(15)
    expect(bucket.powerCoveredMinutes).toBe(0)
    // 空集求和不等于观测到零耗电：完整桶能量必须为 null
    expect(bucket.energyIntegralKwh).toBeNull()
    expect(bucket.observedPartialEnergyKwh).toBe(0)
    expect(bucket.energyTrusted).toBe(false)
  })

  it('仅 1/15 分钟功率缺失时完整桶能量仍为未知', () => {
    const fixture = buildHistoryFixture('fx_clean')
    const one = fixture.samples.find(
      (s) => s.machineId === 'C-01' && s.minuteIndex === 0,
    )
    if (!one) throw new Error('sample not found')
    one.power = null
    const bucket = getBucket(aggregateQuality(fixture), 'C-01', 0)
    expect(bucket.missingPowerMinutes).toBe(1)
    expect(bucket.powerCoveredMinutes).toBe(14)
    expect(bucket.energyIntegralKwh).toBeNull()
  })

  it('真实观测到的全零功率积分为 0（不误判缺值）', () => {
    const fixture = buildHistoryFixture('fx_clean')
    for (const s of fixture.samples) {
      if (s.machineId === 'C-01' && s.minuteIndex < 15) s.power = 0
    }
    const bucket = getBucket(aggregateQuality(fixture), 'C-01', 0)
    expect(bucket.missingPowerMinutes).toBe(0)
    expect(bucket.energyIntegralKwh).toBe(0)
  })

  it('压力缺值标为 invalid', () => {
    const buckets = aggregateQuality(buildHistoryFixture('fx_gap_heavy'))
    const bucket = getBucket(buckets, 'C-02', 7)
    expect(bucket.grade).toBe('invalid')
    expect(bucket.reasonCodes).toContain('MISSING_PRESSURE')
  })

  it('零压力却有流量标为 review', () => {
    const buckets = aggregateQuality(buildHistoryFixture('fx_baseline'))
    const bucket = getBucket(buckets, 'C-01', 8)
    expect(bucket.grade).toBe('review')
    expect(bucket.reasonCodes).toContain('ZERO_PRESSURE_WITH_FLOW')
  })

  it('流量恒等式不符标为 review', () => {
    const buckets = aggregateQuality(buildHistoryFixture('fx_baseline'))
    const station = getBucket(buckets, 'STATION', 10)
    expect(station.grade).toBe('review')
    expect(station.reasonCodes).toContain('FLOW_IDENTITY_MISMATCH')
  })

  it('超档案额定总流量标为 review', () => {
    const buckets = aggregateQuality(buildHistoryFixture('fx_baseline'))
    const station = getBucket(buckets, 'STATION', 12)
    expect(station.grade).toBe('review')
    expect(station.reasonCodes).toContain('FLOW_OVER_RATED_TOTAL')
    const machine = getBucket(buckets, 'C-01', 12)
    expect(machine.grade).toBe('pass')
  })

  it('未知运行状态标为 review', () => {
    const buckets = aggregateQuality(buildHistoryFixture('fx_baseline'))
    const bucket = getBucket(buckets, 'C-02', 14)
    expect(bucket.grade).toBe('review')
    expect(bucket.reasonCodes).toContain('UNKNOWN_RUNNING_STATE')
  })

  it('review/invalid 不混入可信功率积分', () => {
    const summary = summarizeQuality(aggregateQuality(buildHistoryFixture('fx_baseline')))
    expect(summary.invalid).toBeGreaterThan(0)
    expect(summary.review).toBeGreaterThan(0)
    expect(summary.energyIntegralTrustedKwh).toBeLessThan(
      summary.observedPartialEnergyKwh,
    )
    expect(summary.observedCoveredMinutes).toBeLessThan(
      summary.observedExpectedMinutes,
    )
    expect(summary.excludedFromRates).toBe(summary.review + summary.invalid)
  })

  it('相同夹具与种子聚合结果一致', () => {
    const a = aggregateQuality(buildHistoryFixture('fx_baseline'))
    const b = aggregateQuality(buildHistoryFixture('fx_baseline'))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})