import type { ScenarioRun } from './engine'
import { verifyPlanConstraints } from './constraints'
import type { HealthFinding } from './health'
import type { HistoryFixture } from './history'
import { REASON_CODE_META, summarizeQuality, type QualityBucket } from './quality'
import type { ScenarioId } from './types'

export interface ChainRole {
  id: string
  name: string
  consumes: string[]
  conclusion: string
  basis: string[]
  unknowns: string[]
  actions: string[]
}

export interface ScheduleSafetyChecks {
  recommendationFeasible: boolean
  missingKeyParams: boolean
  centrifugalExcluded: boolean
}

export interface SafetyReview {
  verdict: 'reject' | 'allow'
  reasons: string[]
  manualActions: string[]
  checks: ScheduleSafetyChecks
}

export interface DecisionChainResult {
  scope: 'schedule'
  roles: ChainRole[]
  safety: SafetyReview
  overallStatus: 'blocked' | 'conditional' | 'ready'
}

export type HistoryReviewStatus = 'trusted' | 'review' | 'blocked'

export interface HistoryReviewResult {
  scope: 'history'
  roles: ChainRole[]
  status: HistoryReviewStatus
  counts: { total: number; pass: number; review: number; invalid: number }
  reasons: string[]
  manualActions: string[]
  unknowns: string[]
  energyIntegralTrustedKwh: number
  observedPartialEnergyKwh: number
  observedCoveredMinutes: number
  observedExpectedMinutes: number
}

export interface ScheduleChainInput {
  scenario: ScenarioId
  scenarioLabel: string
  run: ScenarioRun
}

export interface HistoryChainInput {
  fixture: HistoryFixture
  quality: QualityBucket[]
  health: HealthFinding[]
}

function reasonLabels(codes: QualityBucket['reasonCodes']): string {
  return codes.map((c) => REASON_CODE_META[c].label).join('、')
}

export function runScheduleChain(input: ScheduleChainInput): DecisionChainResult {
  const { run, scenarioLabel } = input

  const missingParamUnits = run.evaluation.eligibility.filter(
    (e) => e.missingFields.length > 0,
  )
  const centrifugalInCandidates = run.evaluation.candidates.some(
    (u) => u.kind === 'centrifugal',
  )
  const recVerified = verifyPlanConstraints(run.recommendation, run)
  const baseVerified = verifyPlanConstraints(run.baseline, run)
  const checks: ScheduleSafetyChecks = {
    recommendationFeasible: run.recommendation.feasible && recVerified.passed,
    missingKeyParams: missingParamUnits.length > 0,
    centrifugalExcluded: !centrifugalInCandidates,
  }

  const blockers: string[] = []
  const manualActions: string[] = []
  if (!checks.recommendationFeasible) {
    if (!run.recommendation.feasible) {
      blockers.push(
        `建议不可行：${run.recommendation.infeasibleReasons[0] ?? '存在无解时段'}`,
      )
    } else {
      blockers.push(
        `建议方案独立约束复验未通过（${recVerified.violationCount} 项），存在真实违规或未满足供气，不得批准。`,
      )
    }
    manualActions.push(
      '转人工评估供气缺口：观察运行机组、评估经验证机组投运或外购气源，禁止自动下发。',
    )
  }
  const baselineNote = baseVerified.passed
    ? `基线对照：独立复验通过（仅作对照，不参与批准判定）。`
    : `基线对照：独立复验未通过 ${baseVerified.violationCount} 项（仅作对照，不参与批准判定，也不因基线违规放行建议）。`
  if (checks.missingKeyParams) {
    blockers.push(
      `关键参数缺失：${missingParamUnits
        .map((e) => `${e.unitId}（${e.missingFields.join('、')}）`)
        .join('；')}`,
    )
    manualActions.push('补齐缺失的关键参数并复核后，方可再次进入自动调度。')
  }
  if (!checks.centrifugalExcluded) {
    blockers.push('离心机出现在自动调度候选中，违反来源隔离规则。')
    manualActions.push('立即移除离心机候选并排查候选生成逻辑。')
  }

  const allowed = blockers.length === 0
  const safety: SafetyReview = {
    verdict: allowed ? 'allow' : 'reject',
    reasons: allowed
      ? [
          '供气能力、最小稳定负载、启停间隔、关键参数完整性与离心机排除均通过复验。',
          baselineNote,
        ]
      : [...blockers, baselineNote],
    manualActions: manualActions.length > 0
      ? manualActions
      : ['可提交值班员人工批准；批准仅更新演示状态。'],
    checks,
  }

  const safetyReviewerRole: ChainRole = {
    id: 'safety_reviewer',
    name: '安全审查员',
    consumes: [
      'recommendation.feasible',
      'evaluation.eligibility[].missingFields',
      'evaluation.candidates[].kind',
    ],
    conclusion:
      blockers.length > 0
        ? `拒绝批准，共 ${blockers.length} 条调度侧具体原因。`
        : '复验通过，允许进入人工批准。',
    basis: safety.reasons,
    unknowns: [
      '安全审查只基于当前合成调度场景，不引用历史回放夹具。',
      '不替代真实安全评估。',
    ],
    actions: safety.manualActions,
  }

  const dispatcherRole: ChainRole = {
    id: 'dispatcher',
    name: '调度员',
    consumes: [
      'recommendation.feasible',
      'recommendation.periods[]',
      'recommendation.totalSwitches',
      'recommendation.totalEnergyKwh',
      'safety.verdict',
    ],
    conclusion:
      safety.verdict === 'allow'
        ? `建议可行：覆盖 ${run.recommendation.periods.length} 个时段，估算耗电 ${run.recommendation.totalEnergyKwh.toFixed(
            1,
          )} kWh，切换 ${run.recommendation.totalSwitches} 次；来源为「合成调度示例」。`
        : '安全审查未通过，不下达自动启停指令，仅保留基线与拒绝原因。',
    basis:
      safety.verdict === 'allow'
        ? [
            `场景 ${scenarioLabel}；建议相对基线切换 ${run.baseline.totalSwitches} → ${run.recommendation.totalSwitches} 次。`,
            `估算耗电（模型推算）：基线 ${run.baseline.totalEnergyKwh.toFixed(
              1,
            )} kWh，建议 ${run.recommendation.totalEnergyKwh.toFixed(1)} kWh。`,
          ]
        : [
            `场景 ${scenarioLabel}；建议无解或存在真实缺失参数，未生成自动启停方案。`,
            '基线仍保留用于对照，且标注其约束违规。',
          ],
    unknowns: [
      '估算耗电为模型推算，非现场实测能耗。',
      '未连接真实 PLC/SCADA，不产生现场动作。',
    ],
    actions:
      safety.verdict === 'allow'
        ? ['将建议提交安全审查与值班员人工批准。']
        : ['按安全审查转人工动作执行。'],
  }

  const dutyRole: ChainRole = {
    id: 'duty_engineer',
    name: '值班员',
    consumes: ['safety.verdict', 'safety.reasons', 'safety.manualActions'],
    conclusion:
      safety.verdict === 'allow'
        ? '可对建议执行人工批准或驳回；批准仅更新演示状态。'
        : '仅可转人工处置，不得批准自动建议。',
    basis: safety.reasons,
    unknowns: ['批准不写入任何现场设备或控制回路。'],
    actions:
      safety.verdict === 'allow'
        ? ['在「事件与决策」中填写理由后批准或驳回。', '保留决策记录以备回看。']
        : ['填写理由后驳回，并记录转人工动作。'],
  }

  return {
    scope: 'schedule',
    roles: [safetyReviewerRole, dispatcherRole, dutyRole],
    safety,
    overallStatus: safety.verdict === 'reject' ? 'blocked' : 'ready',
  }
}

export function runHistoryChain(input: HistoryChainInput): HistoryReviewResult {
  const { fixture, quality, health } = input
  const summary = summarizeQuality(quality)
  const review = quality.filter((b) => b.grade === 'review')
  const invalid = quality.filter((b) => b.grade === 'invalid')
  const status: HistoryReviewStatus =
    invalid.length > 0 ? 'blocked' : review.length > 0 ? 'review' : 'trusted'

  const reasons: string[] = []
  const manualActions: string[] = []
  if (status === 'blocked') {
    reasons.push(
      `回放夹具「${fixture.label}」有 ${invalid.length} 个 invalid 桶：${invalid
        .map((b) => `${b.machineId} ${b.bucketLabel}（${reasonLabels(b.reasonCodes)}）`)
        .slice(0, 3)
        .join('；')}。该回放数据不可信，已禁用其合格 / 节能统计与自动动作。`,
    )
    manualActions.push(
      '对 invalid 桶转人工核验数据源与采集链路；核验通过前不得据此做任何统计结论。',
    )
  } else if (status === 'review') {
    reasons.push(
      `回放夹具「${fixture.label}」有 ${review.length} 个 review 桶：${review
        .map((b) => `${b.machineId} ${b.bucketLabel}（${reasonLabels(b.reasonCodes)}）`)
        .slice(0, 3)
        .join('；')}。相关统计需谨慎并转人工复核。`,
    )
    manualActions.push('对 review 桶确认流量恒等式、运行状态与档案量程。')
  } else {
    reasons.push(`回放夹具「${fixture.label}」全部桶通过，仅用于只读回看。`)
  }
  manualActions.push('两台只读离心机 C-01 / C-02 不生成调度方案、不提供批准按钮。')

  const dataQualityRole: ChainRole = {
    id: 'data_quality',
    name: '数据质量员',
    consumes: [
      'quality[].grade',
      'quality[].reasonCodes',
      'quality[].validSampleCount',
      'quality[].missingTimestamps',
      'quality[].missingPowerMinutes',
      'quality[].energyTrusted',
    ],
    conclusion: `${quality.length} 个机器-桶：${summary.pass} 通过 / ${summary.review} 待复核 / ${summary.invalid} 无效。${
      invalid.length > 0
        ? `invalid 桶集中在 ${invalid
            .map((b) => b.bucketLabel)
            .slice(0, 3)
            .join('、')}，已排除出本回放的合格 / 节能统计。`
        : '当前无无效桶。'
    }`,
    basis: [
      ...invalid
        .slice(0, 4)
        .map((b) => `${b.machineId} ${b.bucketLabel}：${reasonLabels(b.reasonCodes)}`),
      ...review
        .slice(0, 4)
        .map((b) => `${b.machineId} ${b.bucketLabel}：${reasonLabels(b.reasonCodes)}`),
    ],
    unknowns: [
      '缺值一律不填零，review/invalid 桶不参与任何合格率 / 节能率。',
      '质量分级仅针对合成夹具内建规则，不代表现场数据质量水平。',
    ],
    actions: [
      invalid.length > 0
        ? '将 invalid 桶转人工核验数据源与采集链路。'
        : '保持常规抽检。',
      review.length > 0
        ? '对 review 桶确认流量恒等式、运行状态与档案量程。'
        : '无需额外复核。',
    ],
  }

  const healthRole: ChainRole = {
    id: 'equipment_health',
    name: '设备健康员',
    consumes: [
      'health[].ruleId',
      'health[].threshold',
      'health[].window',
      'health[].basisMinutes',
      'quality[].validSampleCount',
    ],
    conclusion: `规则异常提示 ${health.length} 条（非故障预测、非喘振真值、不含准确率）。`,
    basis: health.length
      ? health
          .slice(0, 5)
          .map(
            (f) =>
              `${f.machineId} ${f.ruleLabel}（阈值 ${f.threshold}，${f.window}）`,
          )
      : ['未触发演示阈值内的规则异常提示。'],
    unknowns: [
      '官方两台离心机喘振与启停边界未核实，不能据此推断喘振风险。',
      '缺少故障标签真值，不输出故障预测与准确率。',
    ],
    actions: [
      health.length
        ? '形成待观察清单，交由设备健康员结合档案复核。'
        : '维持现有观察频率。',
      '任何规则异常提示均不自动下发起停指令。',
    ],
  }

  return {
    scope: 'history',
    roles: [dataQualityRole, healthRole],
    status,
    counts: {
      total: quality.length,
      pass: summary.pass,
      review: summary.review,
      invalid: summary.invalid,
    },
    reasons,
    manualActions,
    unknowns: [
      '回放夹具为只读合成数据，不进入调度候选、不产生启停指令或批准动作。',
      'invalid / review 只影响本回放数据的可信统计，不影响任何合成调度场景的可行性。',
      '功率不齐的桶不给出完整桶能量（记为未知），只给出有覆盖说明的观测部分积分；缺值不填零。',
    ],
    energyIntegralTrustedKwh: summary.energyIntegralTrustedKwh,
    observedPartialEnergyKwh: summary.observedPartialEnergyKwh,
    observedCoveredMinutes: summary.observedCoveredMinutes,
    observedExpectedMinutes: summary.observedExpectedMinutes,
  }
}

export function historyStatusToChainStatus(
  status: HistoryReviewStatus,
): DecisionChainResult['overallStatus'] {
  if (status === 'blocked') return 'blocked'
  if (status === 'review') return 'conditional'
  return 'ready'
}