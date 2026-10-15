import { useMemo, useState } from 'react'
import SourceBadge from '../components/SourceBadge'
import RoleViews from '../components/RoleViews'
import AuditPanel, { type AuditExportFeedback } from '../components/AuditPanel'
import PassportPanel from '../components/PassportPanel'
import type { EvidenceContext, EvidenceWorkspace } from '../domain/evidence'
import { runHistoryChain, runScheduleChain } from '../domain/chain'
import type { ScenarioRun } from '../domain/engine'
import { verifyPlanConstraints } from '../domain/constraints'
import { assessHealth } from '../domain/health'
import {
  FIXED_HISTORY_SEED,
  HISTORY_FIXTURES,
  buildHistoryFixture,
} from '../domain/history'
import { aggregateQuality, summarizeQuality } from '../domain/quality'
import { SCENARIOS } from '../domain/demand'
import type { EffectiveDecision } from '../domain/approval'
import type { ApprovalDecision, ScenarioId } from '../domain/types'
import {
  RULE_VERSION,
  exportCsv,
  exportHtmlReport,
  exportJson,
  makeAuditEvent,
  type AuditEvent,
  type AuditExportState,
} from '../domain/audit'

interface Props {
  scenario: ScenarioId
  onScenarioChange: (id: ScenarioId) => void
  /** App 唯一 activeRun（旧版冻结示例或 lab 选定夹具 + 策略）。 */
  run: ScenarioRun
  runIdentity: string
  scenarioLabel: string
  /** 记录子页：audit | export。 */
  subroute?: string
  fixtureId: string
  onFixtureChange: (id: string) => void
  decisions: ApprovalDecision[]
  auditEvents: AuditEvent[]
  effectiveDecision: EffectiveDecision
  onAudit: (partial: Parameters<typeof makeAuditEvent>[1]) => void
  onJump: (workspace: EvidenceWorkspace, target: string, originId?: string) => void
  /** M29 · 真实 passportId 定位（来自 route.query）。 */
  passportId?: string | null
  /** M29 r30 · 目的页来自 agent/map 时的返回本次来源入口。 */
  returnSourceLabel?: string
  onReturnToSource?: () => void
  onOpenExecution?: (target: { passportId: string; candidateId: string; triggerId: string }) => void
}

function downloadFile(name: string, content: string, mime: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    throw new Error('当前环境不支持浏览器下载')
  }
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function AssistantWorkspace({
  scenario,
  onScenarioChange,
  run,
  runIdentity,
  scenarioLabel,
  subroute = 'audit',
  fixtureId,
  onFixtureChange,
  decisions,
  auditEvents,
  onAudit,
  onJump,
  passportId = null,
  returnSourceLabel,
  onReturnToSource,
  onOpenExecution,
}: Props) {
  const [exportFeedback, setExportFeedback] = useState<AuditExportFeedback | null>(null)

  const fixture = useMemo(
    () => buildHistoryFixture(fixtureId, FIXED_HISTORY_SEED),
    [fixtureId],
  )
  const quality = useMemo(() => aggregateQuality(fixture), [fixture])
  const health = useMemo(() => assessHealth(fixture), [fixture])
  const scheduleChain = useMemo(
    () => runScheduleChain({ scenario, scenarioLabel, run }),
    [scenario, scenarioLabel, run],
  )
  const historyReview = useMemo(
    () => runHistoryChain({ fixture, quality, health }),
    [fixture, quality, health],
  )

  const ctx: EvidenceContext = useMemo(
    () => ({
      run,
      quality,
      health,
      scheduleChain,
      historyReview,
      fixture,
      scenarioLabel,
      auditEvents,
    }),
    [
      run,
      quality,
      health,
      scheduleChain,
      historyReview,
      fixture,
      scenarioLabel,
      auditEvents,
    ],
  )

  // 只把“当前有效”处置传给问答，避免旧版 / 未关联审计的记录在问答里被说成已批准。
  const exportState: AuditExportState = useMemo(() => {
    const summary = summarizeQuality(quality)
    const rec = run.recommendation
    const recVerified = verifyPlanConstraints(rec, run)
    const baseVerified = verifyPlanConstraints(run.baseline, run)
    const recFeasible = rec.feasible && recVerified.passed
    return {
      generatedAt: new Date().toISOString(),
      scenarioLabel,
      sourceLabels: ['合成调度示例', '合成回放夹具'],
      ruleVersion: RULE_VERSION,
      runIdentity,
      plan: {
        baselineSwitches: run.baseline.totalSwitches,
        recommendationSwitches: recFeasible ? rec.totalSwitches : null,
        baselineEnergyKwh: run.baseline.totalEnergyKwh,
        recommendationEnergyKwh: recFeasible ? rec.totalEnergyKwh : null,
        recommendationFeasible: recFeasible,
        baselineViolations: baseVerified.violationCount,
        recommendationViolations: recFeasible ? recVerified.violationCount : null,
      },
      quality: summary,
      qualityBuckets: quality.map((b) => ({
        machineId: b.machineId,
        bucketLabel: b.bucketLabel,
        grade: b.grade,
        energyIntegralKwh: b.energyIntegralKwh,
        observedPartialEnergyKwh: b.observedPartialEnergyKwh,
        powerCoveredMinutes: b.powerCoveredMinutes,
        expectedMinutes: b.expectedMinutes,
      })),
      history: {
        status: historyReview.status,
        reasons: historyReview.reasons,
      },
      events: auditEvents,
      decisions,
      localOnly: true,
    }
  }, [run, quality, scenarioLabel, historyReview, auditEvents, decisions, runIdentity])

  const handleExport = (format: 'json' | 'csv' | 'html') => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const name =
      format === 'json'
        ? `qiheng-audit-${stamp}.json`
        : format === 'csv'
          ? `qiheng-audit-${stamp}.csv`
          : `qiheng-report-${stamp}.html`
    const content =
      format === 'json'
        ? exportJson(exportState)
        : format === 'csv'
          ? exportCsv(exportState)
          : exportHtmlReport(exportState)
    const mime =
      format === 'json'
        ? 'application/json'
        : format === 'csv'
          ? 'text/csv'
          : 'text/html'

    try {
      downloadFile(name, content, mime)
    } catch (error) {
      // 失败就近给出理由，不假装成功。
      setExportFeedback({
        format,
        ok: false,
        fileName: name,
        eventCount: exportState.events.length,
        reason: error instanceof Error ? error.message : '未知错误',
      })
      return
    }

    setExportFeedback({
      format,
      ok: true,
      fileName: name,
      eventCount: exportState.events.length,
    })
    onAudit({
      kind: 'export',
      scenario,
      sourceIds: ['synthetic_schedule', 'synthetic_history'],
      sourceScope: 'both',
      inputSummary: `导出 ${format.toUpperCase()}`,
      conclusion: `导出由当前状态生成：规则版本 ${RULE_VERSION}，事件 ${exportState.events.length} 条。`,
      evidenceIds: ['safety-verdict'],
      operatorAction: '导出本地演示记录',
    })
  }

  return (
    <div className="workspace" data-subroute={subroute}>
      {onReturnToSource ? (
        <div className="source-return"><button type="button" className="btn ghost" onClick={onReturnToSource}>← 返回本次{returnSourceLabel ?? '来源'}入口</button></div>
      ) : null}
      <SourceBadge sourceId="synthetic_schedule" seed={run.series.seed} />
      <SourceBadge sourceId="synthetic_history" seed={FIXED_HISTORY_SEED} />

      <section className="panel">
        <div className="panel-head">
          <h2>对象选择</h2>
        </div>
        <div className="toolbar">
          <label className="field">
            <span>调度场景</span>
            <select
              value={scenario}
              onChange={(e) => onScenarioChange(e.target.value as ScenarioId)}
            >
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>回放夹具</span>
            <select value={fixtureId} onChange={(e) => onFixtureChange(e.target.value)}>
              {HISTORY_FIXTURES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <div>
        <section className="panel">
          <div className="panel-head"><h2>可信问答（聊天）已并入智能体工作区</h2></div>
          <p className="hint">本页保留记录/角色/审计/护照深区；聊天会话请走智能体入口（同一会话快照恢复）。</p>
          <a className="btn" href="#/agent">进入智能体聊天 →</a>
        </section>
      </div>

      <RoleViews ctx={ctx} auditEvents={auditEvents} onJump={onJump} />

      <AuditPanel state={exportState} onExport={handleExport} feedback={exportFeedback} />

      <PassportPanel mode="records" initialPassportId={passportId} onOpenExecution={onOpenExecution} />
    </div>
  )
}