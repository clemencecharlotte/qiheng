import { useMemo, useState } from 'react'
import { minCapacity } from '../domain/units'
import type { Unit, UnitEligibility } from '../domain/types'

export interface UnitDirectoryState { query: string; filter: 'all' | 'eligible' | 'excluded' }

interface Props {
  directoryState?: UnitDirectoryState
  onDirectoryChange?: (state: UnitDirectoryState) => void
  units: Unit[]
  eligibility: UnitEligibility[]
  /** 打开该机组的真实证据/详情（复用宿主既有 unit:<id> 证据定位）。 */
  onOpenEvidence?: (unitId: string) => void
}

const KIND_LABEL: Record<Unit['kind'], string> = {
  screw: '螺杆机',
  centrifugal: '离心机',
}

type Filter = 'all' | 'eligible' | 'excluded'

const FILTER_LABEL: Record<Filter, string> = { all: '全部', eligible: '纳入候选', excluded: '已排除' }

export default function UnitRoster({ units, eligibility, onOpenEvidence, directoryState, onDirectoryChange }: Props) {
  const [localQ, setLocalQ] = useState('')
  const [localFilter, setLocalFilter] = useState<Filter>('all')
  const q = directoryState?.query ?? localQ
  const filter = directoryState?.filter ?? localFilter
  const setQ = (query: string) => { if (onDirectoryChange) onDirectoryChange({query, filter}); else setLocalQ(query) }
  const setFilter = (filter: Filter) => { if (onDirectoryChange) onDirectoryChange({query:q, filter}); else setLocalFilter(filter) }

  const rows = useMemo(() => units.map((u) => {
    const e = eligibility.find((x) => x.unitId === u.id)
    return { u, e, eligible: e?.eligible ?? false }
  }), [units, eligibility])

  const counts = useMemo(() => ({
    all: rows.length,
    eligible: rows.filter((r) => r.eligible).length,
    excluded: rows.filter((r) => !r.eligible).length,
  }), [rows])

  const visible = rows.filter(({ u, eligible }) => {
    if (filter === 'eligible' && !eligible) return false
    if (filter === 'excluded' && eligible) return false
    const kw = q.trim().toLowerCase()
    if (!kw) return true
    return u.id.toLowerCase().includes(kw) || u.name.toLowerCase().includes(kw) || KIND_LABEL[u.kind].includes(kw)
  })

  return (
    <section className="panel" aria-label="设备目录">
      <div className="panel-head">
        <h2>设备目录（{rows.length} 台）</h2>
      </div>

      <div className="unit-dir-toolbar" role="group" aria-label="目录筛选与搜索">
        <div className="unit-dir-filters">
          {(['all', 'eligible', 'excluded'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`chip-btn${filter === f ? ' active' : ''}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABEL[f]} {counts[f]}
            </button>
          ))}
        </div>
        <label className="unit-dir-search">
          <span className="sr-only">搜索设备（ID / 名称 / 类型）</span>
          <input
            type="search"
            value={q}
            placeholder="搜索 ID / 名称 / 类型"
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        {(q || filter !== 'all') ? (
          <button type="button" className="chip-btn" onClick={() => { setQ(''); setFilter('all') }}>清除筛选</button>
        ) : null}
        <span className="unit-dir-count" data-testid="unit-dir-count" aria-live="polite">结果 {visible.length} / {rows.length}</span>
      </div>

      {visible.length === 0 ? (
        <p className="hint" data-testid="unit-dir-empty">无匹配设备：请调整关键词或清除筛选。</p>
      ) : (
        <div className="unit-grid">
          {visible.map(({ u, e, eligible }) => (
            <article
              key={u.id}
              className={`unit-card${eligible ? '' : ' excluded'}`}
              data-evidence={`unit:${u.id}`}
              tabIndex={-1}
            >
              <header>
                <div>
                  <strong>{u.name}</strong>
                  <span className="unit-id">{u.id}</span>
                </div>
                <span className={`tag ${eligible ? 'ok' : 'warn'}`}>
                  {eligible ? '纳入候选' : '已排除'}
                </span>
              </header>
              <dl className="unit-facts">
                <div><dt>类型</dt><dd>{KIND_LABEL[u.kind]}</dd></div>
                <div><dt>供气能力</dt><dd>{u.ratedCapacity} m³/min</dd></div>
                <div><dt>喘振边界</dt><dd>{u.surgeBoundaryVerified ? '已核实' : '未核实'}</dd></div>
              </dl>
              <details className="unit-facts-more">
                <summary>技术参数</summary>
                <dl className="unit-facts">
                  <div><dt>最小稳定负载</dt><dd>{(u.minLoadRatio * 100).toFixed(0)}% / {minCapacity(u).toFixed(1)} m³/min</dd></div>
                  <div><dt>额定功率</dt><dd>{u.ratedPower} kW</dd></div>
                  <div><dt>最小启停间隔</dt><dd>{u.minStartStopInterval} min</dd></div>
                </dl>
              </details>
              {e && !eligible ? <p className="exclusion-reason">{e.reason}</p> : null}
              {onOpenEvidence ? (
                <button
                  type="button"
                  id={`unit-open-${u.id}`}
                  className="btn ghost unit-dir-open"
                  onClick={() => onOpenEvidence(u.id)}
                  aria-label={`查看 ${u.id} 的证据与详情`}
                >
                  查看证据与详情 →
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
