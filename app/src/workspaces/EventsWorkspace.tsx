import { useEffect, useMemo, useRef, useState } from 'react'
import { useEvidenceFocus, type EvidenceFocus } from '../components/useEvidenceFocus'
import DecisionChainView from '../components/DecisionChainView'
import DecisionDetailPanel from '../components/DecisionDetailPanel'
import SafetyReviewPanel from '../components/SafetyReviewPanel'
import HistoryReviewPanel from '../components/HistoryReviewPanel'
import EventTimeline from '../components/EventTimeline'
import SupplyGapPanel from '../components/SupplyGapPanel'
import { Popover } from '../components/ui/Disclosure'
import '../styles/events-list.css'
import {
  historyStatusToChainStatus,
  runHistoryChain,
  runScheduleChain,
} from '../domain/chain'
import type { ScenarioRun } from '../domain/engine'
import { analyzeSupplyGap } from '../domain/capacity'
import { verifyPlanConstraints } from '../domain/constraints'
import { buildTimeline, type EventCategory, type EventLocate, type TimelineEvent } from '../domain/events'
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

  // r44 F · 一级扫读列表 + 二级详情抽屉：级别/对象/家族映射均取自真实字段。
  const levelOf = (e: TimelineEvent): 'normal' | 'warn' | 'severe' | 'unknown' => {
    if (/拒绝|阻断|无效|禁用|无解/.test(e.status)) return 'severe'
    if (/待复核|需关注|须重审|待值班|历史/.test(e.status)) return 'warn'
    if (/通过|可行|允许|已批准|已驳回|提示/.test(e.status)) return 'normal'
    return 'unknown'
  }
  const objectOf = (e: TimelineEvent): string => {
    if (e.locate && e.locate.kind === 'history') return e.locate.machineId
    if (e.category === 'schedule') return '调度建议'
    if (e.category === 'safety_review') return '复验/安全链'
    if (e.category === 'human_action') return '人工处置'
    return '全站'
  }
  const CATEGORY_LABEL: Record<EventCategory, string> = {
    data_quality: '数据质量',
    health_rule: '规则异常',
    schedule: '调度',
    safety_review: '复验审查',
    human_action: '人工处置',
  }
  const [tab, setTab] = useState<'all' | 'attention' | 'dq' | 'hr' | 'sched' | 'human'>('all')
  const inTab = (e: TimelineEvent) =>
    tab === 'all' ||
    (tab === 'attention' && (levelOf(e) === 'warn' || levelOf(e) === 'severe')) ||
    (tab === 'dq' && e.category === 'data_quality') ||
    (tab === 'hr' && e.category === 'health_rule') ||
    (tab === 'sched' && (e.category === 'schedule' || e.category === 'safety_review')) ||
    (tab === 'human' && e.category === 'human_action')
  const filtered = timeline.filter(inTab)
  const countWarn = timeline.filter((e) => levelOf(e) === 'warn').length
  const countBad = timeline.filter((e) => levelOf(e) === 'severe').length
  const selectedEvent = timeline.find((e) => e.id === selectedEventId) ?? null
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const deepRef = useRef<HTMLDetailsElement | null>(null)
  const lastRowRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedEvent) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setSelectedEventId(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedEvent])
  useEffect(() => {
    if (!selectedEvent && lastRowRef.current) {
      rowRefs.current[lastRowRef.current]?.focus()
      lastRowRef.current = null
    }
  }, [selectedEvent])
  const tabs: Array<{ id: typeof tab; label: string; n: number }> = [
    { id: 'all', label: '全部', n: timeline.length },
    { id: 'attention', label: '需关注', n: countWarn + countBad },
    { id: 'dq', label: '数据质量', n: timeline.filter((e) => e.category === 'data_quality').length },
    { id: 'hr', label: '规则异常', n: timeline.filter((e) => e.category === 'health_rule').length },
    { id: 'sched', label: '调度与复验', n: timeline.filter((e) => e.category === 'schedule' || e.category === 'safety_review').length },
    { id: 'human', label: '人工处置', n: timeline.filter((e) => e.category === 'human_action').length },
  ]

  return (
    <div className="workspace">
      <section className="qel" aria-label="事件一级列表">
        <div className="qel-head">
          <div>
            <p className="qel-eyebrow">EVENTS / 事件</p>
            <h2 className="qel-title">事件</h2>
            <p className="qel-sub">先看需关注的事件，再打开对象与证据。</p>
          </div>
          <div className="qel-head-actions">
            {observationLabel ? (
              <Popover
                label={<span className="tag muted">{observationLabel} · 同源时刻</span>}
                ariaLabel={`同源观察时刻 ${observationLabel}：来源与共用说明`}
              >
                <div className="source-details-body">
                  <p>同源观察时刻 {observationLabel}：调度视图与回放视图的观察时间对齐，但两个来源分别选择、互不混用。</p>
                  <p className="hint">观察时刻只作时间对齐回显，不参与任何审批判定。</p>
                </div>
              </Popover>
            ) : null}
          </div>
        </div>

        <ul className="qel-counts">
          <li className="qel-count"><b>{timeline.length}</b><span>事件总数</span></li>
          <li className="qel-count is-warn"><b>{countWarn}</b><span>待复核/需关注</span></li>
          <li className="qel-count is-bad"><b>{countBad}</b><span>无效/阻断/拒绝</span></li>
          <li className="qel-count"><b>{decisions.filter((d) => d.scenario === scenario).length}</b><span>人工处置记录</span></li>
        </ul>

        <div className="qel-tabs" role="group" aria-label="事件分类">
          {tabs.map((t) => (
            <button key={t.id} type="button" className="qel-tab" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label} <span className="qel-tab-n">{t.n}</span>
            </button>
          ))}
        </div>

        <div className="qel-filters">
          <label className="qel-field">
            <span>调度场景（合成调度）</span>
            <select value={scenario} onChange={(e) => onScenarioChange(e.target.value as ScenarioId)}>
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <label className="qel-field">
            <span>回放夹具（合成历史）</span>
            <select value={fixtureId} onChange={(e) => onFixtureChange(e.target.value)}>
              {HISTORY_FIXTURES.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </label>
          <details className="qel-note qel-tech">
            <summary>来源与边界详情</summary>
            <div className="source-details-body">
              <p>合成调度示例 · 固定种子 {run.series.seed} · {DATA_SOURCES.synthetic_schedule.scope}</p>
              <p>合成回放夹具 · 固定种子 {FIXED_HISTORY_SEED} · {DATA_SOURCES.synthetic_history.scope}（只读，与调度来源完全分开）</p>
              <p>{SCHEDULE_CENTRIFUGAL_EXCLUSION_NOTE}</p>
            </div>
          </details>
        </div>

        <div className="qel-list-wrap">
          <ul className="qel-list">
            {filtered.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="qel-row"
                  ref={(el) => { rowRefs.current[e.id] = el }}
                  aria-expanded={selectedEventId === e.id}
                  onClick={() => { lastRowRef.current = e.id; setSelectedEventId(e.id) }}
                >
                  <span className="qel-cell-time qel-time">{e.time}</span>
                  <span className="qel-cell-level"><span className={`qel-lv qel-lv--${levelOf(e)}`}>{e.status}</span></span>
                  <span className="qel-cell-object">{objectOf(e)}<span className="qel-object-kind">{CATEGORY_LABEL[e.category]}</span></span>
                  <span className="qel-cell-summary qel-summary">{e.title}</span>
                  <span className="qel-cell-source">
                    <span className={`qel-family qel-family--${e.source === 'synthetic_history' ? 'offline' : 'synthetic'}`}>
                      {e.source === 'synthetic_history' ? '合成回放' : '合成调度'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {filtered.length === 0 ? (
              <li><p className="qel-empty">当前筛选下无事件。</p></li>
            ) : null}
          </ul>
        </div>
      </section>

      {selectedEvent ? (
        <div className="qel-scrim" onClick={() => setSelectedEventId(null)}>
          <aside
            className="qel-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qel-drawer-h"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="qel-drawer-head">
              <div>
                <span className={`qel-lv qel-lv--${levelOf(selectedEvent)}`}>{selectedEvent.status}</span>
                <h3 id="qel-drawer-h">{selectedEvent.title}</h3>
                <div className="qel-drawer-tags">
                  <span className="qel-family">{CATEGORY_LABEL[selectedEvent.category]}</span>
                  <span className={`qel-family qel-family--${selectedEvent.source === 'synthetic_history' ? 'offline' : 'synthetic'}`}>
                    {selectedEvent.source === 'synthetic_history' ? '合成回放夹具' : '合成调度示例'}
                  </span>
                  <span className="qel-time">{selectedEvent.time}</span>
                </div>
              </div>
              <button type="button" className="qel-close" onClick={() => setSelectedEventId(null)}>关闭 Esc</button>
            </div>

            <section className="qel-sec">
              <h4><span className="qel-sec-n">1</span>发生了什么</h4>
              <p className="qel-sec-note">{selectedEvent.reason}</p>
              <p className="qel-sec-note">{selectedEvent.detail}</p>
            </section>
            <section className="qel-sec">
              <h4><span className="qel-sec-n">2</span>影响对象</h4>
              <dl className="qel-facts">
                <div><dt>对象</dt><dd>{objectOf(selectedEvent)}</dd></div>
                <div><dt>时轴定位</dt><dd>{selectedEvent.locate ? `${selectedEvent.locate.label}（${selectedEvent.locate.kind === 'history' ? '回放时轴' : '调度时轴'}）` : '未关联时轴'}</dd></div>
              </dl>
            </section>
            <section className="qel-sec">
              <h4><span className="qel-sec-n">3</span>证据 / 来源</h4>
              <ul className="qel-lines">
                {selectedEvent.evidenceRefs.map((r) => <li key={r} className="qel-mono">{r}</li>)}
              </ul>
              <p className="qel-sec-note">合成数据、固定种子；只读呈现，不冒充现场记录。</p>
            </section>
            <section className="qel-sec">
              <h4><span className="qel-sec-n">4</span>可执行的下一步</h4>
              <div className="qel-actions">
                {selectedEvent.locate ? (
                  <button type="button" className="qel-btn qel-btn--primary" onClick={() => handleLocate(selectedEvent)}>定位到时轴</button>
                ) : null}
                <button
                  type="button"
                  className="qel-btn"
                  onClick={() => {
                    setSelectedEventId(null)
                    const deep = deepRef.current
                    if (deep) { deep.open = true; deep.scrollIntoView({ block: 'start' }) }
                  }}
                >
                  展开处置与证据深区
                </button>
              </div>
              <p className="qel-sec-note">只读事件不提供“已处理/已解决”等假状态；批准/驳回仅在复验人审深区内由人执行。</p>
            </section>
            <details className="qel-tech">
              <summary>技术原件（JSON）</summary>
              <pre>{JSON.stringify(selectedEvent, null, 2)}</pre>
            </details>
          </aside>
        </div>
      ) : null}

      <details className="panel" ref={deepRef}>
        <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>处置与证据深区（对照 / 证据链 / 批准入口，按需展开）</summary>

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
      </details>
    </div>
  )
}