import {
  BUCKET_MINUTES,
  HISTORY_MACHINES,
  HISTORY_TOTAL_ARCHIVE_RATED_FLOW,
  bucketLabel,
  type HistoryFixture,
  type MinuteSample,
} from './history'
import { round } from './prng'
import {
  BOUNDARY_CODE_META,
  isFiniteNonNegative,
  validateHistoryFixture,
  type BoundaryCode,
  type ValidateOptions,
} from './historyQualityBoundary'

export type QualityGrade = 'pass' | 'review' | 'invalid'

export type ReasonCode =
  | 'MINUTE_TIMESTAMP_GAP'
  | 'MISSING_POWER'
  | 'MISSING_PRESSURE'
  | 'ZERO_PRESSURE_WITH_FLOW'
  | 'UNKNOWN_RUNNING_STATE'
  | 'FLOW_IDENTITY_MISMATCH'
  | 'FLOW_OVER_RATED_TOTAL'
  | 'PASS'
  | BoundaryCode

export type ReasonSeverity = 'invalid' | 'review' | 'info'

export const REASON_CODE_META: Record<
  ReasonCode,
  { label: string; severity: ReasonSeverity }
> = {
  MINUTE_TIMESTAMP_GAP: { label: '分钟时间不齐 / 缺分钟', severity: 'invalid' },
  MISSING_POWER: { label: '功率缺值', severity: 'invalid' },
  MISSING_PRESSURE: { label: '压力缺值', severity: 'invalid' },
  ZERO_PRESSURE_WITH_FLOW: { label: '零压力却有流量', severity: 'review' },
  UNKNOWN_RUNNING_STATE: { label: '未知运行状态', severity: 'review' },
  FLOW_IDENTITY_MISMATCH: { label: '流量恒等式不符', severity: 'review' },
  FLOW_OVER_RATED_TOTAL: { label: '超档案额定总流量', severity: 'review' },
  PASS: { label: '通过', severity: 'info' },
  MISSING_FIELD: { label: BOUNDARY_CODE_META.MISSING_FIELD.label, severity: 'invalid' },
  NON_FINITE_VALUE: { label: BOUNDARY_CODE_META.NON_FINITE_VALUE.label, severity: 'invalid' },
  NEGATIVE_VALUE: { label: BOUNDARY_CODE_META.NEGATIVE_VALUE.label, severity: 'invalid' },
  BAD_TIMESTAMP: { label: BOUNDARY_CODE_META.BAD_TIMESTAMP.label, severity: 'invalid' },
  DUPLICATE_SAMPLE: { label: BOUNDARY_CODE_META.DUPLICATE_SAMPLE.label, severity: 'invalid' },
  UNKNOWN_MACHINE: { label: BOUNDARY_CODE_META.UNKNOWN_MACHINE.label, severity: 'invalid' },
  MINUTE_INCONSISTENT: { label: BOUNDARY_CODE_META.MINUTE_INCONSISTENT.label, severity: 'invalid' },
  MISSING_FLOW: { label: BOUNDARY_CODE_META.MISSING_FLOW.label, severity: 'invalid' },
  UNIT_MISMATCH: { label: BOUNDARY_CODE_META.UNIT_MISMATCH.label, severity: 'invalid' },
  FIXTURE_INVALID: { label: BOUNDARY_CODE_META.FIXTURE_INVALID.label, severity: 'invalid' },
}

export const STATION_ID = 'STATION'

export interface QualityBucket {
  bucketIndex: number
  bucketLabel: string
  machineId: string
  grade: QualityGrade
  reasonCodes: ReasonCode[]
  expectedMinutes: number
  presentMinutes: number
  validSampleCount: number
  missingTimestamps: number
  missingPowerMinutes: number
  powerCoveredMinutes: number
  energyIntegralKwh: number | null
  observedPartialEnergyKwh: number
  energyTrusted: boolean
  sampleKeys: string[]
}

function gradeFromReasons(reasons: Set<ReasonCode>): QualityGrade {
  const severe = [...reasons].some((c) => REASON_CODE_META[c].severity === 'invalid')
  if (severe) return 'invalid'
  const review = [...reasons].some((c) => REASON_CODE_META[c].severity === 'review')
  return review ? 'review' : 'pass'
}

function codesToReasons(reasons: Set<ReasonCode>, codes: BoundaryCode[]): void {
  for (const c of codes) reasons.add(c)
}

function buildBucket(args: {
  bucketIndex: number
  machineId: string
  expectedMinutes: number
  presentMinutes: number
  missingTimestamps: number
  missingPowerMinutes: number
  powerCoveredMinutes: number
  validSampleCount: number
  observedPartialEnergyKwh: number
  reasons: Set<ReasonCode>
  sampleKeys: string[]
}): QualityBucket {
  const codes = args.reasons.size === 0 ? (['PASS'] as ReasonCode[]) : [...args.reasons]
  const grade = gradeFromReasons(args.reasons)
  const complete = args.missingTimestamps === 0 && args.missingPowerMinutes === 0
  const observed = Number.isFinite(args.observedPartialEnergyKwh) ? args.observedPartialEnergyKwh : 0
  return {
    bucketIndex: args.bucketIndex,
    bucketLabel: bucketLabel(args.bucketIndex),
    machineId: args.machineId,
    grade,
    reasonCodes: codes,
    expectedMinutes: args.expectedMinutes,
    presentMinutes: args.presentMinutes,
    validSampleCount: args.validSampleCount,
    missingTimestamps: args.missingTimestamps,
    missingPowerMinutes: args.missingPowerMinutes,
    powerCoveredMinutes: args.powerCoveredMinutes,
    energyIntegralKwh: complete ? round(observed, 3) : null,
    observedPartialEnergyKwh: round(observed, 3),
    energyTrusted: grade === 'pass',
    sampleKeys: args.sampleKeys,
  }
}

export function formatBucketEnergy(bucket: QualityBucket): string {
  if (bucket.energyIntegralKwh === null) {
    return `未知（不可完整积分；功率覆盖 ${bucket.powerCoveredMinutes}/${bucket.expectedMinutes} 分钟，观测部分积分 ${bucket.observedPartialEnergyKwh.toFixed(3)} kWh）`
  }
  return `${bucket.energyIntegralKwh.toFixed(3)} kWh`
}

function issueCodesByIndex(issues: Array<{ sampleIndex: number; codes: BoundaryCode[] }>): Map<number, BoundaryCode[]> {
  const map = new Map<number, BoundaryCode[]>()
  for (const it of issues) map.set(it.sampleIndex, it.codes)
  return map
}

function aggregateMachineBucket(
  fixture: HistoryFixture,
  machineId: string,
  bucketIndex: number,
  issueByIndex: Map<number, BoundaryCode[]>,
  fixtureInvalid: boolean,
): QualityBucket {
  const start = bucketIndex * BUCKET_MINUTES
  const end = start + BUCKET_MINUTES
  const reasons = new Set<ReasonCode>()
  if (fixtureInvalid) reasons.add('FIXTURE_INVALID')

  const byMinute = new Map<number, MinuteSample[]>()
  const sampleKeys: string[] = []
  for (let i = 0; i < fixture.samples.length; i += 1) {
    const s = fixture.samples[i]
    if (s.machineId !== machineId) continue
    if (!isFiniteNonNegative(s.minuteIndex) || s.minuteIndex < start || s.minuteIndex >= end) continue
    const list = byMinute.get(s.minuteIndex) ?? []
    list.push(s)
    byMinute.set(s.minuteIndex, list)
    sampleKeys.push(`${s.machineId}:${s.minuteIndex}`)
    const codes = issueByIndex.get(i)
    if (codes) codesToReasons(reasons, codes)
  }

  let missingPowerMinutes = 0
  let validSampleCount = 0
  let observedPartialEnergyKwh = 0
  let duplicate = false

  for (const [, list] of byMinute) {
    if (list.length > 1) duplicate = true
    const s = list[0]
    if (!s) continue
    if (!isFiniteNonNegative(s.power)) {
      missingPowerMinutes += 1
    } else {
      observedPartialEnergyKwh += s.power / 60
    }
    const valid =
      s.state !== 'unknown' &&
      isFiniteNonNegative(s.flow) &&
      isFiniteNonNegative(s.pressure) &&
      isFiniteNonNegative(s.power)
    if (valid) validSampleCount += 1
    if (s.power === null || s.power === undefined) reasons.add('MISSING_POWER')
    if (s.pressure === null || s.pressure === undefined) reasons.add('MISSING_PRESSURE')
    if (s.flow === null || s.flow === undefined) reasons.add('MISSING_FLOW')
    if (s.state === 'running' && s.pressure === 0 && isFiniteNonNegative(s.flow) && s.flow > 0) reasons.add('ZERO_PRESSURE_WITH_FLOW')
    if (s.state === 'unknown') reasons.add('UNKNOWN_RUNNING_STATE')
  }
  if (duplicate) reasons.add('DUPLICATE_SAMPLE')
  const uniqueMinutes = byMinute.size
  if (uniqueMinutes !== BUCKET_MINUTES) reasons.add('MINUTE_TIMESTAMP_GAP')
  // 存在重复时按唯一分钟缺失口径不重复计数
  const missingTimestamps = Math.max(0, BUCKET_MINUTES - uniqueMinutes)
  const powerCoveredMinutes = Math.max(0, uniqueMinutes - missingPowerMinutes)

  return buildBucket({
    bucketIndex,
    machineId,
    expectedMinutes: BUCKET_MINUTES,
    presentMinutes: uniqueMinutes,
    missingTimestamps,
    missingPowerMinutes,
    powerCoveredMinutes,
    validSampleCount,
    observedPartialEnergyKwh,
    reasons,
    sampleKeys,
  })
}

function aggregateStationBucket(
  fixture: HistoryFixture,
  bucketIndex: number,
  issueByIndex: Map<number, BoundaryCode[]>,
  fixtureInvalid: boolean,
): QualityBucket {
  const start = bucketIndex * BUCKET_MINUTES
  const end = start + BUCKET_MINUTES
  const machineIds = HISTORY_MACHINES.map((m) => m.id)
  const known = new Set(machineIds)
  const byMinute = new Map<number, MinuteSample[]>()
  for (let i = 0; i < fixture.samples.length; i += 1) {
    const s = fixture.samples[i]
    if (!isFiniteNonNegative(s.minuteIndex) || s.minuteIndex < start || s.minuteIndex >= end) continue
    const list = byMinute.get(s.minuteIndex) ?? []
    list.push(s)
    byMinute.set(s.minuteIndex, list)
  }

  const reasons = new Set<ReasonCode>()
  if (fixtureInvalid) reasons.add('FIXTURE_INVALID')
  let completeMinutes = 0
  let validSampleCount = 0
  let missingPowerMinutes = 0
  let observedPartialEnergyKwh = 0
  let sampleIndexSeen = 0

  for (const [, samples] of byMinute) {
    // 边界问题（按样本索引挂到桶）
    for (const s of samples) {
      const idx = fixture.samples.indexOf(s)
      const codes = issueByIndex.get(idx === -1 ? sampleIndexSeen : idx)
      if (codes) codesToReasons(reasons, codes)
      sampleIndexSeen += 1
    }
    const uniqueIds = new Set(samples.map((s) => s.machineId))
    if (samples.length !== uniqueIds.size) reasons.add('DUPLICATE_SAMPLE')
    const unknown = samples.some((s) => !known.has(s.machineId))
    if (unknown) reasons.add('UNKNOWN_MACHINE')
    const idsAllUnique = uniqueIds.size === machineIds.length && samples.length === machineIds.length
    if (!idsAllUnique) {
      reasons.add('MINUTE_TIMESTAMP_GAP')
      // 观测部分仅累计有限有效功率；不补 0 造完整
      for (const s of samples) if (isFiniteNonNegative(s.power)) observedPartialEnergyKwh += s.power / 60
      continue
    }
    // 完整性：stationTotalFlow 有限非负且两机一致；flow/pressure/power 有限非负
    const totals = samples.map((s) => s.stationTotalFlow)
    const totalsFinite = totals.every((t) => isFiniteNonNegative(t))
    const flowsFinite = samples.every((s) => isFiniteNonNegative(s.flow))
    if (!totalsFinite) {
      reasons.add('MINUTE_TIMESTAMP_GAP')
      for (const s of samples) if (isFiniteNonNegative(s.power)) observedPartialEnergyKwh += s.power / 60
      continue
    }
    const totalSet = new Set(totals as number[])
    if (totalSet.size > 1) reasons.add('FLOW_IDENTITY_MISMATCH')
    if (!flowsFinite) reasons.add('MISSING_FLOW')

    completeMinutes += 1
    const allValid =
      samples.every(
        (s) =>
          s.state !== 'unknown' &&
          isFiniteNonNegative(s.flow) &&
          isFiniteNonNegative(s.pressure) &&
          isFiniteNonNegative(s.power),
      )
    if (allValid) validSampleCount += 1
    if (samples.some((s) => !isFiniteNonNegative(s.power))) {
      reasons.add('MISSING_POWER')
      missingPowerMinutes += 1
    }
    if (samples.some((s) => s.pressure === null || s.pressure === undefined)) reasons.add('MISSING_PRESSURE')
    if (samples.some((s) => s.state === 'running' && s.pressure === 0 && isFiniteNonNegative(s.flow) && s.flow > 0))
      reasons.add('ZERO_PRESSURE_WITH_FLOW')
    if (samples.some((s) => s.state === 'unknown')) reasons.add('UNKNOWN_RUNNING_STATE')

    for (const s of samples) if (isFiniteNonNegative(s.power)) observedPartialEnergyKwh += s.power / 60

    const flowSum = samples.reduce((acc, s) => acc + (isFiniteNonNegative(s.flow) ? s.flow : 0), 0)
    const total = (totals[0] as number)
    if (flowsFinite) {
      const tolerance = Math.max(0.5, 0.05 * Math.max(flowSum, total))
      if (Math.abs(flowSum - total) > tolerance) reasons.add('FLOW_IDENTITY_MISMATCH')
    }
    if (flowSum > HISTORY_TOTAL_ARCHIVE_RATED_FLOW + 0.001) reasons.add('FLOW_OVER_RATED_TOTAL')
  }

  if (completeMinutes !== BUCKET_MINUTES) reasons.add('MINUTE_TIMESTAMP_GAP')
  const missingTimestamps = Math.max(0, BUCKET_MINUTES - completeMinutes)
  const powerCoveredMinutes = Math.max(0, completeMinutes - missingPowerMinutes)
  return buildBucket({
    bucketIndex,
    machineId: STATION_ID,
    expectedMinutes: BUCKET_MINUTES,
    presentMinutes: completeMinutes,
    missingTimestamps,
    missingPowerMinutes,
    powerCoveredMinutes,
    validSampleCount,
    observedPartialEnergyKwh,
    reasons,
    sampleKeys: [...byMinute.entries()].filter(([, s]) => s.length > 0).map(([m]) => `${STATION_ID}:${m}`),
  })
}

export function aggregateQuality(fixture: HistoryFixture, opts: ValidateOptions = {}): QualityBucket[] {
  const report = validateHistoryFixture(fixture, opts)
  const issueByIndex = issueCodesByIndex(report.sampleIssues)
  const fixtureInvalid = report.fixtureInvalid || report.fixtureReasons.length > 0
  const buckets: QualityBucket[] = []
  for (let b = 0; b < fixture.bucketCount; b += 1) {
    for (const machine of HISTORY_MACHINES) {
      buckets.push(aggregateMachineBucket(fixture, machine.id, b, issueByIndex, fixtureInvalid))
    }
    buckets.push(aggregateStationBucket(fixture, b, issueByIndex, fixtureInvalid))
  }
  return buckets
}

export function bucketsForMachine(
  buckets: QualityBucket[],
  machineId: string,
): QualityBucket[] {
  return buckets.filter((b) => b.machineId === machineId)
}

export interface QualitySummary {
  total: number
  pass: number
  review: number
  invalid: number
  energyIntegralTrustedKwh: number
  observedPartialEnergyKwh: number
  observedCoveredMinutes: number
  observedExpectedMinutes: number
  excludedFromRates: number
}

export function summarizeQuality(buckets: QualityBucket[]): QualitySummary {
  const summary: QualitySummary = {
    total: buckets.length,
    pass: 0,
    review: 0,
    invalid: 0,
    energyIntegralTrustedKwh: 0,
    observedPartialEnergyKwh: 0,
    observedCoveredMinutes: 0,
    observedExpectedMinutes: 0,
    excludedFromRates: 0,
  }
  for (const b of buckets) {
    summary[b.grade] += 1
    if (Number.isFinite(b.observedPartialEnergyKwh)) summary.observedPartialEnergyKwh += b.observedPartialEnergyKwh
    summary.observedCoveredMinutes += Math.max(0, b.powerCoveredMinutes)
    summary.observedExpectedMinutes += Math.max(0, b.expectedMinutes)
    if (b.energyTrusted && b.energyIntegralKwh !== null && Number.isFinite(b.energyIntegralKwh)) {
      summary.energyIntegralTrustedKwh += b.energyIntegralKwh
    } else {
      summary.excludedFromRates += 1
    }
  }
  summary.energyIntegralTrustedKwh = round(summary.energyIntegralTrustedKwh, 3)
  summary.observedPartialEnergyKwh = round(summary.observedPartialEnergyKwh, 3)
  return summary
}

export function worstGrade(buckets: QualityBucket[]): QualityGrade {
  if (buckets.some((b) => b.grade === 'invalid')) return 'invalid'
  if (buckets.some((b) => b.grade === 'review')) return 'review'
  return 'pass'
}
