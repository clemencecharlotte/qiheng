import type { DecisionChainResult, HistoryReviewResult } from './chain'
import type { ScenarioRun } from './engine'
import type { HealthFinding } from './health'
import {
  formatBucketEnergy,
  REASON_CODE_META,
  type QualityBucket,
  type QualityGrade,
} from './quality'
import type { HistoryFixture } from './history'
import { HISTORY_MACHINES } from './history'
import type { SourceId } from './sources'
import type { AuditEvent } from './audit'

export type EvidenceWorkspace = 'schedule' | 'history' | 'events'

export type EvidenceKind =
  | 'quality'
  | 'health'
  | 'period'
  | 'role'
  | 'safety'
  | 'manual'
  | 'unit'
  | 'scenario'
  | 'decision'
  | 'unknown'

export interface EvidenceRef {
  id: string
  kind: EvidenceKind
  label: string
  detail: string
  unit?: string
  quality?: QualityGrade
  sourceId: SourceId
  anchor: { workspace: EvidenceWorkspace; target: string }
}

export interface EvidenceContext {
  run: ScenarioRun
  normalRun?: ScenarioRun
  quality: QualityBucket[]
  health: HealthFinding[]
  scheduleChain: DecisionChainResult
  historyReview: HistoryReviewResult
  fixture: HistoryFixture
  scenarioLabel: string
  auditEvents?: AuditEvent[]
}

function qualityStatusLabel(grade: QualityGrade): string {
  return grade === 'pass' ? '质量通过' : grade === 'review' ? '质量待复核' : '质量无效'
}

function resolveQuality(ctx: EvidenceContext, body: string): EvidenceRef | null {
  const [machineId, indexRaw] = body.split(':')
  const bucketIndex = Number(indexRaw)
  if (!machineId || Number.isNaN(bucketIndex)) return null
  const bucket = ctx.quality.find(
    (b) => b.machineId === machineId && b.bucketIndex === bucketIndex,
  )
  if (!bucket) return null
  const reasons = bucket.reasonCodes
    .map((c) => `${c}（${REASON_CODE_META[c].label}）`)
    .join('；')
  return {
    id: `quality:${machineId}:${bucketIndex}`,
    kind: 'quality',
    label: `${machineId} ${bucket.bucketLabel}`,
    detail: `分级 ${bucket.grade}；有效样本 ${bucket.validSampleCount}/${bucket.expectedMinutes}；缺时间点 ${bucket.missingTimestamps} 分钟、功率缺值 ${bucket.missingPowerMinutes} 分钟；完整桶能量 ${formatBucketEnergy(bucket)}（${bucket.energyTrusted ? '可信' : '不可用于合格/节能统计'}）；原因码 ${reasons}`,
    unit: 'kWh / 分钟',
    quality: bucket.grade,
    sourceId: 'synthetic_history',
    anchor: { workspace: 'history', target: `bucket:${machineId}:${bucketIndex}` },
  }
}

function resolveHealth(ctx: EvidenceContext, body: string): EvidenceRef | null {
  const finding = ctx.health.find((f) => f.id === body)
  if (!finding) return null
  return {
    id: `health:${body}`,
    kind: 'health',
    label: `${finding.machineId} ${finding.ruleLabel}`,
    detail: `${finding.statement} 阈值 ${finding.threshold}，窗口 ${finding.window}。`,
    unit: 'kW / MPa / m³/min',
    sourceId: 'synthetic_history',
    anchor: { workspace: 'history', target: `health:${body}` },
  }
}

function resolvePeriod(ctx: EvidenceContext, body: string): EvidenceRef | null {
  const index = Number(body)
  const period =
    ctx.run.baseline.periods.find((p) => p.index === index) ??
    ctx.run.recommendation.periods.find((p) => p.index === index)
  if (!period) return null
  const rec = ctx.run.recommendation.periods.find((p) => p.index === index)
  return {
    id: `period:${index}`,
    kind: 'period',
    label: `${ctx.scenarioLabel} ${period.label}`,
    detail: `需求 ${period.demand.toFixed(1)} m³/min；基线投运 ${period.runningUnitIds.join('、') || '全停'}；基线约束 ${
      period.violations.length === 0 ? '通过' : period.violations.map((v) => v.type).join('、')
    }；建议 ${rec ? rec.runningUnitIds.join('、') || '全停' : '无可行建议'}`,
    unit: 'm³/min',
    sourceId: 'synthetic_schedule',
    anchor: { workspace: 'schedule', target: `period:${index}` },
  }
}

function resolveRole(ctx: EvidenceContext, body: string): EvidenceRef | null {
  const role = ctx.scheduleChain.roles.find((r) => r.id === body)
  if (role) {
    return {
      id: `role:${body}`,
      kind: 'role',
      label: role.name,
      detail: role.conclusion,
      sourceId: 'synthetic_schedule',
      anchor: { workspace: 'events', target: `role:${body}` },
    }
  }
  const historyRole = ctx.historyReview.roles.find((r) => r.id === body)
  if (!historyRole) return null
  return {
    id: `role:${body}`,
    kind: 'role',
    label: historyRole.name,
    detail: historyRole.conclusion,
    sourceId: 'synthetic_history',
    anchor: { workspace: 'events', target: `role:${body}` },
  }
}

function resolveUnit(ctx: EvidenceContext, body: string): EvidenceRef | null {
  const unit = ctx.run.allUnits.find((u) => u.id === body)
  if (!unit) return null
  const eligibility = ctx.run.evaluation.eligibility.find((e) => e.unitId === body)
  return {
    id: `unit:${body}`,
    kind: 'unit',
    label: `${unit.name}（${unit.id}）`,
    detail: `${eligibility?.eligible ? '纳入自动调度候选' : eligibility?.reason ?? '未纳入候选'}；供气能力 ${unit.ratedCapacity} m³/min；最小稳定负载 ${(unit.minLoadRatio * 100).toFixed(0)}%；最小启停间隔 ${unit.minStartStopInterval} min`,
    unit: 'm³/min / % / min',
    sourceId: 'synthetic_schedule',
    anchor: { workspace: 'schedule', target: `unit:${body}` },
  }
}

export function resolveEvidenceId(
  ctx: EvidenceContext,
  id: string,
): EvidenceRef | null {
  if (id.startsWith('quality:')) return resolveQuality(ctx, id.slice('quality:'.length))
  if (id.startsWith('health:')) return resolveHealth(ctx, id.slice('health:'.length))
  if (id.startsWith('period:')) return resolvePeriod(ctx, id.slice('period:'.length))
  if (id.startsWith('role:')) return resolveRole(ctx, id.slice('role:'.length))
  if (id.startsWith('unit:')) return resolveUnit(ctx, id.slice('unit:'.length))
  if (id === 'safety-verdict') {
    return {
      id,
      kind: 'safety',
      label: '调度安全审查结论',
      detail: ctx.scheduleChain.safety.reasons.join(' '),
      sourceId: 'synthetic_schedule',
      anchor: { workspace: 'events', target: 'safety-verdict' },
    }
  }
  if (id === 'history-verdict') {
    return {
      id,
      kind: 'safety',
      label: '回放安全核查结论',
      detail: ctx.historyReview.reasons.join(' '),
      sourceId: 'synthetic_history',
      anchor: { workspace: 'events', target: 'history-verdict' },
    }
  }
  if (id.startsWith('manual:')) {
    const [scope, indexRaw] = id.slice('manual:'.length).split(':')
    const i = Number(indexRaw)
    if (Number.isNaN(i)) return null
    if (scope === 'history') {
      const action = ctx.historyReview.manualActions[i]
      if (!action) return null
      return {
        id,
        kind: 'manual',
        label: '回放转人工动作',
        detail: action,
        sourceId: 'synthetic_history',
        anchor: { workspace: 'events', target: 'history-verdict' },
      }
    }
    if (scope === 'schedule') {
      const action = ctx.scheduleChain.safety.manualActions[i]
      if (!action) return null
      return {
        id,
        kind: 'manual',
        label: '调度转人工动作',
        detail: action,
        sourceId: 'synthetic_schedule',
        anchor: { workspace: 'events', target: 'safety-verdict' },
      }
    }
    return null
  }
  if (id.startsWith('decision:')) {
    const eventId = id.slice('decision:'.length)
    const event = ctx.auditEvents?.find((e) => e.id === eventId)
    if (!event) return null
    return {
      id,
      kind: 'decision',
      label: '人工审批记录',
      detail: `${event.kind === 'approve' ? '批准' : '驳回'}：${event.conclusion}（${event.operatorAction}）`,
      sourceId: 'synthetic_schedule',
      anchor: { workspace: 'events', target: 'safety-verdict' },
    }
  }
  if (id.startsWith('scenario:')) {
    const sid = id.slice('scenario:'.length)
    return {
      id,
      kind: 'scenario',
      label: `场景 ${sid}`,
      detail: `当前调度场景标识 ${sid}`,
      sourceId: 'synthetic_schedule',
      anchor: { workspace: 'schedule', target: 'scenario' },
    }
  }
  return null
}

export function validateEvidenceRefs(
  ctx: EvidenceContext,
  ids: string[],
): { valid: EvidenceRef[]; invalid: string[] } {
  const valid: EvidenceRef[] = []
  const invalid: string[] = []
  for (const id of ids) {
    const ref = resolveEvidenceId(ctx, id)
    if (ref) valid.push(ref)
    else invalid.push(id)
  }
  return { valid, invalid }
}

export function historyMachineIds(): string[] {
  return HISTORY_MACHINES.map((m) => m.id)
}

export function qualityStatusText(grade: QualityGrade): string {
  return qualityStatusLabel(grade)
}