import type { QualitySummary } from './quality'
import type { ApprovalDecision, PlanResult, ScenarioId } from './types'
import type { SourceId, SourceScope } from './sources'

export const RULE_VERSION = 'qiheng-rules-v0.5.0'

/**
 * 规则合同版本判定：只有当前规则版本产生的审批才视为“按现行规则复核”。
 * 旧版本审批不自动升级、不删除，仍需人工按新规则重新审查。
 */
export function isCurrentRuleVersion(version?: string): boolean {
  return version === RULE_VERSION
}

export type AuditKind = 'recompute' | 'qa' | 'approve' | 'reject' | 'export'

export interface AuditEvent {
  id: string
  at: string
  kind: AuditKind
  scenario: ScenarioId | 'n/a'
  sourceIds: SourceId[]
  sourceScope: SourceScope
  inputSummary: string
  conclusion: string
  evidenceIds: string[]
  ruleVersion: string
  operatorAction: string
  beforePlanSummary?: string
  afterPlanSummary?: string
  rejectionReason?: string
  /**
   * 与该审计事件关联的决策 ID（审计 → 决策）。
   * 新决策与真实新审计事件建立双向 ID 关联；被阻断的批准尝试为 null。
   */
  decisionId?: string | null
}

export interface AuditExportState {
  generatedAt: string
  scenarioLabel: string
  sourceLabels: string[]
  ruleVersion: string
  /** 当前 run 的完整身份串（旧版或 lab），与审批 / 页面来源一致，不硬编码种子。 */
  runIdentity: string
  plan: {
    baselineSwitches: number
    recommendationSwitches: number | null
    baselineEnergyKwh: number
    recommendationEnergyKwh: number | null
    recommendationFeasible: boolean
    baselineViolations: number
    recommendationViolations: number | null
  }
  quality: QualitySummary
  qualityBuckets: Array<{
    machineId: string
    bucketLabel: string
    grade: string
    energyIntegralKwh: number | null
    observedPartialEnergyKwh: number
    powerCoveredMinutes: number
    expectedMinutes: number
  }>
  history: {
    status: 'trusted' | 'review' | 'blocked'
    reasons: string[]
  }
  events: AuditEvent[]
  /**
   * 决策实体快照：导出必须包含决策本身（理由 / 时间 / 版本 / 来源 / 绑定 /
   * auditId），而不是只在页面上说“有决策”。与 events[].decisionId 构成双向关系。
   */
  decisions: ApprovalDecision[]
  localOnly: true
}

export const DEMO_DECLARATIONS = [
  '合成演示：全部数据为固定种子合成，非现场实测。',
  '非现场收益：估算耗电与差值为模型推算，不代表现场节能收益。',
  '未验证 KPI：压力合格率、喘振预警率、节能率、停机下降率均未验证。',
  '本地演示记录，非生产审计存证：记录仅保存在浏览器本地，不防篡改、非企业级审计。',
]

export function planSummary(plan: PlanResult): string {
  if (!plan.feasible) {
    return `无可行建议（${plan.infeasibleReasons[0] ?? '存在无解时段'}）；基线切换 ${plan.totalSwitches} 次、估算耗电 ${plan.totalEnergyKwh.toFixed(1)} kWh、违规 ${plan.violationCount} 项`
  }
  return `切换 ${plan.totalSwitches} 次、估算耗电 ${plan.totalEnergyKwh.toFixed(1)} kWh、违规 ${plan.violationCount} 项（模型推算，非现场收益）`
}

/**
 * 下一个审计事件 ID：取已有 `evt-<n>` 的最大序号 + 1，而不是 length+1。
 * 这样在恢复（例如已有 evt-0002）后新增不会再次生成 evt-0002。
 */
export function nextEventId(events: AuditEvent[]): string {
  let max = 0
  for (const event of events) {
    const match = /^evt-(\d+)$/.exec(event.id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `evt-${String(max + 1).padStart(4, '0')}`
}

export function makeAuditEvent(
  events: AuditEvent[],
  partial: Omit<AuditEvent, 'id' | 'at' | 'ruleVersion'> & {
    id?: string
    at?: string
  },
): AuditEvent {
  return {
    id: partial.id ?? nextEventId(events),
    at: partial.at ?? new Date().toISOString(),
    ruleVersion: RULE_VERSION,
    kind: partial.kind,
    scenario: partial.scenario,
    sourceIds: partial.sourceIds,
    sourceScope: partial.sourceScope,
    inputSummary: partial.inputSummary,
    conclusion: partial.conclusion,
    evidenceIds: partial.evidenceIds,
    operatorAction: partial.operatorAction,
    beforePlanSummary: partial.beforePlanSummary,
    afterPlanSummary: partial.afterPlanSummary,
    rejectionReason: partial.rejectionReason,
    decisionId: partial.decisionId,
  }
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value === undefined || value === null ? '' : String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function exportCsv(state: AuditExportState): string {
  const header = [
    'event_id',
    'time',
    'kind',
    'scenario',
    'sources',
    'source_scope',
    'input_summary',
    'conclusion',
    'evidence_ids',
    'rule_version',
    'operator_action',
    'before_plan',
    'after_plan',
    'rejection_reason',
    'decision_id',
  ].join(',')
  const lines = state.events.map((e) =>
    [
      e.id,
      e.at,
      e.kind,
      e.scenario,
      e.sourceIds.join('|'),
      e.sourceScope,
      e.inputSummary,
      e.conclusion,
      e.evidenceIds.join('|'),
      e.ruleVersion,
      e.operatorAction,
      e.beforePlanSummary,
      e.afterPlanSummary,
      e.rejectionReason,
      e.decisionId ?? '',
    ]
      .map(csvEscape)
      .join(','),
  )
  const declarations = DEMO_DECLARATIONS.map((d) => `# ${d}`).join('\n')
  const bucketHeader = [
    'machine_id',
    'bucket',
    'grade',
    'complete_bucket_energy_kwh',
    'observed_partial_energy_kwh',
    'power_covered_minutes',
    'expected_minutes',
  ].join(',')
  const bucketLines = state.qualityBuckets.map((b) =>
    [
      b.machineId,
      b.bucketLabel,
      b.grade,
      b.energyIntegralKwh === null ? 'unknown' : b.energyIntegralKwh,
      b.observedPartialEnergyKwh,
      b.powerCoveredMinutes,
      b.expectedMinutes,
    ]
      .map(csvEscape)
      .join(','),
  )
  const decisionHeader = [
    'decision_id',
    'scenario',
    'action',
    'reason',
    'created_at',
    'source_id',
    'run_ref',
    'candidate_ref',
    'rule_version',
    'plan_signature',
    'audit_id',
    'migrated',
  ].join(',')
  const decisionLines = state.decisions.map((d) =>
    [
      d.id,
      d.scenario,
      d.action,
      d.reason,
      d.createdAt,
      d.sourceId,
      d.runRef,
      d.candidateRef,
      d.ruleVersion,
      d.planSignature,
      d.auditId,
      d.migrated === true ? 'true' : 'false',
    ]
      .map(csvEscape)
      .join(','),
  )
  return `# run_identity: ${state.runIdentity}\n${declarations}\n${header}\n${lines.join('\n')}\n# 决策实体（与事件的 decision_id / 决策的 audit_id 双向关联）\n${decisionHeader}\n${decisionLines.join('\n')}\n# 回放桶能量（功率不齐时 complete_bucket_energy_kwh 记为 unknown，不填 0）\n${bucketHeader}\n${bucketLines.join('\n')}\n`
}

export function exportJson(state: AuditExportState): string {
  return JSON.stringify(
    {
      declarations: DEMO_DECLARATIONS,
      localOnly: true,
      ruleVersion: state.ruleVersion,
      state,
    },
    null,
    2,
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function exportHtmlReport(state: AuditExportState): string {
  const rows = state.events
    .map(
      (e) => `<tr>
  <td>${escapeHtml(e.id)}</td>
  <td>${escapeHtml(e.at)}</td>
  <td>${escapeHtml(e.kind)}</td>
  <td>${escapeHtml(e.scenario)}</td>
<td>${escapeHtml(e.sourceIds.join(' / '))}</td>
  <td>${escapeHtml(e.sourceScope)}</td>
  <td>${escapeHtml(e.inputSummary)}</td>
  <td>${escapeHtml(e.conclusion)}</td>
  <td>${escapeHtml(e.evidenceIds.join(' / '))}</td>
  <td>${escapeHtml(e.operatorAction)}</td>
  <td>${escapeHtml(e.decisionId ?? '—')}</td>
</tr>`,
    )
    .join('\n')

  const decisionRows = state.decisions
    .map(
      (d) => `<tr>
  <td>${escapeHtml(d.id)}</td>
  <td>${escapeHtml(d.action === 'approve' ? '批准' : '驳回')}${d.migrated ? '（旧版迁移，不生效）' : ''}</td>
  <td>${escapeHtml(d.reason)}</td>
  <td>${escapeHtml(d.createdAt)}</td>
  <td>${escapeHtml(d.ruleVersion ?? '—')}</td>
  <td>${escapeHtml(d.sourceId ?? '—')}</td>
  <td>${escapeHtml(d.runRef ?? '—')}</td>
  <td>${escapeHtml(d.auditId ?? '—')}</td>
</tr>`,
    )
    .join('\n')

  const bucketRows = state.qualityBuckets
    .map(
      (b) => `<tr>
  <td>${escapeHtml(b.machineId)}</td>
  <td>${escapeHtml(b.bucketLabel)}</td>
  <td>${escapeHtml(b.grade)}</td>
  <td>${b.energyIntegralKwh === null ? '未知（不可完整积分）' : b.energyIntegralKwh.toFixed(3)}</td>
  <td>${b.observedPartialEnergyKwh.toFixed(3)}</td>
  <td>${b.powerCoveredMinutes}</td>
  <td>${b.expectedMinutes}</td>
</tr>`,
    )
    .join('\n')

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>气衡演示报告（合成）</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;color:#111}
h1{font-size:20px} .decl{background:#fff7e6;border:1px solid #e0a53a;padding:10px;border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:12px;margin-top:12px}
th,td{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}
th{background:#f2f2f2}
code{background:#f5f5f5;padding:1px 4px}
</style></head><body>
<h1>气衡｜空压站协同决策台 · 演示报告</h1>
<div class="decl"><strong>声明：</strong><ul>${DEMO_DECLARATIONS.map(
    (d) => `<li>${escapeHtml(d)}</li>`,
  ).join('')}</ul></div>
<p>生成时间：<code>${escapeHtml(state.generatedAt)}</code>；规则版本：<code>${escapeHtml(
    state.ruleVersion,
  )}</code>；当前场景：${escapeHtml(state.scenarioLabel)}；数据来源：${escapeHtml(
    state.sourceLabels.join(' / '),
  )}</p>
<p>run 身份：<code>${escapeHtml(state.runIdentity)}</code></p>
<h2>同条件对比（单位：kWh、次、项）</h2>
<ul>
<li>基线切换次数：${state.plan.baselineSwitches}；建议切换次数：${
    state.plan.recommendationSwitches ?? '—'
  }</li>
<li>基线估算耗电：${state.plan.baselineEnergyKwh.toFixed(1)} kWh；建议估算耗电：${
    state.plan.recommendationEnergyKwh === null
      ? '—'
      : `${state.plan.recommendationEnergyKwh.toFixed(1)} kWh`
  }</li>
<li>建议可行：${state.plan.recommendationFeasible ? '是' : '否（无可行建议）'}；基线约束违规：${
    state.plan.baselineViolations
  } 项；建议约束违规：${state.plan.recommendationViolations ?? '—'} 项</li>
</ul>
<h2>合成调度来源 · 安全结论</h2>
<ul>
<li>建议可行：${state.plan.recommendationFeasible ? '是' : '否（无可行建议）'}；基线约束违规：${
    state.plan.baselineViolations
  } 项；建议约束违规：${state.plan.recommendationViolations ?? '—'} 项</li>
</ul>
<h2>合成回放来源 · 只读核查（不参与上述调度可行性 / 批准）</h2>
<ul>
<li>回放状态：${
    state.history.status === 'blocked'
      ? '存在无效桶，本回放统计被禁用'
      : state.history.status === 'review'
        ? '部分待复核'
        : '全部通过'
  }</li>
<li>依据：${state.history.reasons.map(escapeHtml).join('；')}</li>
<li>质量通过：${state.quality.pass}；待复核：${state.quality.review}；无效：${state.quality.invalid}</li>
<li>可信完整桶能量（仅合格且 15 分钟功率齐全的桶）：${state.quality.energyIntegralTrustedKwh.toFixed(3)} kWh</li>
<li>观测部分积分（含不完整桶，仅按实有分钟功率累计，非完整桶能量）：${state.quality.observedPartialEnergyKwh.toFixed(3)} kWh，功率覆盖 ${state.quality.observedCoveredMinutes}/${state.quality.observedExpectedMinutes} 分钟</li>
</ul>
<h2>回放桶能量明细（完整桶能量未知时不填 0）</h2>
<table><thead><tr><th>机组</th><th>桶</th><th>分级</th><th>完整桶能量 (kWh)</th><th>观测部分积分 (kWh)</th><th>功率覆盖分钟</th><th>应有分钟</th></tr></thead>
<tbody>
${bucketRows}
</tbody></table>
<h2>决策实体（与审计事件双向关联）</h2>
<table><thead><tr><th>决策 ID</th><th>动作</th><th>理由</th><th>记录时间</th><th>规则版本</th><th>来源</th><th>运行</th><th>关联审计 ID</th></tr></thead>
<tbody>
${decisionRows}
</tbody></table>
<h2>演示事件记录</h2>
<table><thead><tr><th>事件 ID</th><th>时间</th><th>类型</th><th>场景</th><th>来源</th><th>来源范围</th><th>输入/问题</th><th>结论</th><th>证据 ID</th><th>操作者动作</th><th>决策 ID</th></tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>`
}