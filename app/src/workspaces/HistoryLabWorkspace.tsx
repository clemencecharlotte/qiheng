import type { AgentWindowProvenance } from '../integration/agentWindowProvenance'

import { Popover } from '../components/ui/Disclosure'
import { useMemo, useState } from 'react'
import SourceBadge from '../components/SourceBadge'
import { useEvidenceFocus, type EvidenceFocus } from '../components/useEvidenceFocus'
import HistoryTrend, { type TrendPoint } from '../components/HistoryTrend'
import ObservationTransport from '../components/ObservationTransport'
import type { ObservationClockApi } from '../components/useObservationClock'
import {
  energyEligibility,
  outOfRangeNote,
  presetFull,
  presetLastHour,
  summarizeRange,
} from '../domain/explore'
import {
  BUCKET_MINUTES,
  HISTORY_FIXTURES,
  HISTORY_MACHINES,
  HISTORY_START_MINUTE,
  buildHistoryFixture,
  type HistoryFixture,
} from '../domain/history'
import {
  REASON_CODE_META,
  STATION_ID,
  aggregateQuality,
  summarizeQuality,
  type QualityBucket,
  type QualityGrade,
} from '../domain/quality'
import { assessHealth } from '../domain/health'
import { FIXED_HISTORY_SEED } from '../domain/history'
import { INGEST_DESCRIPTOR } from '../domain/ingest'

const MACHINE_OPTIONS = [
  { id: 'ALL', label: `全部（${STATION_ID}）` },
  ...HISTORY_MACHINES.map((m) => ({ id: m.id, label: m.id })),
]

const GRADE_FILTERS: Array<{ id: 'all' | QualityGrade; label: string }> = [
  { id: 'all', label: '全部分级' },
  { id: 'pass', label: '通过' },
  { id: 'review', label: '待复核' },
  { id: 'invalid', label: '无效' },
]

function bucketKey(bucket: QualityBucket): string {
  return `${bucket.machineId}:${bucket.bucketIndex}`
}

function gradeClass(grade: QualityGrade): string {
  if (grade === 'pass') return 'tag ok'
  if (grade === 'review') return 'tag warn'
  return 'tag bad'
}

const GRADE_LABEL: Record<QualityGrade, string> = {
  pass: '通过',
  review: '待复核',
  invalid: '无效',
}

function markerFor(
  state: string,
  pressure: number | null,
  flow: number | null,
  power: number | null,
): string {
  const marks: string[] = []
  if (power === null) marks.push('功率缺值')
  if (pressure === null) marks.push('压力缺值')
  if (state === 'unknown') marks.push('未知状态')
  if (pressure === 0 && (flow ?? 0) > 0) marks.push('零压力有流量')
  return marks.length ? marks.join('、') : '-'
}

function MinuteEvidence({
  fixture,
  bucket,
}: {
  fixture: HistoryFixture
  bucket: QualityBucket
}) {
  const startMinute = HISTORY_START_MINUTE + bucket.bucketIndex * BUCKET_MINUTES
  const machineIds = bucket.machineId === STATION_ID
    ? HISTORY_MACHINES.map((m) => m.id)
    : [bucket.machineId]

  const rows: Array<{
    minute: number
    label: string
    machineId: string
    sample?: HistoryFixture['samples'][number]
  }> = []
  for (let m = 0; m < BUCKET_MINUTES; m += 1) {
    const minute = startMinute + m
    for (const machineId of machineIds) {
      rows.push({
        minute,
        label: `M+${m}`,
        machineId,
        sample: fixture.samples.find(
          (s) => s.minuteIndex === minute && s.machineId === machineId,
        ),
      })
    }
  }

  return (
    <div className="minute-evidence">
      <h4>
        分钟级证据：{bucket.machineId} {bucket.bucketLabel}
      </h4>
      <p className="hint">
        缺分钟不填零；无效分钟不计入有效样本与可信功率积分。
      </p>
      <div className="table-wrap short">
        <table className="period-table">
          <thead>
            <tr>
              <th>分钟</th>
              <th>机组</th>
              <th>状态</th>
              <th>流量 m³/min</th>
              <th>压力 MPa</th>
              <th>功率 kW</th>
              <th>站总流量</th>
              <th>标记</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.minute}-${row.machineId}`}>
                <td className="mono">{row.sample?.label ?? `${row.label} 缺`}</td>
                <td className="mono">{row.machineId}</td>
                <td>{row.sample?.state ?? '缺分钟'}</td>
                <td className="mono">
                  {row.sample?.flow === null || row.sample === undefined
                    ? '—'
                    : row.sample.flow}
                </td>
                <td className="mono">
                  {row.sample?.pressure === null || row.sample === undefined
                    ? '—'
                    : row.sample.pressure}
                </td>
                <td className="mono">
                  {row.sample?.power === null || row.sample === undefined
                    ? '—'
                    : row.sample.power}
                </td>
                <td className="mono">
                  {row.sample?.stationTotalFlow === null || row.sample === undefined
                    ? '—'
                    : row.sample.stationTotalFlow}
                </td>
                <td className="neg">
                  {row.sample
                    ? markerFor(
                        row.sample.state,
                        row.sample.pressure,
                        row.sample.flow,
                        row.sample.power,
                      )
                    : '缺分钟'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface Props {
  originWindow?: AgentWindowProvenance
  fixtureId: string
  onFixtureChange: (id: string) => void
  focus?: EvidenceFocus | null
  clock: ObservationClockApi
  /** M29 r30 · 来自 agent/map 时的返回本次来源入口。 */
  returnSourceLabel?: string
  onReturnToSource?: () => void
}

export default function HistoryLabWorkspace({
  fixtureId,
  onFixtureChange,
  focus,
  clock,
  returnSourceLabel,
  originWindow,
  onReturnToSource,
}: Props) {
  const [machineFilter, setMachineFilter] = useState('ALL')
  const [gradeFilter, setGradeFilter] = useState<'all' | QualityGrade>('all')
  const [selected, setSelected] = useState<string | null>(null)

  useEvidenceFocus(focus, (target) => {
    if (target.startsWith('bucket:')) {
      setMachineFilter('ALL')
      setGradeFilter('all')
      setSelected(target.slice('bucket:'.length))
    }
  })

  const fixture = useMemo(
    () => buildHistoryFixture(fixtureId, FIXED_HISTORY_SEED),
    [fixtureId],
  )
  const buckets = useMemo(() => aggregateQuality(fixture), [fixture])
  const summary = useMemo(() => summarizeQuality(buckets), [buckets])
  const health = useMemo(() => assessHealth(fixture), [fixture])

  const rows = buckets.filter((b) => {
    const machineMatch =
      machineFilter === 'ALL' ? b.machineId === STATION_ID : b.machineId === machineFilter
    const gradeMatch = gradeFilter === 'all' || b.grade === gradeFilter
    return machineMatch && gradeMatch
  })

  const trendBuckets = buckets.filter((b) =>
    machineFilter === 'ALL' ? b.machineId === STATION_ID : b.machineId === machineFilter,
  )
  const trendPoints: TrendPoint[] = trendBuckets.map((b) => ({
    label: b.bucketLabel,
    value: b.energyIntegralKwh,
    grade: b.grade,
    coverage: `${b.powerCoveredMinutes}/${b.expectedMinutes}`,
  }))

  const eligibleFlags = useMemo(
    () =>
      trendBuckets.map((b) =>
        energyEligibility({ value: b.energyIntegralKwh, grade: b.grade }),
      ),
    [trendBuckets],
  )
  const rangeSummary = useMemo(
    () =>
      clock.range
        ? summarizeRange(clock.clock, clock.range, eligibleFlags)
        : null,
    [clock.clock, clock.range, eligibleFlags],
  )
  const outsideNote = outOfRangeNote(clock.clock, clock.range, clock.effectiveIndex)

  const selectedBucket = buckets.find((b) => bucketKey(b) === selected) ?? null

  return (
    <div className="workspace">
      {onReturnToSource ? (<>
        {originWindow && <details className="history-origin-window"><summary>本次查询窗口与整桶范围</summary><p>原工具查询 {originWindow?.startMinute}–{originWindow?.endMinute} 分钟（含端点）；本页按既有 {clock.clock.stepMinutes} 分钟整桶展示{clock.range ? ` ${clock.clock.startMinute + clock.range[0] * clock.clock.stepMinutes}–${clock.clock.startMinute + (clock.range[1] + 1) * clock.clock.stepMinutes} 分钟（右端不含）` : ""}，不将扩展桶范围冒作原逐分钟积分。</p></details>}
        <div className="source-return"><button type="button" className="btn ghost" onClick={onReturnToSource}>← 返回本次{returnSourceLabel ?? '来源'}入口</button></div>
      </>) : null}
      <SourceBadge sourceId="synthetic_history" seed={FIXED_HISTORY_SEED} />


      <section className="panel">
        <div className="panel-head">
          <h2>合成历史夹具</h2>
        </div>
        <div className="toolbar">
          <label className="field">
            <span>夹具</span>
            <select
              value={fixtureId}
              onChange={(e) => {
                onFixtureChange(e.target.value)
                setSelected(null)
              }}
            >
              {HISTORY_FIXTURES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>机组</span>
            <select value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)}>
              {MACHINE_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>分级</span>
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value as 'all' | QualityGrade)}
            >
              {GRADE_FILTERS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <details className="scenario-desc">
          <summary>夹具描述</summary>
          <p>{HISTORY_FIXTURES.find((f) => f.id === fixtureId)?.description}</p>
        </details>
        <div className="quality-summary">
          <span className="tag ok">通过 {summary.pass}</span>
          <span className="tag warn">待复核 {summary.review}</span>
          <span className="tag bad">无效 {summary.invalid}</span>
          <span className="tag">
            可信完整桶能量 {summary.energyIntegralTrustedKwh.toFixed(3)} kWh
          </span>
          <span className="tag">
            观测部分积分 {summary.observedPartialEnergyKwh.toFixed(3)} kWh（功率覆盖{' '}
            {summary.observedCoveredMinutes}/{summary.observedExpectedMinutes} 分钟）
          </span>
        </div>
      </section>

      <ObservationTransport
        sourceLabel="合成回放夹具"
        api={clock}
        onFullWindow={() => clock.setRange(presetFull(clock.clock))}
        onLastHour={() => clock.setRange(presetLastHour(clock.clock))}
        rangeSummary={rangeSummary}
        outOfRange={outsideNote}
      />

      <section className="panel">
        <div className="panel-head">
          <h2>分时能耗</h2>
          <Popover label="单位与口径说明" ariaLabel="分时能耗单位/口径/覆盖/null 规则">
            <p>单位 kWh；口径 Σ(kW × 分钟) / 60。</p>
            <p>仅功率齐全（15 分钟）时为完整桶能量；功率不齐时为未知，null 不补零、不并入分子/分母。</p>
            <p>质量分级（review/invalid）仍排除在分子与分母之外；回放观察时钟只影响游标与刷选，不改变全日统计。</p>
          </Popover>
        </div>
        <HistoryTrend
          points={trendPoints}
          unit="kWh"
          objectLabel={machineFilter === 'ALL' ? STATION_ID : machineFilter}
          metricLabel="每桶完整功率积分"
          api={clock}
        />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>质量分级明细</h2>
          <span className="hint">点击任意行查看分钟级证据</span>
        </div>
        <div className="table-wrap">
          <table className="period-table">
            <thead>
              <tr>
                <th>桶</th>
                <th>机组</th>
                <th>分级</th>
                <th>原因码</th>
                <th>有效样本</th>
                <th>缺时间(min)</th>
                <th>功率缺值(min)</th>
                <th>完整桶能量 kWh</th>
                <th>观测部分 kWh</th>
                <th>功率覆盖</th>
                <th>可信</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr
                  key={bucketKey(b)}
                  className={
                    (b.grade !== 'pass' ? 'row-issue ' : '') +
                    (selected === bucketKey(b) ? 'row-selected ' : '') +
                    (clock.state.timeLock === b.bucketIndex ? 'row-locked' : '')
                  }
                  data-evidence={`bucket:${b.machineId}:${b.bucketIndex}`}
                  tabIndex={-1}
                  onClick={() => {
                    setSelected(bucketKey(b))
                    clock.lockIndex(b.bucketIndex)
                  }}
                >
                  <td className="mono">{b.bucketLabel}</td>
                  <td className="mono">{b.machineId}</td>
                  <td>
                    <span className={gradeClass(b.grade)}>{GRADE_LABEL[b.grade]}</span>
                  </td>
                  <td>
                    {b.reasonCodes
                      .map((c) => `${c}（${REASON_CODE_META[c].label}）`)
                      .join('；')}
                  </td>
                  <td className="mono">
                    {b.validSampleCount}/{b.expectedMinutes}
                  </td>
                  <td className="mono">{b.missingTimestamps}</td>
                  <td className="mono">{b.missingPowerMinutes}</td>
                  <td className={b.energyIntegralKwh === null ? 'neg mono' : 'mono'}>
                    {b.energyIntegralKwh === null
                      ? '未知'
                      : b.energyIntegralKwh.toFixed(3)}
                  </td>
                  <td className="mono">{b.observedPartialEnergyKwh.toFixed(3)}</td>
                  <td className="mono">
                    {b.powerCoveredMinutes}/{b.expectedMinutes}
                  </td>
                  <td className={b.energyTrusted ? 'ok-text' : 'neg'}>
                    {b.energyTrusted ? '可用' : '不可用'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedBucket ? (
          <MinuteEvidence fixture={fixture} bucket={selectedBucket} />
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>未来数据接入接口（本轮未启用）</h2>
          <span className="tag bad">disabled · {INGEST_DESCRIPTOR.version}</span>
        </div>
        <details className="ingest-contract">
          <summary>契约字段与权限（本轮未启用）</summary>
          <p className="hint"><Popover label="ⓘ" ariaLabel="未来数据接入契约（本轮未启用）"><p>{INGEST_DESCRIPTOR.notInScopeThisRound}</p></Popover></p>
          <div className="detail-grid">
          <div>
            <h4>格式与必需列（单位已标明，缺值留空禁止填零）</h4>
            <ul className="plain-list">
              {INGEST_DESCRIPTOR.requiredColumns.map((c) => (
                <li key={c.name}>
                  <span className="mono">{c.name}</span>（{c.unit}）：{c.note}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4>权限说明</h4>
            <ul className="plain-list">
              <li>角色：{INGEST_DESCRIPTOR.permissions.roles.join('、')}</li>
              <li>范围：{INGEST_DESCRIPTOR.permissions.scopes.join('、')}</li>
              {INGEST_DESCRIPTOR.permissions.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p className="hint">
              支持格式：{INGEST_DESCRIPTOR.formats.join('、')}（仅契约说明）
            </p>
          </div>
          </div>
        </details>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>规则异常提示（设备健康员输入）</h2>
        </div>
        {health.length === 0 ? (
          <p className="hint">未触发演示阈值内的规则异常提示。</p>
        ) : (
          <ul className="finding-list">
            {health.map((f) => (
              <li key={f.id} data-evidence={`health:${f.id}`} tabIndex={-1}>
                <span className={`tag ${f.severity === 'watch' ? 'warn' : 'ok'}`}>
                  {f.ruleLabel}
                </span>
                <span>
                  {f.machineId} {f.basisLabels[0]} 起 {f.basisMinutes.length} 分钟
                </span>
                <span className="hint">
                  阈值 {f.threshold}，窗口 {f.window}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
