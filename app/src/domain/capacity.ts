import type { ScenarioRun } from './engine'

/**
 * 供气缺口（容量下界）说明。
 *
 * 只从同一 run 的真实需求序列与合法自动调度候选独立计算：
 * 逐桶容量上限 = Σ 安全可用候选额定供气；缺口 = max(0, 需求 − 上限)。
 * 这是合成输入的容量下界必要条件，不是已执行供气、现场负荷削减、压力预测
 * 或失败计划的收益；无完整方案时能量等指标仍为 null。
 */

export interface CapacityGapBucket {
  index: number
  label: string
  demand: number
  availableCapacity: number
  gap: number
}

export interface ExcludedCandidate {
  unitId: string
  name: string
  reason: string
}

export interface SupplyGap {
  sourceId: 'synthetic_schedule'
  candidates: string[]
  excluded: ExcludedCandidate[]
  /** 当前场景安全可用候选额定供气合计（m³/min）。 */
  availableCapacity: number
  buckets: CapacityGapBucket[]
  gapBucketCount: number
  peakGap: number
  peakGapLabel: string | null
  /** 缺口体积 = Σ 缺口 × 步长分钟（m³，合成输入下界）。 */
  gapVolumeM3: number
  planFeasible: boolean
  /** 必要条件成立：即使全部安全可用候选满载，仍有逐桶缺口。 */
  capacityInsufficient: boolean
  title: string
  statement: string
  note: string
}

const EPS = 1e-6

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function analyzeSupplyGap(run: ScenarioRun): SupplyGap {
  const candidates = run.evaluation.candidates
  const availableCapacity = candidates.reduce((s, u) => s + u.ratedCapacity, 0)
  const candidateIds = new Set(candidates.map((u) => u.id))

  const excluded: ExcludedCandidate[] = run.evaluation.eligibility
    .filter((e) => !e.eligible)
    .map((e) => {
      const unit = run.allUnits.find((u) => u.id === e.unitId)
      return {
        unitId: e.unitId,
        name: unit?.name ?? e.unitId,
        reason: e.reason ?? '未纳入自动调度候选。',
      }
    })

  const buckets: CapacityGapBucket[] = run.series.points.map((p) => {
    const gap = Math.max(0, p.demand - availableCapacity)
    return {
      index: p.index,
      label: p.label,
      demand: p.demand,
      availableCapacity,
      gap: round3(gap),
    }
  })

  const gapBuckets = buckets.filter((b) => b.gap > EPS)
  const peak = gapBuckets.reduce<CapacityGapBucket | null>(
    (best, b) => (best === null || b.gap > best.gap ? b : best),
    null,
  )
  const gapVolumeM3 = round3(
    gapBuckets.reduce((s, b) => s + b.gap, 0) * run.series.stepMinutes,
  )
  const capacityInsufficient = gapBuckets.length > 0
  const planFeasible = run.recommendation.feasible && run.recommendation.periods.length > 0

  const lockEvidence = run.recommendation.infeasiblePeriods.some((p) =>
    p.reason.includes('启停间隔'),
  )

  const capText = availableCapacity.toFixed(1)
  const peakText = peak ? peak.gap.toFixed(1) : '0.0'
  const peakLabel = peak?.label ?? '—'
  const lockText = lockEvidence
    ? '启停间隔锁定在无解时段中有证据，可作为单独原因列出。'
    : ''

  let title: string
  let statement: string
  if (!planFeasible && capacityInsufficient) {
    title = '安全可用容量不足'
    statement =
      `安全可用候选（${candidateIds.size} 台，AC-03 喘振边界未核实已排除）合计额定供气 ${capText} m³/min；` +
      `需求在 ${gapBuckets.length} 个时段超过该上限，峰值缺口 ${peakText} m³/min（${peakLabel}），` +
      `缺口体积下界约 ${gapVolumeM3.toFixed(1)} m³。` +
      '因此“未找到完整方案”的必要条件——安全可用容量不足——成立。'
  } else if (!planFeasible) {
    title = '当前策略未找到完整方案'
    statement =
      `安全可用候选合计额定供气 ${capText} m³/min，逐桶需求未超过该容量上限（无容量缺口）；` +
      '因此“未找到完整方案”不能归因为安全可用容量不足，保留“当前策略未找到完整方案”的表述。' +
      lockText
  } else {
    title = '容量下界满足'
    statement = `安全可用候选合计额定供气 ${capText} m³/min，当前存在完整方案，逐桶需求未出现容量缺口。`
  }

  const note =
    '以上为合成输入的容量下界说明：逐桶需求 − 安全可用候选额定容量上限，属必要条件推导；不是已执行供气、现场负荷削减、压力预测或失败计划收益。无完整方案时能量等指标仍为 null，不填 0。'

  return {
    sourceId: 'synthetic_schedule',
    candidates: candidates.map((u) => u.id),
    excluded,
    availableCapacity,
    buckets,
    gapBucketCount: gapBuckets.length,
    peakGap: peak ? peak.gap : 0,
    peakGapLabel: peak ? peak.label : null,
    gapVolumeM3,
    planFeasible,
    capacityInsufficient,
    title,
    statement,
    note,
  }
}
