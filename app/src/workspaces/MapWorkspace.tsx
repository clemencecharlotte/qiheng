import { useMemo, useState, type ReactNode } from 'react'
import RelationEvidence from '../components/evidence/RelationEvidence'
import { runScheduleChain } from '../domain/chain'
import { verifyPlanConstraints } from '../domain/constraints'
import type { ScenarioRun } from '../domain/engine'
import type { ScenarioId } from '../domain/types'
import type { DomainSnapshot } from '../integration/relations'
import { loadPassportStore } from '../domain/passport'
import type { RelationKind } from '../integration/relations'

/**
 * M29 · 关系MAP 一级工作区（真实宿主，非独立 lab）。
 * 复用 RelationEvidence 真实对象图：设备—示意母管/支路—数据批次/治理—候选/复验/护照证据；
 * 示意物理管网为「未核实」示意，不伪造现场关系。筛选/选中/邻域/返回上下文由宿主受控。
 */
interface Props {
  run: ScenarioRun
  scenario: ScenarioId
  scenarioLabel: string
  filter?: 'all' | RelationKind
  selected?: string | null
  depth?: 1 | 2
  onFilterChange?: (f: 'all' | RelationKind) => void
  onSelect?: (id: string | null) => void
  onDepthChange?: (d: 1 | 2) => void
  onOpenDevice?: (unitId: string) => void
  onOpenPassport?: (passportId: string, originId?: string) => void
  /** M29 r32 · 同源观察钟：同一 index 驱动设备节点当桶状态/负载与时刻。 */
  observationIndex?: number
  observationLabel?: string
  /** M29 r34 · 复用同一 ObservationClock 的播放/暂停/定位/循环入口（App 注入，不另建 timer/种子）。 */
  playbackSlot?: ReactNode
  /** M29 r27 · 受控视角（随唯一 entry 保持）。 */
  view?: MapView
  onViewChange?: (v: MapView) => void
  onOpenBatch?: (batchId: string) => void
  onOpenEvent?: (eventId: string) => void
  onOpenSource?: (sourceId: string) => void
}

type MapView = 'site' | 'data' | 'decision'
const VIEW_KINDS: Record<MapView, RelationKind[]> = {
  site: ['device', 'pipeline'],
  data: ['source', 'batch', 'event'],
  decision: ['candidate', 'verifier', 'passport', 'safety'],
}
const VIEW_HINT: Record<MapView, string> = {
  site: '示意管网 · 未核实',
  data: '',
  decision: '',
}

export default function MapWorkspace({ run, scenario, scenarioLabel, filter, selected, depth, onFilterChange, onSelect, onDepthChange, onOpenDevice, onOpenPassport, onOpenBatch, onOpenEvent, onOpenSource, view: viewProp, onViewChange, observationIndex = 0, observationLabel, playbackSlot }: Props) {
  const [viewLocal, setViewLocal] = useState<MapView>('site')
  const view = viewProp ?? viewLocal
  const setView = (v: MapView) => { setViewLocal(v); onViewChange?.(v) }
  const chain = useMemo(
    () => runScheduleChain({ scenario, scenarioLabel, run }),
    [scenario, scenarioLabel, run],
  )
  const recommendationVerified = useMemo(() => verifyPlanConstraints(run.recommendation, run), [run])
  const baselineVerified = useMemo(() => verifyPlanConstraints(run.baseline, run), [run])
  const domain = useMemo<DomainSnapshot>(() => {
    const planUnitIds = (plan: typeof run.baseline): string[] => {
      const ids = new Set<string>()
      for (const p of plan.periods) for (const id of p.runningUnitIds ?? []) ids.add(id)
      return [...ids]
    }
    return {
      units: run.allUnits.map((u) => {
        const e = run.evaluation.eligibility.find((x) => x.unitId === u.id)
        const period = run.recommendation.periods[observationIndex]
        const ratio = period?.unitLoadRatios?.[u.id]
        const load = typeof ratio === 'number' && Number.isFinite(ratio) ? ratio : null
        return { id: u.id, name: u.name, eligible: e?.eligible ?? false, reason: e?.reason ?? null, load, at: observationLabel ?? null }
      }),
      plans: [
        { id: 'baseline', label: '基线（规则）', passed: baselineVerified.passed, violationCount: baselineVerified.violationCount, unitIds: planUnitIds(run.baseline) },
        { id: 'recommendation', label: '建议（优化）', passed: recommendationVerified.passed, violationCount: recommendationVerified.violationCount, unitIds: planUnitIds(run.recommendation) },
      ],
      safety: { verdict: chain.safety.verdict, reasons: chain.safety.reasons },
      reviewedPlanId: 'recommendation',
      passports: loadPassportStore().passports.map((pp) => ({ passportId: pp.passportId, status: pp.status, inputSource: pp.inputSource, candidates: pp.attempts.map((a) => a.candidateId) })),
    }
  }, [run, chain, baselineVerified, recommendationVerified, observationIndex, observationLabel])

  return (
    <div className="workspace map-workspace" data-page="topology">
      <section className="page-head" aria-label="关系MAP">
        <h2 tabIndex={-1}>关系MAP</h2>
        <div className="map-views" role="group" aria-label="MAP 视角">
          {(['site', 'data', 'decision'] as MapView[]).map((v) => (
            <button key={v} type="button" className={`chip-btn${view === v ? ' active' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'site' ? '站内拓扑' : v === 'data' ? '数据关系' : '决策证据'}
            </button>
          ))}
        </div>
        {VIEW_HINT[view] ? <span className="hint">{VIEW_HINT[view]}</span> : null}
        {playbackSlot ? <div className="map-playback">{playbackSlot}</div> : null}
      </section>
      <RelationEvidence
        onOpenBatch={onOpenBatch}
        onOpenEvent={onOpenEvent}
        onOpenSource={onOpenSource}
        onOpenDevice={onOpenDevice}
        onOpenPassport={onOpenPassport}
        kinds={VIEW_KINDS[view]}
        filter={filter}
        selected={selected}
        depth={depth}
        onDepthChange={onDepthChange}
        onFilterChange={onFilterChange}
        onSelect={onSelect}
        domain={domain}
      />
    </div>
  )
}
