import { useEffect, useMemo, useState } from 'react'
import type { PeriodPlan, PlanResult, Unit } from '../domain/types'

interface Props {
  baseline: PlanResult
  recommendation: PlanResult
  units: Unit[]
  focusPeriodIndex?: number | null
  focusNonce?: number
  /** 等价数据表：按行锁时（观察时钟）。 */
  onLockTime?: (index: number) => void
  lockedIndex?: number | null
}

function runningText(period: PeriodPlan | undefined): string {
  if (!period) return '无可行建议'
  if (period.runningUnitIds.length === 0) return '全停'
  return period.runningUnitIds
    .map((id) => `${id}@${(period.unitLoads[id] ?? 0).toFixed(1)}`)
    .join(' / ')
}

function marginText(period: PeriodPlan | undefined): string {
  if (!period) return '—'
  const sign = period.margin < 0 ? '' : '+'
  return `${sign}${period.margin.toFixed(1)}`
}

function violationText(period: PeriodPlan): string {
  if (period.violations.length === 0) return '通过'
  return period.violations.map((v) => v.type).join('、')
}

export default function PeriodTable({
  baseline,
  recommendation,
  units,
  focusPeriodIndex,
  focusNonce,
  onLockTime,
  lockedIndex,
}: Props) {
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    if (focusPeriodIndex === undefined || focusPeriodIndex === null) return
    setOnlyIssues(false)
    setSelected(focusPeriodIndex)
  }, [focusNonce, focusPeriodIndex])

  const recByIndex = useMemo(() => {
    const map = new Map<number, PeriodPlan>()
    for (const p of recommendation.periods) map.set(p.index, p)
    return map
  }, [recommendation])

  const unitsById = useMemo(
    () => new Map(units.map((u) => [u.id, u])),
    [units],
  )

  const rows = baseline.periods.filter((p) => {
    if (!onlyIssues) return true
    const rec = recByIndex.get(p.index)
    const recIssue = !rec || rec.violations.length > 0
    return p.violations.length > 0 || p.switches > 0 || recIssue
  })

  const selectedBaseline =
    selected === null ? null : baseline.periods.find((p) => p.index === selected)
  const selectedRec =
    selected === null ? undefined : recByIndex.get(selected)

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>时段级对比（96 × 15 分钟）</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={onlyIssues}
            onChange={(e) => setOnlyIssues(e.target.checked)}
          />
          仅显示违规 / 切换 / 无建议时段
        </label>
      </div>
      <div className="table-wrap">
        <table className="period-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>需求 m³/min</th>
              <th>基线投运（负载）</th>
              <th>基线余量</th>
              <th>建议投运（负载）</th>
              <th>建议余量</th>
              <th>基线约束</th>
              <th>建议约束</th>
              <th>锁时</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const rec = recByIndex.get(p.index)
              const hasIssue =
                p.violations.length > 0 ||
                !rec ||
                rec.violations.length > 0
              return (
                <tr
                  key={p.index}
                  className={`${hasIssue ? 'row-issue' : ''}${
                    selected === p.index ? ' row-selected' : ''
                  }${lockedIndex === p.index ? ' row-locked' : ''}`}
                  data-evidence={`period:${p.index}`}
                  tabIndex={-1}
                  onClick={() => setSelected(p.index)}
                >
                  <td className="mono">{p.label}</td>
                  <td className="mono">{p.demand.toFixed(1)}</td>
                  <td className="mono">{runningText(p)}</td>
                  <td className={`mono ${p.margin < 0 ? 'neg' : ''}`}>
                    {marginText(p)}
                  </td>
                  <td className="mono">{runningText(rec)}</td>
                  <td
                    className={`mono ${
                      rec && rec.margin < 0 ? 'neg' : ''
                    }`}
                  >
                    {marginText(rec)}
                  </td>
                  <td className={p.violations.length ? 'neg' : 'ok-text'}>
                    {violationText(p)}
                  </td>
                  <td className={rec && rec.violations.length ? 'neg' : 'ok-text'}>
                    {rec ? violationText(rec) : '无可行建议'}
                  </td>
                  <td>
                    {onLockTime ? (
                      <button
                        type="button"
                        className="chip-btn lock-time-btn"
                        aria-pressed={lockedIndex === p.index}
                        onClick={(e) => {
                          e.stopPropagation()
                          onLockTime(p.index)
                        }}
                      >
                        {lockedIndex === p.index ? '已锁' : '锁时'}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selectedBaseline ? (
        <div className="period-detail">
          <h3>
            {selectedBaseline.label} 决策依据
            {selectedRec ? '' : '（建议：无可行方案）'}
          </h3>
          <div className="detail-grid">
            <div>
              <h4>基线</h4>
              <p>{selectedBaseline.rationale}</p>
              {selectedBaseline.violations.length ? (
                <ul className="reason-list">
                  {selectedBaseline.violations.map((v, i) => (
                    <li key={i}>{v.message}</li>
                  ))}
                </ul>
              ) : (
                <p className="ok-text">无约束违规</p>
              )}
            </div>
            <div>
              <h4>建议</h4>
              {selectedRec ? (
                <>
                  <p>{selectedRec.rationale}</p>
                  {selectedRec.violations.length ? (
                    <ul className="reason-list">
                      {selectedRec.violations.map((v, i) => (
                        <li key={i}>{v.message}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ok-text">无约束违规</p>
                  )}
                  <p className="hint">
                    投运机组参数：
                    {selectedRec.runningUnitIds.length === 0
                      ? '无'
                      : selectedRec.runningUnitIds
                          .map((id) => {
                            const u = unitsById.get(id)
                            const ratio = selectedRec.unitLoadRatios[id] ?? 0
                            return `${id} ${u?.name ?? ''} 负载率 ${(
                              ratio * 100
                            ).toFixed(0)}%（下限 ${((u?.minLoadRatio ?? 0) * 100).toFixed(
                              0,
                            )}%）`
                          })
                          .join('；')}
                  </p>
                </>
              ) : (
                <ul className="reason-list">
                  {recommendation.infeasibleReasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="hint">点击任意时段行查看该时段的决策依据与约束明细。</p>
      )}
    </section>
  )
}