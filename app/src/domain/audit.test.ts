import { describe, expect, it } from 'vitest'
import {
  RULE_VERSION,
  exportCsv,
  exportHtmlReport,
  exportJson,
  isCurrentRuleVersion,
  makeAuditEvent,
  nextEventId,
  planSummary,
  type AuditEvent,
  type AuditExportState,
} from './audit'
import { runScenario } from './engine'
import { aggregateQuality, summarizeQuality } from './quality'
import { buildHistoryFixture } from './history'
import { SCENARIOS } from './demand'
import { FIXED_SEED, UNITS } from './units'
import type { ApprovalDecision } from './types'

function sampleEvent(): AuditEvent {
  return makeAuditEvent([], {
    kind: 'qa',
    scenario: 'normal',
    sourceIds: ['synthetic_schedule', 'synthetic_history'],
    sourceScope: 'both',
    inputSummary: '为什么建议被拒绝？, 含逗号',
    conclusion: '包含"引号"的结论',
    evidenceIds: ['safety-verdict', 'period:40'],
    operatorAction: '规则解释',
    at: '2026-09-30T00:00:00.000Z',
  })
}

function sampleDecision(overrides: Partial<ApprovalDecision> = {}): ApprovalDecision {
  return {
    id: 'normal-1',
    scenario: 'normal',
    action: 'approve',
    reason: '演示批准理由',
    createdAt: '2026-10-01 10:00:00',
    createdAtIso: '2026-10-01T02:00:00.000Z',
    synthetic: true,
    sourceId: 'synthetic_schedule',
    runRef: 'synthetic_schedule:normal:seed=20260929',
    candidateRef: 'AC-01+AC-02',
    ruleVersion: RULE_VERSION,
    planSignature: 'F|96|sig',
    auditId: 'evt-0001',
    ...overrides,
  }
}

function sampleState(
  events: AuditEvent[],
  decisions: ApprovalDecision[] = [],
): AuditExportState {
  const run = runScenario('normal', UNITS, FIXED_SEED)
  const fixture = buildHistoryFixture('fx_baseline')
  const buckets = aggregateQuality(fixture)
  const quality = summarizeQuality(buckets)
  return {
    generatedAt: '2026-09-30T00:00:00.000Z',
    scenarioLabel: SCENARIOS[0].label,
    sourceLabels: ['合成调度示例', '合成回放夹具'],
    ruleVersion: RULE_VERSION,
    runIdentity: 'legacy:synthetic_schedule:normal:seed=20260929:plan=test',
    plan: {
      baselineSwitches: run.baseline.totalSwitches,
      recommendationSwitches: run.recommendation.feasible
        ? run.recommendation.totalSwitches
        : null,
      baselineEnergyKwh: run.baseline.totalEnergyKwh,
      recommendationEnergyKwh: run.recommendation.feasible
        ? run.recommendation.totalEnergyKwh
        : null,
      recommendationFeasible: run.recommendation.feasible,
      baselineViolations: run.baseline.violationCount,
      recommendationViolations: run.recommendation.feasible
        ? run.recommendation.violationCount
        : null,
    },
    quality,
    qualityBuckets: buckets.map((b) => ({
      machineId: b.machineId,
      bucketLabel: b.bucketLabel,
      grade: b.grade,
      energyIntegralKwh: b.energyIntegralKwh,
      observedPartialEnergyKwh: b.observedPartialEnergyKwh,
      powerCoveredMinutes: b.powerCoveredMinutes,
      expectedMinutes: b.expectedMinutes,
    })),
    history: { status: 'blocked', reasons: ['回放夹具存在无效桶'] },
    events,
    decisions,
    localOnly: true,
  }
}

describe('审计事件与导出', () => {
  it('事件 ID 递增且带规则版本', () => {
    const first = makeAuditEvent([], {
      kind: 'recompute',
      scenario: 'normal',
      sourceIds: ['synthetic_schedule'],
      sourceScope: 'schedule',
      inputSummary: '重算',
      conclusion: '完成',
      evidenceIds: [],
      operatorAction: '重算',
    })
    expect(first.id).toBe('evt-0001')
    expect(first.ruleVersion).toBe(RULE_VERSION)
    const second = makeAuditEvent([first], {
      kind: 'export',
      scenario: 'normal',
      sourceIds: [],
      sourceScope: 'both',
      inputSummary: '导出',
      conclusion: '完成',
      evidenceIds: [],
      operatorAction: '导出',
    })
    expect(second.id).toBe('evt-0002')
    expect(nextEventId([first, second])).toBe('evt-0003')
  })

  it('CSV 带声明、表头并正确转义', () => {
    const csv = exportCsv(sampleState([sampleEvent()]))
    expect(csv).toContain('合成演示')
    expect(csv).toContain('event_id,time,kind')
    expect(csv).toContain('source_scope')
    expect(csv).toContain('"为什么建议被拒绝？, 含逗号"')
    expect(csv).toContain('"包含""引号""的结论"')
  })

  it('导出按来源分别标识，回放核查与调度结论分开', () => {
    const state = sampleState([sampleEvent()])
    const html = exportHtmlReport(state)
    expect(html).toContain('合成调度来源 · 安全结论')
    expect(html).toContain('合成回放来源 · 只读核查')
    expect(html).toContain('本回放统计被禁用')
    expect(html).not.toContain('调度事故')
  })

  it('JSON 由当前状态生成且含声明', () => {
    const parsed = JSON.parse(exportJson(sampleState([sampleEvent()])))
    expect(parsed.localOnly).toBe(true)
    expect(parsed.ruleVersion).toBe(RULE_VERSION)
    expect(parsed.state.events).toHaveLength(1)
    expect(parsed.declarations.join('')).toContain('未验证 KPI')
  })

  it('HTML 报告包含声明、生成时间与来源', () => {
    const html = exportHtmlReport(sampleState([sampleEvent()]))
    expect(html).toContain('本地演示记录，非生产审计存证')
    expect(html).toContain('2026-09-30T00:00:00.000Z')
    expect(html).toContain('合成回放夹具')
  })

  it('导出保留功率不齐桶的完整能量为 null，不零填充', () => {
    const state = sampleState([sampleEvent()])
    const parsed = JSON.parse(exportJson(state))
    const incomplete = parsed.state.qualityBuckets.find(
      (b: { machineId: string; bucketLabel: string }) =>
        b.machineId === 'C-01' && b.bucketLabel === '09:30-09:45',
    )
    expect(incomplete.energyIntegralKwh).toBeNull()
    expect(incomplete.powerCoveredMinutes).toBe(0)
    const csv = exportCsv(state)
    expect(csv).toContain('unknown')
    expect(csv).toContain('complete_bucket_energy_kwh')
    const html = exportHtmlReport(state)
    expect(html).toContain('未知（不可完整积分）')
  })

  it('JSON 审计事件保留 sourceScope 与 sourceIds，不跨来源混填', () => {
    const parsed = JSON.parse(exportJson(sampleState([sampleEvent()])))
    const ev = parsed.state.events[0]
    expect(ev.sourceScope).toBe('both')
    expect(ev.sourceIds).toEqual(['synthetic_schedule', 'synthetic_history'])
    expect(ev.ruleVersion).toBe(RULE_VERSION)
  })

  it('导出随事件数量变化（非写死样例）', () => {
    const one = exportJson(sampleState([sampleEvent()]))
    const two = exportJson(sampleState([sampleEvent(), sampleEvent()]))
    expect(one).not.toBe(two)
    expect(JSON.parse(two).state.events).toHaveLength(2)
  })

  it('planSummary 区分可行与无解', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED)
    expect(planSummary(run.baseline)).toContain('切换')
    const infeasibleRun = runScenario('surge', UNITS, FIXED_SEED)
    expect(planSummary(infeasibleRun.recommendation)).toContain('无可行建议')
  })

  it('规则版本判定：旧版批准不自动升级，只有现行版本视为当前规则', () => {
    expect(isCurrentRuleVersion(RULE_VERSION)).toBe(true)
    expect(isCurrentRuleVersion('qiheng-rules-v0.4.0')).toBe(false)
    expect(isCurrentRuleVersion(undefined)).toBe(false)
  })

  it('恢复后按已有最大序号生成事件 ID，不重发已有 ID', () => {
    const restored: AuditEvent[] = [
      { ...sampleEvent(), id: 'evt-0005' },
      { ...sampleEvent(), id: 'evt-0002' },
    ]
    expect(nextEventId(restored)).toBe('evt-0006')
  })

  it('JSON 导出含 decisions 实体与 auditId / decisionId 双向关系', () => {
    const linked: AuditEvent = {
      ...sampleEvent(),
      kind: 'approve',
      decisionId: 'normal-1',
      sourceScope: 'schedule',
      sourceIds: ['synthetic_schedule'],
    }
    const parsed = JSON.parse(exportJson(sampleState([linked], [sampleDecision()])))
    expect(parsed.state.decisions).toHaveLength(1)
    const decision = parsed.state.decisions[0]
    expect(decision.id).toBe('normal-1')
    expect(decision.auditId).toBe('evt-0001')
    expect(decision.reason).toBe('演示批准理由')
    expect(decision.ruleVersion).toBe(RULE_VERSION)
    expect(decision.sourceId).toBe('synthetic_schedule')
    expect(decision.runRef).toContain('seed=')
    // 审计侧 decisionId 与决策 auditId 对应
    expect(parsed.state.events[0].decisionId).toBe('normal-1')
  })

  it('CSV 事件新增 decision_id 列并含决策实体段', () => {
    const csv = exportCsv(sampleState([sampleEvent()], [sampleDecision()]))
    expect(csv).toContain('decision_id')
    expect(csv).toContain('decision_id,scenario,action,reason,created_at')
    expect(csv).toContain('normal-1')
    expect(csv).toContain('synthetic_schedule:normal:seed=20260929')
  })

  it('HTML 列出同一决策及对应审计 ID', () => {
    const html = exportHtmlReport(sampleState([sampleEvent()], [sampleDecision()]))
    expect(html).toContain('决策实体')
    expect(html).toContain('normal-1')
    expect(html).toContain('evt-0001')
    expect(html).toContain('关联审计 ID')
  })

  it('导出先成文件、后记事件：文件不含随后新增的导出事件', () => {
    const base = [sampleEvent()]
    const state = sampleState(base, [sampleDecision()])
    const json = exportJson(state)
    const exportEvent = makeAuditEvent(base, {
      kind: 'export',
      scenario: 'normal',
      sourceIds: ['synthetic_schedule', 'synthetic_history'],
      sourceScope: 'both',
      inputSummary: '导出 JSON',
      conclusion: '完成',
      evidenceIds: [],
      operatorAction: '导出本地演示记录',
    })
    // 文件在记录导出事件之前生成，不含该事件
    expect(json).not.toContain(exportEvent.id)
    expect(JSON.parse(json).state.events).toHaveLength(1)
    // 记录后才在下一份状态中出现
    const after = exportJson(sampleState([...base, exportEvent], [sampleDecision()]))
    expect(after).toContain(exportEvent.id)
  })
})