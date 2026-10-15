import type { DecisionChainResult, HistoryReviewResult } from './chain'
import type { ScenarioRun } from './engine'
import type { HealthFinding } from './health'
import {
  formatBucketEnergy,
  REASON_CODE_META,
  STATION_ID,
  type QualityBucket,
} from './quality'
import { BUCKET_MINUTES, HISTORY_START_MINUTE } from './history'
import type { SourceId } from './sources'
import type { ApprovalDecision } from './types'

export type EventCategory =
  | 'data_quality'
  | 'health_rule'
  | 'schedule'
  | 'safety_review'
  | 'human_action'

/**
 * 事件到观察时轴的真实映射。只允许映射到事件自身来源的时轴，
 * 不允许跨来源（调度 ↔ 回放）猜测时刻；无法映射时保持 null，显示“未关联”。
 */
export type EventLocate =
  | {
      sourceId: 'synthetic_schedule'
      kind: 'schedule'
      index: number
      label: string
    }
  | {
      sourceId: 'synthetic_history'
      kind: 'history'
      index: number
      machineId: string
      label: string
    }

export interface TimelineEvent {
  id: string
  time: string
  source: SourceId
  category: EventCategory
  /** 真实处置 / 判定状态文本（不依赖颜色）。 */
  status: string
  /** 简短原因，取自真实字段。 */
  reason: string
  title: string
  detail: string
  evidenceRefs: string[]
  locate: EventLocate | null
  synthetic: true
}

export interface TimelineInput {
  run: ScenarioRun
  scenarioLabel: string
  quality: QualityBucket[]
  health: HealthFinding[]
  scheduleChain: DecisionChainResult
  historyReview: HistoryReviewResult
  decisions: ApprovalDecision[]
}

function historyLocate(
  quality: QualityBucket[],
  machineId: string,
  minuteOfDay: number,
): EventLocate | null {
  const index = Math.floor((minuteOfDay - HISTORY_START_MINUTE) / BUCKET_MINUTES)
  if (index < 0) return null
  const bucket = quality.find(
    (b) => b.machineId === machineId && b.bucketIndex === index,
  )
  if (!bucket) return null
  return {
    sourceId: 'synthetic_history',
    kind: 'history',
    index,
    machineId,
    label: bucket.bucketLabel,
  }
}

export function qualityRef(bucket: QualityBucket): string {
  return `quality:${bucket.machineId}:${bucket.bucketIndex}`
}

export function buildTimeline(input: TimelineInput): TimelineEvent[] {
  const { run, scenarioLabel, quality, health, scheduleChain, historyReview, decisions } =
    input
  const events: TimelineEvent[] = []

  for (const bucket of quality) {
    if (bucket.grade === 'pass') continue
    const labels = bucket.reasonCodes.map((c) => REASON_CODE_META[c].label).join('、')
    const gradeLabel = bucket.grade === 'invalid' ? '无效' : '待复核'
    events.push({
      id: `dq-${bucket.machineId}-${bucket.bucketIndex}`,
      time: bucket.bucketLabel,
      source: 'synthetic_history',
      category: 'data_quality',
      status: `质量${gradeLabel}`,
      reason: bucket.reasonCodes.map((c) => REASON_CODE_META[c].label).join('、') || '见质量分级明细',
      title: `数据质量 ${gradeLabel}：${bucket.machineId} ${bucket.bucketLabel}`,
      detail: `原因码：${bucket.reasonCodes.join('、')}（${labels}）；有效样本 ${bucket.validSampleCount}/${bucket.expectedMinutes}，缺时间点 ${bucket.missingTimestamps} 分钟、功率缺值 ${bucket.missingPowerMinutes} 分钟；完整桶能量 ${formatBucketEnergy(bucket)}（${bucket.energyTrusted ? '可用于合格/节能统计' : '不可用于合格/节能统计'}）。`,
      evidenceRefs: [qualityRef(bucket)],
      locate: {
        sourceId: 'synthetic_history',
        kind: 'history',
        index: bucket.bucketIndex,
        machineId: bucket.machineId,
        label: bucket.bucketLabel,
      },
      synthetic: true,
    })
  }

  for (const finding of health) {
    events.push({
      id: `hr-${finding.id}`,
      time: finding.basisLabels[0],
      source: 'synthetic_history',
      category: 'health_rule',
      status: finding.severity === 'watch' ? '需关注' : '提示',
      reason: finding.statement,
      title: `规则异常提示：${finding.machineId} ${finding.ruleLabel}`,
      detail: `${finding.statement} 阈值 ${finding.threshold}，窗口 ${finding.window}。未知项：${finding.unknowns.join(' ')}`,
      evidenceRefs: [`health:${finding.id}`, ...finding.sampleKeys.slice(0, 6)],
      locate:
        finding.basisMinutes.length > 0
          ? historyLocate(quality, finding.machineId, finding.basisMinutes[0])
          : null,
      synthetic: true,
    })
  }

  const infeasible = run.recommendation.infeasiblePeriods
  if (!run.recommendation.feasible && infeasible.length > 0) {
    events.push({
      id: 'sched-infeasible',
      time: infeasible[0].label,
      source: 'synthetic_schedule',
      category: 'schedule',
      status: '建议无解',
      reason: `${infeasible.length} 个时段无满足硬约束的方案`,
      title: `调度建议无解：${scenarioLabel}`,
      detail: `${infeasible.length} 个时段无满足硬约束的方案。${infeasible
        .slice(0, 3)
        .map((p) => `${p.label} 需求 ${p.demand.toFixed(1)} m³/min`)
        .join('；')}`,
      evidenceRefs: infeasible.slice(0, 6).map((p) => `period:${p.index}`),
      locate: {
        sourceId: 'synthetic_schedule',
        kind: 'schedule',
        index: infeasible[0].index,
        label: infeasible[0].label,
      },
      synthetic: true,
    })
  } else {
    const firstPeriod = run.recommendation.periods[0]
    events.push({
      id: 'sched-feasible',
      time: firstPeriod?.label ?? '00:00',
      source: 'synthetic_schedule',
      category: 'schedule',
      status: '建议可行',
      reason: `覆盖 ${run.recommendation.periods.length} 时段`,
      title: `调度建议可行：${scenarioLabel}`,
      detail: `覆盖 ${run.recommendation.periods.length} 时段，估算耗电 ${run.recommendation.totalEnergyKwh.toFixed(
        1,
      )} kWh，切换 ${run.recommendation.totalSwitches} 次；基线切换 ${run.baseline.totalSwitches} 次、违规 ${run.baseline.violationCount} 项。`,
      evidenceRefs: ['role:dispatcher'],
      locate: firstPeriod
        ? {
            sourceId: 'synthetic_schedule',
            kind: 'schedule',
            index: firstPeriod.index,
            label: firstPeriod.label,
          }
        : null,
      synthetic: true,
    })
  }

  events.push({
    id: 'history-verdict',
    time: '复验',
    source: 'synthetic_history',
    category: 'safety_review',
    status:
      historyReview.status === 'blocked'
        ? '统计被禁用'
        : historyReview.status === 'review'
          ? '部分待复核'
          : '全通过',
    reason: historyReview.reasons[0] ?? '回放核查无附加原因',
    title: `回放安全核查：${
      historyReview.status === 'blocked'
        ? '该回放统计被禁用'
        : historyReview.status === 'review'
          ? '部分回放数据待复核'
          : '回放全通过（只读）'
    }`,
    detail: historyReview.reasons.join(' '),
    evidenceRefs: [
      'role:data_quality',
      'role:equipment_health',
      ...historyReview.manualActions.map((_, i) => `manual:history:${i}`),
    ],
    locate: null,
    synthetic: true,
  })

  events.push({
    id: 'safety-verdict',
    time: '复验',
    source: 'synthetic_schedule',
    category: 'safety_review',
    status: scheduleChain.safety.verdict === 'reject' ? '拒绝批准' : '允许批准',
    reason: scheduleChain.safety.reasons[0] ?? '安全复验无附加原因',
    title: `调度安全审查：${scheduleChain.safety.verdict === 'reject' ? '拒绝批准' : '允许批准'}`,
    detail: scheduleChain.safety.reasons.join(' '),
    evidenceRefs: [
      'role:safety_reviewer',
      ...scheduleChain.safety.manualActions.map((_, i) => `manual:schedule:${i}`),
    ],
    locate: null,
    synthetic: true,
  })

  for (const decision of decisions) {
    const migrated = decision.migrated === true
    events.push({
      id: `human-${decision.id}`,
      time: decision.createdAt,
      source: 'synthetic_schedule',
      category: 'human_action',
      status: migrated
        ? decision.action === 'approve'
          ? '历史批准（须重审）'
          : '历史驳回（须重审）'
        : decision.action === 'approve'
          ? '已批准'
          : '已驳回',
      reason: decision.reason,
      title: `人工${decision.action === 'approve' ? '批准' : '驳回'}：${scenarioLabel}`,
      detail: migrated
        ? `理由：${decision.reason}（旧版本迁移记录，缺少原审计与完整方案上下文，须重新审核，不代表当前有效批准。）`
        : `理由：${decision.reason}`,
      evidenceRefs: ['role:duty_engineer', 'safety-verdict'],
      locate: null,
      synthetic: true,
    })
  }

  return events
}

export function timelineByCategory(
  events: TimelineEvent[],
  category: EventCategory,
): TimelineEvent[] {
  return events.filter((e) => e.category === category)
}

export const STATION_REF = STATION_ID