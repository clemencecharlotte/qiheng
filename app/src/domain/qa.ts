import type { EvidenceContext, EvidenceRef, EvidenceWorkspace } from './evidence'
import { resolveEvidenceId } from './evidence'
import type { ApprovalDecision } from './types'
import { HISTORY_START_MINUTE } from './history'
import { formatMinuteOfDay } from './demand'
import { REASON_CODE_META, STATION_ID } from './quality'
import { RULE_VERSION } from './audit'
import type { SourceScope } from './sources'

export type QaIntent =
  | 'why_recommendation'
  | 'baseline_delta'
  | 'period_anomaly'
  | 'unit_readonly'
  | 'history_energy'
  | 'unsupported'
  | 'ambiguous'

export interface QaEvidence {
  id: string
  label: string
  detail: string
  unit?: string
  quality?: EvidenceRef['quality']
  anchor: { workspace: EvidenceWorkspace; target: string }
}

export interface QaAnswer {
  intent: QaIntent
  sourceScope: SourceScope
  narrationMode: 'rule' | 'model'
  fallbackReason?: string
  conclusion: string
  evidence: QaEvidence[]
  invalidRefs: string[]
  assumptions: string[]
  unknowns: string[]
  nextStep: string
  refused: boolean
  refusalReason?: string
  clarify?: string[]
  untrustedInput: boolean
}

export interface QaAnswerDraft {
  intent: QaIntent
  sourceScope: SourceScope
  conclusion: string
  evidenceIds: string[]
  assumptions: string[]
  unknowns: string[]
  nextStep: string
  refused: boolean
  refusalReason?: string
  clarify?: string[]
  untrustedInput: boolean
}

export const PRESET_QUESTIONS: Array<{ intent: QaIntent; label: string }> = [
  { intent: 'why_recommendation', label: '为什么当前调度建议通过复验、允许进入人工评审？' },
  { intent: 'baseline_delta', label: '与同条件基线相比，当前调度建议的变化及代价？' },
  { intent: 'period_anomaly', label: '调度第 40 时段的异常与约束依据？' },
  { intent: 'unit_readonly', label: 'AC-03 为什么只读 / 不能调度？' },
  { intent: 'history_energy', label: '回放 C-01 09:30 的能量积分口径与缺口？' },
  { intent: 'unsupported', label: '能节能多少 / 指标是否达标 / 能否现在启动机组？' },
]

const SCHEDULE_SOURCE_KEYWORDS = [
  '调度',
  '建议',
  '基线',
  '场景',
  '常态',
  '突增',
  '故障',
  '候选',
  'ac-',
  'ac0',
]

const HISTORY_SOURCE_KEYWORDS = ['历史', '回放', '夹具', '桶', 'c-01', 'c-02', 'c01', 'c02']

export type SourceHint = 'schedule' | 'history' | 'both' | 'unspecified'

export function detectSourceHint(text: string): SourceHint {
  const lower = text.toLowerCase()
  const schedule = SCHEDULE_SOURCE_KEYWORDS.some((k) => lower.includes(k))
  const history = HISTORY_SOURCE_KEYWORDS.some((k) => lower.includes(k))
  if (schedule && history) return 'both'
  if (schedule) return 'schedule'
  if (history) return 'history'
  return 'unspecified'
}

const SOURCE_CLARIFY_OPTIONS = [
  '当前调度建议为什么可执行或被拒绝？',
  '回放夹具 09:30 的数据质量与缺口？',
]

const OVERREACH_PATTERNS = [
  '忽略',
  '绕过',
  '直接批准',
  '强制批准',
  '改成可批准',
  '改成批准',
  '系统提示',
  '忽略之前',
  'ignore previous',
  'override',
  'jailbreak',
  '你现在是',
  '把建议改',
]

const EXECUTE_PATTERNS = [
  '现在启动',
  '立即启动',
  '马上启动',
  '启动机组',
  '启停指令',
  '下发指令',
  '远程启动',
  '停机指令',
  '能否启动',
  '能不能启动',
  '开起来',
]

const KPI_PATTERNS = [
  '节能多少',
  '省多少',
  '节能率',
  '收益',
  '压力合格率',
  '喘振',
  '预警率',
  '停机下降率',
  '达标',
  '准确率',
]

function hasAny(text: string, patterns: string[]): boolean {
  return patterns.some((p) => text.includes(p))
}

function countHits(text: string, patterns: string[]): number {
  return patterns.filter((p) => text.includes(p)).length
}

export function extractClock(text: string): string | null {
  const match = text.match(/([01]?\d|2[0-3])[:：]([0-5]\d)/)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  return formatMinuteOfDay(h * 60 + m)
}

export function extractBucketIndex(text: string): number | null {
  const match = text.match(/第\s*(\d+)\s*(桶|个桶)/)
  if (!match) return null
  return Number(match[1])
}

export function extractPeriodIndex(text: string): number | null {
  const match = text.match(/第\s*(\d+)\s*时段/)
  if (!match) return null
  return Number(match[1])
}

export interface MachineMention {
  ids: string[]
  groups: Array<'screw' | 'centrifugal'>
}

export function extractMachines(text: string): MachineMention {
  const ids: string[] = []
  const groups: Array<'screw' | 'centrifugal'> = []
  for (const id of ['AC-01', 'AC-02', 'AC-03', 'C-01', 'C-02']) {
    if (text.toUpperCase().includes(id)) ids.push(id)
  }
  if (/1\s*#/.test(text) && !ids.includes('AC-01')) ids.push('AC-01')
  if (/2\s*#/.test(text) && !ids.includes('AC-02')) ids.push('AC-02')
  if (/3\s*#/.test(text) && !ids.includes('AC-03')) ids.push('AC-03')
  if (text.includes('离心')) groups.push('centrifugal')
  if (text.includes('螺杆')) groups.push('screw')
  return { ids, groups }
}

function classify(text: string): QaIntent {
  const why = countHits(text, [
    '为什么',
    '为何',
    '拒绝',
    '可执行',
    '可批准',
    '复验',
    '人工评审',
    '原因',
    'why',
    'reject',
  ])
  const baseline = countHits(text, [
    '基线',
    '对比',
    '相比',
    '变化',
    '代价',
    '切换',
    '差多少',
    'baseline',
  ])
  const anomaly = countHits(text, ['异常', '依据', '质量', '缺口', '缺分钟', '缺值', '数据'])
  const readonly =
    countHits(text, ['只读', '不能调度', '不可调度', '排除', '候选']) * 2
  const energy = countHits(text, ['能量积分', '功率积分', '积分', '口径', '回放', '历史'])
  const unsupported = hasAny(text.toLowerCase(), KPI_PATTERNS) ? 10 : 0

  const scores: Array<[QaIntent, number]> = [
    ['unsupported', unsupported],
    ['why_recommendation', why],
    ['baseline_delta', baseline],
    ['period_anomaly', anomaly],
    ['unit_readonly', readonly],
    ['history_energy', energy],
  ]
  const max = Math.max(...scores.map(([, s]) => s))
  if (max <= 0) return 'ambiguous'
  const winners = scores.filter(([, s]) => s === max)
  if (winners.length > 1) return 'ambiguous'
  return winners[0][0]
}

interface PeriodMatch {
  kind: 'schedule' | 'history' | 'both' | 'none'
  periodIndex?: number
  bucket?: { machineId: string; bucketIndex: number }
}

function parseTargets(
  ctx: EvidenceContext,
  text: string,
): PeriodMatch {
  const clock = extractClock(text)
  const periodIndex = extractPeriodIndex(text)
  const bucketIndex = extractBucketIndex(text)
  const machines = extractMachines(text)

  let scheduleIndex: number | undefined
  if (periodIndex !== null && ctx.run.baseline.periods[periodIndex]) {
    scheduleIndex = periodIndex
  } else if (clock) {
    const point = ctx.run.series.points.find((p) => p.label === clock)
    if (point) scheduleIndex = point.index
  }

  let bucket: { machineId: string; bucketIndex: number } | undefined
  if (bucketIndex !== null && ctx.quality.some((b) => b.bucketIndex === bucketIndex)) {
    const machineId = machines.ids[0] ?? STATION_ID
    const exists = ctx.quality.some(
      (b) => b.machineId === machineId && b.bucketIndex === bucketIndex,
    )
    if (exists) bucket = { machineId, bucketIndex }
  } else if (clock) {
    const minutes = clock.split(':').map(Number)
    const minuteOfDay = minutes[0] * 60 + minutes[1]
    const startMinute = HISTORY_START_MINUTE
    const endMinute = startMinute + ctx.fixture.bucketCount * ctx.fixture.bucketMinutes
    if (minuteOfDay >= startMinute && minuteOfDay < endMinute) {
      const idx = Math.floor((minuteOfDay - startMinute) / ctx.fixture.bucketMinutes)
      const machineId = machines.ids[0] ?? STATION_ID
      const exists = ctx.quality.some(
        (b) => b.machineId === machineId && b.bucketIndex === idx,
      )
      bucket = { machineId: exists ? machineId : STATION_ID, bucketIndex: idx }
    }
  }

  if (scheduleIndex !== undefined && bucket) return { kind: 'both', periodIndex: scheduleIndex, bucket }
  if (scheduleIndex !== undefined) return { kind: 'schedule', periodIndex: scheduleIndex }
  if (bucket) return { kind: 'history', bucket }
  return { kind: 'none' }
}

function narrowTargetsByHint(targets: PeriodMatch, hint: SourceHint): PeriodMatch {
  if (targets.kind !== 'both') return targets
  if (hint === 'schedule') return { kind: 'schedule', periodIndex: targets.periodIndex }
  if (hint === 'history') return { kind: 'history', bucket: targets.bucket }
  return targets
}

function baseUnknowns(): string[] {
  return [
    '压力合格率、喘振预警率、节能率、停机下降率缺少真值，均为“未验证”。',
    '估算耗电为模型推算，非现场实测收益。',
    '本系统为合成演示，不连接真实 PLC/SCADA。',
  ]
}

function toEvidence(ref: EvidenceRef): QaEvidence {
  return {
    id: ref.id,
    label: ref.label,
    detail: ref.detail,
    unit: ref.unit,
    quality: ref.quality,
    anchor: ref.anchor,
  }
}

export function sanitizeAnswer(ctx: EvidenceContext, draft: QaAnswerDraft): QaAnswer {
  const evidence: QaEvidence[] = []
  const invalidRefs: string[] = []
  for (const id of draft.evidenceIds) {
    const ref = resolveEvidenceId(ctx, id)
    if (ref) evidence.push(toEvidence(ref))
    else invalidRefs.push(id)
  }
  return {
    intent: draft.intent,
    sourceScope: draft.sourceScope,
    narrationMode: 'rule',
    conclusion: draft.conclusion,
    evidence,
    invalidRefs,
    assumptions: draft.assumptions,
    unknowns: draft.unknowns,
    nextStep: draft.nextStep,
    refused: draft.refused,
    refusalReason: draft.refusalReason,
    clarify: draft.clarify,
    untrustedInput: draft.untrustedInput,
  }
}

const CLARIFY_OPTIONS = PRESET_QUESTIONS.map((q) => q.label)

function ambiguousDraft(reason: string, sourceScope: SourceScope = 'schedule'): QaAnswerDraft {
  return {
    intent: 'ambiguous',
    sourceScope,
    conclusion: `问题不够明确：${reason} 请补充场景或时段后再提问，我不会编造时段或数值。`,
    evidenceIds: [],
    assumptions: [],
    unknowns: ['缺少可定位的场景 / 机组 / 时段，未生成结论。'],
    nextStep: '从下方预设问题中选一个，或补充具体的机组编号与时间（如 09:30 或第 4 桶）。',
    refused: false,
    clarify: CLARIFY_OPTIONS,
    untrustedInput: false,
  }
}

function clarifySourceDraft(reason: string): QaAnswerDraft {
  return {
    intent: 'ambiguous',
    sourceScope: 'schedule',
    conclusion: `问题跨了两个来源，需要先澄清：${reason} 合成调度来源与合成回放来源互不混用，请指明要问哪一个。`,
    evidenceIds: [],
    assumptions: [],
    unknowns: ['未指明来源，未生成结论，避免把回放异常叙述成调度事故。'],
    nextStep: '选择“当前调度建议”或“回放夹具”后再提问。',
    refused: false,
    clarify: SOURCE_CLARIFY_OPTIONS,
    untrustedInput: false,
  }
}

function unsupportedRefusal(
  sourceScope: SourceScope,
  untrusted: boolean,
  reason: string,
  nextStep: string,
): QaAnswerDraft {
  return {
    intent: 'unsupported',
    sourceScope,
    conclusion: reason,
    evidenceIds: ['safety-verdict'],
    assumptions: [],
    unknowns: baseUnknowns(),
    nextStep,
    refused: true,
    refusalReason: reason,
    untrustedInput: untrusted,
  }
}

export interface AskOptions {
  scenarioLabel: string
  currentDecision?: ApprovalDecision | null
  decisionEventId?: string | null
}

export function askQuestion(
  ctx: EvidenceContext,
  text: string,
  opts: AskOptions,
): QaAnswer {
  const raw = text.trim()
  const lower = raw.toLowerCase()
  if (raw.length === 0) {
    return sanitizeAnswer(ctx, ambiguousDraft('没有收到问题内容。'))
  }

  const machines = extractMachines(raw)
  const hint = detectSourceHint(raw)
  const targets = narrowTargetsByHint(parseTargets(ctx, raw), hint)
  const refusalScope: SourceScope = hint === 'history' ? 'history' : 'schedule'

  // 越权 / 提示注入：按普通不可信输入处理
  if (hasAny(lower, OVERREACH_PATTERNS)) {
    return sanitizeAnswer(
      ctx,
      unsupportedRefusal(
        refusalScope,
        true,
        '该请求试图绕过安全门或改写审批状态。问答只解释证据，不能修改审批、安全结论或机组状态，已按普通不可信输入处理。',
        '如需要批准或驳回，请在“事件与决策”中由值班员按流程操作；安全审查拒绝时不可批准。',
      ),
    )
  }

  // 执行类：不允许下发启停
  if (hasAny(lower, EXECUTE_PATTERNS)) {
    return sanitizeAnswer(
      ctx,
      unsupportedRefusal(
        refusalScope,
        false,
        '本项目为合成演示且不连接 PLC/SCADA，不允许执行机组启停或下发任何控制指令；调度建议与只读回放都不产生现场动作。',
        '如需评估运行安排，请查看本场景的基线与建议对比，并由值班员人工处置。',
      ),
    )
  }

  const intent = classify(lower)

  // 跨来源含糊：同时提到调度与回放且未指明具体机组时先澄清，避免把回放异常当成调度事故
  if (
    hint === 'both' &&
    intent !== 'unsupported' &&
    intent !== 'unit_readonly' &&
    machines.ids.length === 0
  ) {
    return sanitizeAnswer(ctx, clarifySourceDraft('你同时提到了合成调度与合成回放。'))
  }
  if (
    (intent === 'period_anomaly' || intent === 'history_energy') &&
    targets.kind === 'both'
  ) {
    return sanitizeAnswer(
      ctx,
      clarifySourceDraft('该时间既匹配调度时段又匹配回放桶，无法确定来源。'),
    )
  }

  if (intent === 'unsupported') {
    const kpi = hasAny(lower, KPI_PATTERNS)
    if (kpi) {
      return sanitizeAnswer(
        ctx,
        unsupportedRefusal(
          refusalScope,
          false,
          '该问题涉及未验证的 KPI 或收益：压力合格率、喘振预警率、节能率、停机下降率缺少真值，我不能给出“节能多少 / 是否达标”的结论，也不把规则异常提示当作故障预测或喘振真值。',
          '接入真值前请以“未验证”为准；可持续观察基线与建议的估算耗电（模型推算，非现场收益）。',
        ),
      )
    }
    return sanitizeAnswer(ctx, ambiguousDraft('未识别到可回答的问题类型。'))
  }

  if (intent === 'why_recommendation') {
    return answerWhy(ctx, opts)
  }
  if (intent === 'baseline_delta') {
    return answerBaseline(ctx)
  }
  if (intent === 'unit_readonly') {
    return answerReadonly(ctx, machines)
  }
  if (intent === 'history_energy') {
    return answerEnergy(ctx, targets)
  }
  if (intent === 'period_anomaly') {
    return answerAnomaly(ctx, targets)
  }
  return sanitizeAnswer(ctx, ambiguousDraft('未识别到可回答的问题类型。'))
}

function answerWhy(ctx: EvidenceContext, opts: AskOptions): QaAnswer {
  const safety = ctx.scheduleChain.safety
  if (safety.verdict === 'reject') {
    const evidenceIds = ['safety-verdict', 'role:safety_reviewer']
    const reasons = [...safety.reasons]
    if (safety.checks.missingKeyParams) {
      const unit = ctx.run.evaluation.eligibility.find((e) => e.missingFields.length > 0)
      if (unit) evidenceIds.push(`unit:${unit.unitId}`)
    }
    if (!safety.checks.recommendationFeasible) {
      const period = ctx.run.recommendation.infeasiblePeriods[0]
      if (period) evidenceIds.push(`period:${period.index}`)
    }
    return sanitizeAnswer(ctx, {
      intent: 'why_recommendation',
      sourceScope: 'schedule',
      conclusion: `当前「${opts.scenarioLabel}」调度建议不可执行（调度侧安全审查拒绝）：${reasons.slice(0, 2).join('；')}。`,
      evidenceIds,
      assumptions: ['调度建议不可行或存在真实缺失参数时，系统不生成自动启停方案。'],
      unknowns: [
        ...baseUnknowns(),
        '合成回放夹具的质量问题不影响本调度场景的可行性判断。',
      ],
      nextStep: safety.manualActions[0] ?? '转人工处置并记录理由。',
      refused: false,
      untrustedInput: false,
    })
  }
  const evidenceIds = ['safety-verdict', 'role:safety_reviewer', 'role:dispatcher']
  const decision = opts.currentDecision ?? null
  if (opts.decisionEventId) evidenceIds.push(`decision:${opts.decisionEventId}`)

  if (decision?.action === 'approve') {
    return sanitizeAnswer(ctx, {
      intent: 'why_recommendation',
      sourceScope: 'schedule',
      conclusion: `当前「${opts.scenarioLabel}」调度建议：硬约束可行（通过供气能力、最小稳定负载、最小启停间隔、关键参数完整性与离心机排除复验），且已由值班员批准，仅更新演示状态、未真实执行。人工批准即授权合成执行，但不自动 Start；实际运行须由人另行显式 Start。批准理由：${decision.reason}（记录时间 ${decision.createdAt}）。`,
      evidenceIds,
      assumptions: ['同条件、同固定种子下结果可复现。'],
      unknowns: [
        ...baseUnknowns(),
        '本地批准只更新演示状态、不代表真实执行；合成回放夹具不参与本调度结论。',
      ],
      nextStep: '可在“事件与决策”查看该审批记录；如需整改可再次驳回并说明理由。',
      refused: false,
      untrustedInput: false,
    })
  }
  if (decision?.action === 'reject') {
    return sanitizeAnswer(ctx, {
      intent: 'why_recommendation',
      sourceScope: 'schedule',
      conclusion: `当前「${opts.scenarioLabel}」调度建议：硬约束可行，但值班员已驳回（仅更新演示状态）。驳回理由：${decision.reason}（记录时间 ${decision.createdAt}）。`,
      evidenceIds: [...evidenceIds, 'role:duty_engineer'],
      assumptions: ['硬约束可行性与人工处置状态相互独立。'],
      unknowns: [
        ...baseUnknowns(),
        '驳回为人工演示处置，本地记录不代表现场执行；合成回放夹具不参与本调度结论。',
      ],
      nextStep: '可在“事件与决策”查看该处置记录，并按需重新评估。',
      refused: false,
      untrustedInput: false,
    })
  }
  return sanitizeAnswer(ctx, {
    intent: 'why_recommendation',
    sourceScope: 'schedule',
    conclusion: `当前「${opts.scenarioLabel}」调度建议通过安全复验、允许进入人工评审：供气能力、最小稳定负载、最小启停间隔、关键参数完整性与离心机排除复验均通过；当前尚未人工处置——既未批准，也未经人显式 Start，系统不自动授权执行。`,
    evidenceIds: [...evidenceIds, 'role:duty_engineer'],
    assumptions: ['同条件、同固定种子下结果可复现。'],
    unknowns: [
      ...baseUnknowns(),
      '批准只更新演示状态；合成回放夹具不参与本调度结论。',
    ],
    nextStep: '在“事件与决策”中由值班员填写理由后批准或驳回。',
    refused: false,
    untrustedInput: false,
  })
}

function answerBaseline(ctx: EvidenceContext): QaAnswer {
  const run = ctx.run
  const feasible = run.recommendation.feasible
  const evidenceIds = ['role:dispatcher']
  const firstPeriod = run.baseline.periods[0]
  if (firstPeriod) evidenceIds.push(`period:${firstPeriod.index}`)
  const conclusion = feasible
    ? `同条件对比：切换次数基线 ${run.baseline.totalSwitches} → 建议 ${run.recommendation.totalSwitches}；估算耗电基线 ${run.baseline.totalEnergyKwh.toFixed(1)} kWh → 建议 ${run.recommendation.totalEnergyKwh.toFixed(1)} kWh；基线约束违规 ${run.baseline.violationCount} 项，建议 ${run.recommendation.violationCount} 项。`
    : `建议在当前场景无解，无可比建议代价；基线仍有 ${run.baseline.violationCount} 项约束违规（含供气不足）。`
  return sanitizeAnswer(ctx, {
    intent: 'baseline_delta',
    sourceScope: 'schedule',
    conclusion,
    evidenceIds,
    assumptions: [
      '基线与建议来自同一调度场景、同一需求序列与同一机组参数。',
      '合成回放夹具不参与本对比。',
    ],
    unknowns: [
      ...baseUnknowns(),
      '数值差异为模型推算，不等同现场节能收益，节能率仍为“未验证”。',
    ],
    nextStep: '在“合成调度”中查看时段级基线与建议对比及约束检查。',
    refused: false,
    untrustedInput: false,
  })
}

function answerReadonly(ctx: EvidenceContext, machines: MachineMention): QaAnswer {
  if (machines.ids.length === 0 && machines.groups.length === 0) {
    return sanitizeAnswer(
      ctx,
      ambiguousDraft('未指明是哪台机组。可选：AC-01、AC-02、AC-03（调度侧）或 C-01、C-02（回放侧）。'),
    )
  }
  if (machines.groups.includes('centrifugal') && machines.ids.length === 0) {
    return sanitizeAnswer(
      ctx,
      ambiguousDraft('“离心机”可能指调度侧 AC-03，或回放侧 C-01/C-02，需要明确是哪一台。'),
    )
  }
  const id = machines.ids[0]
  if (!id) {
    return sanitizeAnswer(ctx, ambiguousDraft('未指明具体机组编号。'))
  }
  if (id === 'AC-03') {
    return sanitizeAnswer(ctx, {
      intent: 'unit_readonly',
      sourceScope: 'schedule',
      conclusion:
        'AC-03 离心机喘振边界未经核实，缺少经有效来源确认的安全曲线，已从自动调度候选中排除；不编造安全边界。',
      evidenceIds: ['unit:AC-03', 'role:safety_reviewer'],
      assumptions: ['喘振边界须先经有效来源核实，方可评估是否纳入调度。'],
      unknowns: ['喘振真值与预警率不可计算，为“未验证”。'],
      nextStep: '补齐并核实喘振边界与启停边界后，再评估是否纳入候选。',
      refused: false,
      untrustedInput: false,
    })
  }
  if (id === 'C-01' || id === 'C-02') {
    return sanitizeAnswer(ctx, {
      intent: 'unit_readonly',
      sourceScope: 'history',
      conclusion: `${id} 属于合成回放夹具，是只读分钟数据；它不进入调度候选、不产生启停指令，也不能作为调度依据。`,
      evidenceIds: [],
      assumptions: ['回放夹具与调度示例是两套分开的来源。'],
      unknowns: ['官方离心机喘振与启停边界未核实，故只读回放。'],
      nextStep: '在“历史回放实验台”查看其质量分级与分钟级证据；调度请使用调度侧机组。',
      refused: false,
      untrustedInput: false,
    })
  }
  // AC-01 / AC-02 是可调度的
  return sanitizeAnswer(ctx, {
    intent: 'unit_readonly',
    sourceScope: 'schedule',
    conclusion: `${id} 并非只读：它是调度候选机组，仍受供气能力、最小稳定负载与最小启停间隔硬约束。当前候选为 ${ctx.run.evaluation.candidates.map((u) => u.id).join('、') || '无'}。`,
    evidenceIds: [`unit:${id}`, 'role:dispatcher'],
    assumptions: ['调度候选来自调度侧合成机组档案。'],
    unknowns: baseUnknowns(),
    nextStep: '若要查看其约束，请在“合成调度”查看对应时段约束检查。',
    refused: false,
    untrustedInput: false,
  })
}

function answerEnergy(ctx: EvidenceContext, targets: PeriodMatch): QaAnswer {
  if (!targets.bucket) {
    return sanitizeAnswer(
      ctx,
      ambiguousDraft('请指定回放时段，例如 09:30 或第 4 桶，并说明机组（C-01/C-02，默认站级）。'),
    )
  }
  const { machineId, bucketIndex } = targets.bucket
  const bucket = ctx.quality.find(
    (b) => b.machineId === machineId && b.bucketIndex === bucketIndex,
  )
  if (!bucket) {
    return sanitizeAnswer(ctx, ambiguousDraft('该时段 / 机组没有对应回放桶。'))
  }
  const reasonText = bucket.reasonCodes
    .map((c) => `${c}（${REASON_CODE_META[c].label}）`)
    .join('；')
  const energyText =
    bucket.energyIntegralKwh === null
      ? `完整桶能量未知（不可完整积分）：功率覆盖 ${bucket.powerCoveredMinutes}/${bucket.expectedMinutes} 分钟，观测部分积分 ${bucket.observedPartialEnergyKwh.toFixed(3)} kWh（非完整桶能量）`
      : `完整桶能量 ${bucket.energyIntegralKwh.toFixed(3)} kWh`
  const conclusion =
    bucket.grade === 'invalid'
      ? `${machineId} ${bucket.bucketLabel} 质量无效，功率积分不可信：${reasonText}。仅按分钟功率存在值累计，缺值不填零，因此该桶不并入合格率 / 节能统计。`
      : bucket.grade === 'review'
        ? `${machineId} ${bucket.bucketLabel} 质量待复核，功率积分需谨慎使用：${reasonText}。`
        : `${machineId} ${bucket.bucketLabel} 质量通过，功率积分可信。`
  return sanitizeAnswer(ctx, {
    intent: 'history_energy',
    sourceScope: 'history',
    conclusion: `${conclusion} 口径：历史功率积分 = Σ(分钟功率 kW × 1 分钟) / 60（仅当 15 分钟功率齐全时才是完整桶能量）；${energyText}，有效样本 ${bucket.validSampleCount}/${bucket.expectedMinutes}，缺时间点 ${bucket.missingTimestamps} 分钟、功率缺值 ${bucket.missingPowerMinutes} 分钟，可信=${bucket.energyTrusted ? '是' : '否'}。该结论只针对回放夹具，不影响任何合成调度场景。`,
    evidenceIds: [`quality:${machineId}:${bucketIndex}`],
    assumptions: ['积分按分钟功率累计，缺值不填零。'],
    unknowns: ['该积分为合成积算，非结算口径；不并入任何合格率 / 节能率。'],
    nextStep: '在“历史回放实验台”点击该桶查看分钟级证据与缺口。',
    refused: false,
    untrustedInput: false,
  })
}

function answerAnomaly(ctx: EvidenceContext, targets: PeriodMatch): QaAnswer {
  if (targets.kind === 'none') {
    return sanitizeAnswer(
      ctx,
      ambiguousDraft('请指定时段，例如 09:30、第 40 时段或第 4 桶。'),
    )
  }
  const evidenceIds: string[] = []
  const parts: string[] = []
  const periodIndex = targets.periodIndex
  if (periodIndex !== undefined) {
    const period = ctx.run.baseline.periods.find((p) => p.index === periodIndex)
    if (period) {
      evidenceIds.push(`period:${periodIndex}`)
      parts.push(
        `调度侧 ${period.label}：需求 ${period.demand.toFixed(1)} m³/min，基线约束 ${
          period.violations.length === 0
            ? '通过'
            : period.violations.map((v) => v.type).join('、')
        }。`,
      )
    }
  }
  if (targets.bucket) {
    const { machineId, bucketIndex } = targets.bucket
    const bucket = ctx.quality.find(
      (b) => b.machineId === machineId && b.bucketIndex === bucketIndex,
    )
    if (bucket) {
      evidenceIds.push(`quality:${machineId}:${bucketIndex}`)
      parts.push(
        `回放侧 ${machineId} ${bucket.bucketLabel}：分级 ${bucket.grade}，原因码 ${bucket.reasonCodes
          .map((c) => `${c}（${REASON_CODE_META[c].label}）`)
          .join('；')}，有效样本 ${bucket.validSampleCount}/${bucket.expectedMinutes}，缺时间点 ${bucket.missingTimestamps} 分钟、功率缺值 ${bucket.missingPowerMinutes} 分钟。`,
      )
    }
  }
  if (parts.length === 0) {
    return sanitizeAnswer(ctx, ambiguousDraft('未找到该时段对应的调度或回放证据。'))
  }
  const anomalyScope: SourceScope =
    targets.kind === 'history' ? 'history' : 'schedule'
  return sanitizeAnswer(ctx, {
    intent: 'period_anomaly',
    sourceScope: anomalyScope,
    conclusion: parts.join(' '),
    evidenceIds,
    assumptions:
      anomalyScope === 'history'
        ? ['回放质量分级仅针对合成夹具内建规则，不影响调度场景。']
        : ['调度侧结论来自当前合成调度场景的需求序列与约束检查。'],
    unknowns: [
      '规则异常提示不是故障预测，也不代表喘振真值。',
      'review / invalid 只影响回放自身统计，不并入调度可行性或合格率。',
    ],
    nextStep: '点击证据引用回到对应图表 / 表格 / 事件核对。',
    refused: false,
    untrustedInput: false,
  })
}

export function qaRuleVersion(): string {
  return RULE_VERSION
}