import { useEffect, useMemo, useState } from 'react'
import { useEvidenceFocus, type EvidenceFocus } from '../components/useEvidenceFocus'
import DecisionChainView from '../components/DecisionChainView'
import DecisionDetailPanel from '../components/DecisionDetailPanel'
import SafetyReviewPanel from '../components/SafetyReviewPanel'
import HistoryReviewPanel from '../components/HistoryReviewPanel'
import EventTimeline from '../components/EventTimeline'
import SupplyGapPanel from '../components/SupplyGapPanel'
import NoteRef from '../components/console/NoteRef'
import { Popover } from '../components/ui/Disclosure'
import {
  historyStatusToChainStatus,
  runHistoryChain,
  runScheduleChain,
} from '../domain/chain'
import type { ScenarioRun } from '../domain/engine'
import { analyzeSupplyGap } from '../domain/capacity'
import { verifyPlanConstraints } from '../domain/constraints'
import { buildTimeline, type EventLocate, type TimelineEvent } from '../domain/events'
import { assessHealth } from '../domain/health'
import {
  buildHistoryFixture,
  HISTORY_FIXTURES,
  FIXED_HISTORY_SEED,
} from '../domain/history'
import { aggregateQuality } from '../domain/quality'
import { SCENARIOS } from '../domain/demand'
import { DATA_SOURCES, SCHEDULE_CENTRIFUGAL_EXCLUSION_NOTE } from '../domain/sources'

import type { EffectiveDecision } from '../domain/approval'
import type { ApprovalDecision, DecisionOutcome, ScenarioId } from '../domain/types'

interface Props {
  scenario: ScenarioId
  onScenarioChange: (id: ScenarioId) => void
  /** App 唯一 activeRun（旧版冻结示例或 lab 选定夹具 + 策略）。 */
  run: ScenarioRun
  runIdentity: string
  scenarioLabel: string
  fixtureId: string
  onFixtureChange: (id: string) => void
  decisions: ApprovalDecision[]
  onDecision: (action: 'approve' | 'reject', reason: string) => DecisionOutcome
  effectiveDecision: EffectiveDecision
  reviewDraft: string
  onReviewDraftChange: (value: string) => void
  focus?: EvidenceFocus | null
  /** 同源观察时刻（只读回显，不参与任何审批判定）。 */
  observationLabel?: string
  onLocate?: (locate: EventLocate) => void
}

export default function EventsWorkspace({
  scenario,
  onScenarioChange,
  run,
  runIdentity,
  scenarioLabel,
  fixtureId,
  onFixtureChange,
  decisions,
  onDecision,
  effectiveDecision,
  reviewDraft,
  onReviewDraftChange,
  focus,
  observationLabel,
  onLocate,
}: Props) {
  const fixtureLabel =
    HISTORY_FIXTURES.find((f) => f.id === fixtureId)?.label ?? fixtureId

  useEvidenceFocus(focus)

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  useEffect(() => {
    setSelectedEventId(null)
  }, [scenario, fixtureId])

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

  const timeline = useMemo(
    () =>
      buildTimeline({
        run,
        scenarioLabel,
        quality,
        health,
        scheduleChain,
        historyReview,
        decisions: decisions.filter((d) => d.scenario === scenario),
      }),
    [run, scenarioLabel, quality, health, scheduleChain, historyReview, decisions, scenario],
  )

  // “当前有效处置”统一选择器结果：只有来源/场景/运行/规则/完整方案/关联审计全部一致才生效。
  const currentDecision =
    effectiveDecision.status === 'effective' ? effectiveDecision.decision : null
  const historicalDecision =
    effectiveDecision.status !== 'effective' ? effectiveDecision.decision : null

  const supplyGap = useMemo(() => analyzeSupplyGap(run), [run])
  const baselineVerified = useMemo(
    () => verifyPlanConstraints(run.baseline, run),
    [run],
  )
  const recommendationVerified = useMemo(
    () => verifyPlanConstraints(run.recommendation, run),
    [run],
  )
  const recommendationApprovable =
    run.recommendation.feasible && recommendationVerified.passed

  const handleLocate = (event: TimelineEvent) => {
    if (!event.locate) return
    onLocate?.(event.locate)
  }

  return (
    <div className="workspace">
      <section className="panel event-filters">
        <div className="panel-head">
          <h2>事件对象选择</h2>
          <span className="panel-head-tags">
            {observationLabel ? (
              <Popover
                label={<span className="tag muted">同源观察时刻 {observationLabel}</span>}
                ariaLabel={`同源观察时刻 ${observationLabel}：来源与共用说明`}
              >
                <div className="source-details-body">
                  <p>同源观察时刻 {observationLabel}：调度视图与回放视图的观察时间对齐，但两个来源分别选择、互不混用。</p>
                  <p>共用合成调度输入：调度总览、方案比较、复验人审、关联证据（同一场景/种子生成，可互相复算）。</p>
                  <p>读取合成回放来源：历史回放实验台、数据接入与治理事件（只读分钟数据，独立于调度）。</p>
                  <p className="hint">两者不并入同一复验结论；观察时刻只作时间对齐回显，不参与任何审批判定。</p>
                </div>
              </Popover>
            ) : null}
          </span>
        </div>
        <div className="toolbar">
          <NoteRef note="synthetic" />
          <label className="field">
            <span>调度场景（合成调度）</span>
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
            <span>回放夹具（合成历史）</span>
            <select value={fixtureId} onChange={(e) => onFixtureChange(e.target.value)}>
              {HISTORY_FIXTURES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <details className="source-details event-source-details">
            <summary>来源与边界详情</summary>
            <div className="source-details-body">
              <p>
                合成调度示例 · 固定种子 {run.series.seed} · {DATA_SOURCES.synthetic_schedule.scope}
              </p>
              <p>
                合成回放夹具 · 固定种子 {FIXED_HISTORY_SEED} ·{' '}
                {DATA_SOURCES.synthetic_history.scope}（只读，与调度来源完全分开）
              </p>
              <p>{SCHEDULE_CENTRIFUGAL_EXCLUSION_NOTE}</p>
              <ul>
                {[
                  ...DATA_SOURCES.synthetic_schedule.unverifiedBoundaries,
                  ...DATA_SOURCES.synthetic_history.unverifiedBoundaries,
                ].map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </section>

      <EventTimeline
        events={timeline}
        selectedId={selectedEventId}
        onSelect={setSelectedEventId}
        onLocate={handleLocate}
      />

      <SupplyGapPanel gap={supplyGap} />

      <DecisionDetailPanel
        scenario={scenario}
        scenarioLabel={scenarioLabel}
        run={run}
        scheduleChain={scheduleChain}
        verification={recommendationVerified}
        baselineVerification={baselineVerified}
        approval={effectiveDecision}
        runIdentity={runIdentity}
        onSubmit={onDecision}
        draft={reviewDraft}
        onDraftChange={onReviewDraftChange}
      />

      <section className="panel">
        <div className="panel-head">
          <h2>上下文证据 · 同场景对照（合成调度来源）</h2>
          <span className="hint">
            同一调度场景、同一需求序列、同一机组参数与预算；回放夹具不参与
          </span>
        </div>
        <div className="plan-grid">
          {[
            { title: '旧方案（基线）', r: run.baseline, kind: 'baseline' },
            { title: '新方案（建议）', r: run.recommendation, kind: 'recommendation' },
          ].map(({ title, r, kind }) => (
            <article className={`plan-card ${kind}`} key={title}>
              <header>
                <h3>{title}</h3>
                <span
                  className={
                    kind === 'baseline'
                      ? `tag ${baselineVerified.passed ? 'warn' : 'bad'}`
                      : `tag ${recommendationApprovable ? 'ok' : 'bad'}`
                  }
                >
                  {kind === 'baseline'
                    ? baselineVerified.passed
                      ? '对照基线 · 约束复验通过'
                      : `对照基线 · 约束未通过（${baselineVerified.violationCount} 项）`
                    : recommendationApprovable
                      ? '建议可行 · 约束复验通过'
                      : '无可行建议'}
                </span>
              </header>
              <div className="metric-row">
                <span>切换次数</span>
                <strong>{r.totalSwitches}</strong>
              </div>
              <div className="metric-row">
                <span>估算耗电</span>
                <strong>{r.totalEnergyKwh.toFixed(1)} kWh</strong>
              </div>
              <div className="metric-row">
                <span>硬约束违规</span>
                <strong className={r.violationCount > 0 ? 'neg' : 'ok-text'}>
                  {r.violationCount} 项
                </strong>
              </div>
              <div className="metric-row">
                <span>候选机组</span>
                <strong>{run.evaluation.candidates.map((u) => u.id).join('、') || '无'}</strong>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>合成调度来源 · 证据链（检测 → 安全审查 → 人工处置）</h2>
          <span className={`tag ${scheduleChain.safety.verdict === 'reject' ? 'bad' : 'ok'}`}>
            {scheduleChain.safety.verdict === 'reject' ? '调度侧拒绝批准' : '调度侧允许批准'}
          </span>
        </div>
        <ol className="evidence-stepper">
          <li className={scheduleChain.safety.checks.recommendationFeasible ? 'ok' : 'fail'}>
            <span className="step-name">调度检测</span>
            <span>
              建议 {scheduleChain.safety.checks.recommendationFeasible ? '可行' : '无解'} ·
              缺失参数 {scheduleChain.safety.checks.missingKeyParams ? '有' : '无'} ·
              离心机 {scheduleChain.safety.checks.centrifugalExcluded ? '已排除' : '未排除'}
            </span>
          </li>
          <li className={scheduleChain.safety.verdict === 'reject' ? 'fail' : 'ok'}>
            <span className="step-name">调度安全审查</span>
            <span>{scheduleChain.safety.verdict === 'reject' ? '拒绝批准' : '允许批准'}</span>
          </li>
          <li className={currentDecision ? 'ok' : 'pending'}>
            <span className="step-name">人工处置</span>
            <span>
              {currentDecision
                ? `${currentDecision.action === 'approve' ? '当前有效批准' : '当前有效驳回'}：${currentDecision.reason}`
                : historicalDecision
                  ? `有历史处置记录，但不作为当前有效处置：${effectiveDecision.reason}`
                  : '待值班员处置'}
            </span>
          </li>
        </ol>
      </section>

      <DecisionChainView
        title="调度决策链（合成调度来源）"
        roles={scheduleChain.roles}
        overallStatus={scheduleChain.overallStatus}
        statusLabel={
          scheduleChain.overallStatus === 'blocked' ? '阻断（不得批准）' : '就绪（可批准）'
        }
      />

      <SafetyReviewPanel safety={scheduleChain.safety} scenarioLabel={scenarioLabel} />

      <section className="panel">
        <div className="panel-head">
          <h2>合成回放来源 · 只读核查</h2>
          <span className={`tag ${historyReview.status === 'blocked' ? 'bad' : historyReview.status === 'review' ? 'warn' : 'ok'}`}>
            回放侧 {historyReview.status === 'blocked' ? '统计被禁用' : historyReview.status === 'review' ? '待复核' : '全通过'}
          </span>
        </div>
        <p className="hint">
          以下核查只作用于选定回放夹具，不参与上方调度可行性或批准判断；回放侧没有批准按钮。
        </p>
      </section>

      <HistoryReviewPanel review={historyReview} fixtureLabel={fixtureLabel} />

      <DecisionChainView
        title="回放核查链（合成回放来源）"
        roles={historyReview.roles}
        overallStatus={historyStatusToChainStatus(historyReview.status)}
        statusLabel="只读回看（无批准）"
      />
    </div>
  )
}