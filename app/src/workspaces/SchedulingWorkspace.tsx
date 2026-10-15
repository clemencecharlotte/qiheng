import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useEvidenceFocus, type EvidenceFocus } from '../components/useEvidenceFocus'
import UnitRoster, { type UnitDirectoryState } from '../components/UnitRoster'
import type { KpiTarget } from '../components/KpiPanel'
import KpiPanel from '../components/KpiPanel'
import SummaryPanel from '../components/SummaryPanel'
import SupplyGapPanel from '../components/SupplyGapPanel'
import ConstraintPanel from '../components/ConstraintPanel'
import PeriodTable from '../components/PeriodTable'
import SafetyReviewPanel from '../components/SafetyReviewPanel'
import ReviewPathGuide from '../components/ReviewPathGuide'
import DecisionDetailPanel from '../components/DecisionDetailPanel'
import SourceSafetyBar from '../components/SourceSafetyBar'
import RelationEvidence from '../components/evidence/RelationEvidence'
import type { RelationKind } from '../integration/relations'
import StateEvidenceHost from '../components/state/StateEvidenceHost'

const FlowMilpLab = lazy(() => import('../components/FlowMilpLab'))
const PortfolioCompare = lazy(() => import('../components/PortfolioCompare'))
const ExecutionPanel = lazy(() => import('../components/ExecutionPanel'))
const ReplanPanel = lazy(() => import('../components/ReplanPanel'))
import DeviceStage from '../components/DeviceStage'
import SupplyDemandTrend from '../components/SupplyDemandTrend'
import ContextRail from '../components/ContextRail'
import ObservationTransport from '../components/ObservationTransport'
import EvaluationPanel from '../components/EvaluationPanel'
import type { ObservationClockApi } from '../components/useObservationClock'
import type { ScenarioRun } from '../domain/engine'
import { buildOverviewSnapshot, selectStagePlan } from '../domain/overview'
import {
  LAB_DECLARATIONS,
  LAB_FIXTURES,
  buildLabComparison,
  type LabFixtureId,
  type LabPreference,
  type LabRun,
} from '../domain/lab'
import {
  outOfRangeNote,
  presetFull,
  presetLastHour,
  summarizeRange,
} from '../domain/explore'
import { runScheduleChain } from '../domain/chain'
import { SUB_LABEL } from '../domain/router'
import { analyzeSupplyGap } from '../domain/capacity'
import { verifyPlanConstraints } from '../domain/constraints'
import type { EffectiveDecision } from '../domain/approval'
import { detectNarratorConfig } from '../domain/narrator'
import type { ApprovalDecision, DecisionOutcome, ScenarioId } from '../domain/types'
import { Tooltip } from '../components/ui/Disclosure'
import './ConsoleWorkspace.css'

interface Props {
  scenario: ScenarioId
  onScenarioChange: (id: ScenarioId) => void
  /** App 唯一 activeRun：旧版冻结示例或 lab 选定夹具 + 策略。 */
  run: ScenarioRun
  scenarioLabel: string
  runIdentity: string
  mode: 'legacy' | 'lab'
  labFixture: LabFixtureId
  labPreference: LabPreference
  onModeChange: (mode: 'legacy' | 'lab') => void
  onLabFixtureChange: (id: LabFixtureId) => void
  onLabPreferenceChange: (pref: LabPreference) => void
  /** 调度子页：overview | compare | review | evidence（真正条件渲染）。 */
  subroute: string
  effectiveDecision: EffectiveDecision
  /** 子页间导航（下一动作）。 */
  onNavigateSub: (sub: string) => void
  /** 真实来源返回（history.back 或父页 fallback）。 */
  onBack: () => void
  reviewDraft: string
  onReviewDraftChange: (value: string) => void
  linkedUnitId: string | null
  onLinkedUnitChange: (id: string | null) => void
  decisions: ApprovalDecision[]
  onDecision: (
    action: 'approve' | 'reject',
    reason: string,
    expectedRunIdentity?: string,
  ) => DecisionOutcome
  focus?: EvidenceFocus | null
  onRecompute?: (scenario: ScenarioId) => void
  recomputeNonce?: number
  clock: ObservationClockApi
  /** M12 R6：只读关系证据的对象跳转（真实 route 键）。 */
  onOpenBatch?: (batchId: string) => void
  onOpenEvent?: (eventId: string) => void
  onOpenSource?: (sourceId: string) => void
  /** M12 r02：证据关系筛选/选中上下文（宿主持有，路由中立，返回恢复）。 */
  evidenceFilter?: 'all' | RelationKind
  evidenceSelected?: string | null
  onEvidenceFilterChange?: (f: 'all' | RelationKind) => void
  onEvidenceSelect?: (id: string | null) => void
  /** M25 B · 设备目录 → 证据/详情（复用宿主 unit:<id> 定位）。 */
  onOpenEvidenceUnit?: (unitId: string) => void
  /** M27 D · 三分钟评审路径：打开记录/护照（跨工作区，可选）。 */
  onOpenRecords?: () => void
  directoryState?: UnitDirectoryState
  onDirectoryChange?: (state: UnitDirectoryState) => void
  onOpenKpiDestination?: (t: KpiTarget) => void
  evidenceDepth?: 1 | 2
  onEvidenceDepthChange?: (d: 1 | 2) => void
}

export default function SchedulingWorkspace({
  scenario,
  onScenarioChange,
  run,
  scenarioLabel,
  runIdentity,
  mode,
  labFixture,
  labPreference,
  onModeChange,
  onLabFixtureChange,
  onLabPreferenceChange,
  subroute,
  effectiveDecision,
  onNavigateSub,
  onBack,
  onOpenEvidenceUnit,
  onOpenRecords,
  evidenceDepth,
  onEvidenceDepthChange,
  onOpenKpiDestination,
  directoryState,
  onDirectoryChange,
  reviewDraft,
  onReviewDraftChange,
  linkedUnitId,
  onLinkedUnitChange,
  decisions: _decisions,
  onDecision,
  focus,
  onRecompute,
  recomputeNonce: _recomputeNonce = 0,
  clock,
  onOpenBatch,
  onOpenEvent,
  onOpenSource,
  evidenceFilter,
  evidenceSelected,
  onEvidenceFilterChange,
  onEvidenceSelect,
}: Props) {
  const [hoverUnitId, setHoverUnitId] = useState<string | null>(null)

  const scheduleChain = useMemo(
    () => runScheduleChain({ scenario, scenarioLabel, run }),
    [scenario, scenarioLabel, run],
  )
  const approvable = scheduleChain.safety.verdict === 'allow'
  const blockReasons = approvable ? [] : scheduleChain.safety.reasons
  const narratorConfig = useMemo(() => detectNarratorConfig(), [])

  const stageSelection = useMemo(() => selectStagePlan(run), [run])
  const supplyGap = useMemo(() => analyzeSupplyGap(run), [run])
  const lab = mode === 'lab' ? (run as LabRun).lab : null
  const labCompare = useMemo(
    () => (mode === 'lab' ? buildLabComparison(labFixture, labPreference) : null),
    [mode, labFixture, labPreference],
  )
  const recommendationVerified = useMemo(
    () => verifyPlanConstraints(run.recommendation, run),
    [run],
  )
  const baselineVerified = useMemo(
    () => verifyPlanConstraints(run.baseline, run),
    [run],
  )
  // M19 · 域内合成证据快照（只读派生；批准边界仅当安全链对象存在）。
  const domainSnapshot = useMemo(() => {
    const planUnitIds = (plan: typeof run.baseline): string[] => {
      const ids = new Set<string>()
      for (const p of plan.periods) for (const id of p.runningUnitIds ?? []) ids.add(id)
      return [...ids]
    }
    return {
      units: run.allUnits.map((u) => {
        const e = run.evaluation.eligibility.find((x) => x.unitId === u.id)
        return { id: u.id, name: u.name, eligible: e?.eligible ?? false, reason: e?.reason ?? null }
      }),
      plans: [
        { id: 'baseline', label: '基线（规则）', passed: baselineVerified.passed, violationCount: baselineVerified.violationCount, unitIds: planUnitIds(run.baseline) },
        { id: 'recommendation', label: '建议（优化）', passed: recommendationVerified.passed, violationCount: recommendationVerified.violationCount, unitIds: planUnitIds(run.recommendation) },
      ],
      safety: { verdict: scheduleChain.safety.verdict, reasons: scheduleChain.safety.reasons },
      // 安全审查对应的是被推荐/待批方案（recommendation），非失败基线。
      reviewedPlanId: 'recommendation',
    }
  }, [run, baselineVerified, recommendationVerified, scheduleChain])

  const effectivePoint =
    run.series.points[clock.effectiveIndex] ?? run.series.points[0]
  const snapshot = useMemo(
    () =>
      buildOverviewSnapshot(
        run,
        stageSelection.plan,
        stageSelection.planType,
        effectivePoint.minuteOfDay,
      ),
    [run, stageSelection, effectivePoint.minuteOfDay],
  )

  const eligibleFlags = useMemo(() => {
    const observed = new Set(stageSelection.plan.periods.map((p) => p.index))
    return run.series.points.map((p) => observed.has(p.index))
  }, [run.series.points, stageSelection])

  const rangeSummary = useMemo(() => {
    if (!clock.range) return null
    return summarizeRange(clock.clock, clock.range, eligibleFlags)
  }, [clock.clock, clock.range, eligibleFlags])

  const outsideNote = outOfRangeNote(
    clock.clock,
    clock.range,
    clock.effectiveIndex,
  )

  const activeUnitId = hoverUnitId ?? linkedUnitId
  const activeHasBranch =
    snapshot.units.find((u) => u.unit.id === activeUnitId)?.hasBranch ?? false

  const toggleLock = (id: string) => {
    onLinkedUnitChange(linkedUnitId === id ? null : id)
  }
  const clearLock = () => onLinkedUnitChange(null)

  const clockRef = useRef(clock)
  clockRef.current = clock
  const linkedRef = useRef(linkedUnitId)
  linkedRef.current = linkedUnitId

  useEffect(() => {
    // 工作区范围 Esc：优先取消未提交刷选，其次解除对象锁定；
    // 输入框 / 文本编辑 / 对话框优先自己的 Esc。时间锁只由“跟随播放”显式解除。
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return
        }
        if (target.closest('[role="dialog"], dialog')) return
      }
      if (clockRef.current.state.brushStart !== null) {
        clockRef.current.cancelBrush()
        return
      }
      if (linkedRef.current) clearLock()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEvidenceFocus(focus)

  const focusPeriodIndex = focus?.target.startsWith('period:')
    ? Number(focus.target.slice('period:'.length))
    : null

  const modeControls = (
    <div className="source-bar-controls" role="group" aria-label="示例与方案比较">
      <label className="field">
        <span>数据来源</span>
        <select
          value={mode}
          onChange={(e) => onModeChange(e.target.value as 'legacy' | 'lab')}
        >
          <option value="legacy">合成示例</option>
          <option value="lab">方案比较（实验夹具）</option>
        </select>
      </label>
      {lab ? (
        <>
          <label className="field">
            <span>实验夹具</span>
            <select
              value={labFixture}
              onChange={(e) => onLabFixtureChange(e.target.value as LabFixtureId)}
            >
              {LAB_FIXTURES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>方案偏好</span>
            <select
              value={labPreference}
              onChange={(e) => onLabPreferenceChange(e.target.value as LabPreference)}
            >
              <option value="energy_first">能量优先</option>
              <option value="switch_first">切换优先</option>
            </select>
          </label>
        </>
      ) : null}
    </div>
  )

  const labCompareSection = labCompare ? (
    <section className="panel lab-compare">
            <h3>两种偏好</h3>
            <div className="lab-compare-grid">
              {[labCompare.comparison.energyFirst, labCompare.comparison.switchFirst].map(
                (view) => (
                  <article className="lab-card" key={view.preference}>
                    <h3>{view.preference === 'energy_first' ? '能量优先' : '切换优先'}</h3>
                    <div className="metric-row">
                      <span>模型能量</span>
                      <strong>{view.energyKwh === null ? '—' : `${view.energyKwh.toFixed(1)} kWh`}</strong>
                    </div>
                    <div className="metric-row">
                      <span>逐机翻转</span>
                      <strong>{view.switches === null ? '—' : view.switches}</strong>
                    </div>
                    <div className="metric-row">
                      <span>过量供气</span>
                      <strong>
                        {view.excessSupplyM3 === null ? '—' : `${view.excessSupplyM3.toFixed(1)} m³`}
                      </strong>
                    </div>
                    <p className="hint">
                      {view.verified ? '独立硬约束复验通过' : '复验未通过'}；
                      {view.metricsOk ? '独立指标核对通过' : '指标核对未通过'}。
                    </p>
                    {view.notes.length ? <p className="hint neg">{view.notes.join(' ')}</p> : null}
                  </article>
                ),
              )}
            </div>
            {labCompare.comparison.equivalent ? (
              <p className="hint">
                此输入下等价：两种偏好逐桶投运与负载相同。
              </p>
            ) : (
              <p className="hint">
                差额（能量优先 − 切换优先）：模型能量{' '}
                {labCompare.comparison.deltas.energyKwh === null
                  ? '—'
                  : `${labCompare.comparison.deltas.energyKwh > 0 ? '+' : ''}${labCompare.comparison.deltas.energyKwh.toFixed(1)} kWh`}
                ，逐机翻转{' '}
                {labCompare.comparison.deltas.switches === null
                  ? '—'
                  : `${labCompare.comparison.deltas.switches > 0 ? '+' : ''}${labCompare.comparison.deltas.switches}`}
                ，过量供气{' '}
                {labCompare.comparison.deltas.excessSupplyM3 === null
                  ? '—'
                  : `${labCompare.comparison.deltas.excessSupplyM3 > 0 ? '+' : ''}${labCompare.comparison.deltas.excessSupplyM3.toFixed(1)} m³`}
                。
              </p>
            )}
            <details className="lab-limits">
              <summary>限制与方法边界</summary>
              <ul className="plain-list">
                {LAB_DECLARATIONS.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </details>
    </section>
  ) : null

  return (
    <div className="workspace overview" data-page={subroute}>
      <SourceSafetyBar
        sourceId="synthetic_schedule"
        seed={run.series.seed}
        scenario={scenario}
        onScenarioChange={onScenarioChange}
        onRecompute={() => onRecompute?.(scenario)}
        safetyBlocked={!approvable}
        blockReasons={blockReasons}
        modelEnabled={narratorConfig.status === 'enabled'}
        modeControls={modeControls}
        showScenarioTabs={mode === 'legacy'}
      />

      {/* M22 r03 C1：overview 不再有重复满宽标题卡（并入主结论卡头）；其余子页保留轻量标题行。 */}
      {subroute !== 'overview' ? (
      <section className="page-head" aria-label="调度子页">
        <h2 tabIndex={-1}>
          {(SUB_LABEL.schedule as Record<string, string>)[subroute] ?? '调度'}
        </h2>
      </section>
      ) : null}

      {subroute === 'overview' ? (
        <div className="overview-grid">
          <div className="overview-main">
            <section className="panel console-decision-brief" aria-label="当前结论与下一动作">
              <div className="console-decision-brief__head">
                <div>
                  {/* M24 A1：页名权威=顶栏 H1；本卡只留主结论标题。 */}
                  <h3>当前结论与下一动作</h3>
                </div>
                {/* r44 A-09：复验状态只在来源/控制区显示一次；卡内仅保留阻断态与动作。 */}
                {approvable ? null : <span className="tag bad">安全阻断：不可批准</span>}
              </div>
              <dl className="console-decision-brief__facts">
                <div><dt>当前输入</dt><dd>{scenarioLabel}</dd></div>
                <div><dt>方案范围</dt><dd>{run.series.points.length} 个 15 分钟时段</dd></div>
                <div><dt>观察时刻</dt><dd>{snapshot.label}</dd></div>
              </dl>
              {!approvable ? (
                <div className="decision-block" role="status">
                  <strong>阻断原因：</strong>
                  <ul>{blockReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              ) : (
                <span className="decision-path-tip"><Tooltip text="先核对方案比较，再进入复验人审；总览不直接批准。">ⓘ 操作路径</Tooltip></span>
              )}
              <div className="decision-actions">
                <button type="button" id="overview-next-compare" data-action="next-compare"
                  className="btn primary" onClick={() => onNavigateSub('compare')}>
                  比较方案
                </button>
                <button type="button" id="overview-next-review" data-action="next-review"
                  className="btn" onClick={() => onNavigateSub('review')}>
                  进入复验人审
                </button>
                <button type="button" id="overview-next-evidence" data-action="next-evidence"
                  className="btn ghost" onClick={() => onNavigateSub('evidence')}>
                  查看关联证据 <span aria-hidden="true">↗</span>
                </button>
              </div>
            </section>
            <ObservationTransport
              sourceLabel="合成调度示例"
              api={clock}
              onFullWindow={() => clock.setRange(presetFull(clock.clock))}
              onLastHour={() => clock.setRange(presetLastHour(clock.clock))}
              rangeSummary={rangeSummary}
              outOfRange={outsideNote}
            />
            <DeviceStage
              snapshot={snapshot}
              runIdentity={runIdentity}
              linkedUnitId={linkedUnitId}
              hoverUnitId={hoverUnitId}
              onHover={setHoverUnitId}
              onToggleLock={toggleLock}
              onClearLock={clearLock}
            />
            <SupplyDemandTrend
              run={run}
              plan={stageSelection.plan}
              planLabel={
                stageSelection.planType === 'recommendation' ? '建议' : '基线对照'
              }
              activeUnitId={activeUnitId}
              activeHasBranch={activeHasBranch}
              api={clock}
            />
          </div>
          <ContextRail
            snapshot={snapshot}
            scenarioLabel={scenarioLabel}
            linkedUnitId={linkedUnitId}
            hoverUnitId={hoverUnitId}
            onToggleLock={toggleLock}
            onClearLock={clearLock}
          />
        </div>
      ) : null}

      {subroute === 'compare' ? (
        <div className="overview-main">
          {labCompareSection}
          <SummaryPanel
            baseline={run.baseline}
            recommendation={run.recommendation}
            context={run}
          />
          <details className="lab-compare">
            <summary>连续负荷 MILP 开发算例（懒加载求解器）</summary>
            <Suspense fallback={<p className="hint">加载求解器与 WASM…</p>}>
              <FlowMilpLab contextKey={runIdentity} />
            </Suspense>
          </details>
          <details className="lab-compare">
            <summary>完整一天方案组合（懒加载）</summary>
            <Suspense fallback={<p className="hint">加载组合比较…</p>}>
              <PortfolioCompare contextKey={runIdentity} onOpenExecution={() => onNavigateSub('execution')} />
            </Suspense>
          </details>
          <div className="decision-actions">
            <button
              type="button"
              id="compare-next-review"
              data-action="next-review"
              className="btn primary"
              onClick={() => onNavigateSub('review')}
            >
              下一步：复验人审
            </button>
            <button
              type="button"
              id="compare-next-evidence"
              data-action="next-evidence"
              className="btn"
              onClick={() => onNavigateSub('evidence')}
            >
              查看关联证据
            </button>
          </div>
        </div>
      ) : null}

      {subroute === 'review' ? (
        <div className="overview-main">
          <ReviewPathGuide onNavigateSub={onNavigateSub} onOpenRecords={onOpenRecords} />
          <SafetyReviewPanel safety={scheduleChain.safety} scenarioLabel={scenarioLabel} />
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
          <div className="decision-actions">
            <button
              type="button"
              id="review-next-evidence"
              data-action="next-evidence"
              className="btn"
              onClick={() => onNavigateSub('evidence')}
            >
              下一步：关联证据
            </button>
            <button
              type="button"
              id="review-back"
              data-action="back-source"
              className="btn ghost"
              onClick={onBack}
            >
              返回来源
            </button>
          </div>
        </div>
      ) : null}

      {subroute === 'execution' ? (
        <>
          <Suspense fallback={<p className="hint">加载合成执行链…</p>}>
            <ExecutionPanel />
          </Suspense>
          <Suspense fallback={<p className="hint">加载 suffix 重规划…</p>}>
            <ReplanPanel />
          </Suspense>
        </>
      ) : null}

      {subroute === 'evidence' ? (
        <div className="overview-main">
          <StateEvidenceHost />
          <RelationEvidence
            onOpenBatch={onOpenBatch}
            onOpenEvent={onOpenEvent}
            onOpenSource={onOpenSource}
            onOpenDevice={onOpenEvidenceUnit}
            filter={evidenceFilter}
            selected={evidenceSelected}
            depth={evidenceDepth}
            onDepthChange={onEvidenceDepthChange}
            onFilterChange={onEvidenceFilterChange}
            onSelect={onEvidenceSelect}
            domain={domainSnapshot}
          />
          <UnitRoster units={run.allUnits} eligibility={run.evaluation.eligibility} onOpenEvidence={onOpenEvidenceUnit} directoryState={directoryState} onDirectoryChange={onDirectoryChange} />
          <SupplyGapPanel gap={supplyGap} />
          <ConstraintPanel
            baseline={run.baseline}
            recommendation={run.recommendation}
            context={run}
          />
          <PeriodTable
            baseline={run.baseline}
            recommendation={run.recommendation}
            units={run.allUnits}
            focusPeriodIndex={focusPeriodIndex}
            focusNonce={focus?.nonce}
            onLockTime={clock.lockIndex}
            lockedIndex={clock.state.timeLock}
          />
          <EvaluationPanel />
          <KpiPanel onOpenDestination={onOpenKpiDestination} />
          <div className="decision-actions">
            <button
              type="button"
              id="evidence-back"
              data-action="back-source"
              className="btn ghost"
              onClick={onBack}
            >
              返回来源
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
