import { useState } from 'react'
import { Popover } from './ui/Disclosure'

export type KpiTarget =
  | { type: 'device'; id: string; label: string; entryId?: string; originId?: string }
  | { type: 'route'; top: 'schedule' | 'history' | 'events' | 'records'; sub: string; label: string; entryId?: string; originId?: string }

const KPIS: Array<{ key: string; label: string; hint: string; basis: string; targets: KpiTarget[] }> = [
  {
    key: 'pressure',
    label: '压力合格率',
    hint: '缺少压力实测真值（未接入 PLC/SCADA），不作为生产指标。',
    basis: '未接入真实压力测点真值（无 PLC/SCADA 遥测）；合成演示不含现场压力序列，故不计算合格率。',
    targets: [
      { type: 'route', top: 'history', sub: 'trend', label: '供需趋势（合成，可复算）', entryId: 'kpi-entry-pressure-trend' },
      { type: 'route', top: 'schedule', sub: 'evidence', label: '硬约束复验证据', entryId: 'kpi-entry-pressure-constraint' },
    ],
  },
  {
    key: 'surge',
    label: '喘振预警率',
    hint: '离心机喘振边界未经核实，不计算预警率，避免编造安全曲线。',
    basis: 'AC-03 离心机喘振边界未核实（域内已把它排除出自动调度候选），无核实边界上限，故不编预警率。',
    targets: [{ type: 'device', id: 'AC-03', label: 'AC-03 资格与证据（关联证据）', entryId: 'kpi-entry-surge-ac03' }],
  },
  {
    key: 'energy',
    label: '节能率',
    hint: '缺少生产基准能耗真值，不能用合成示例冒充节能率。',
    basis: '无生产基准能耗真值；合成基准并非现场实测，不能据此给出节能率。',
    targets: [
      { type: 'route', top: 'schedule', sub: 'compare', label: '方案比较（基线 vs 建议，合成）', entryId: 'kpi-entry-energy-compare' },
      { type: 'route', top: 'records', sub: 'audit', label: '决策护照（已封存只读）', entryId: 'kpi-entry-energy-passport' },
    ],
  },
  {
    key: 'downtime',
    label: '停机下降率',
    hint: '缺少停机实测真值，未验证。',
    basis: '无停机现场事件/实测真值；启停间隔为规则约束而非现场停机统计，故不计算下降率。',
    targets: [{ type: 'route', top: 'schedule', sub: 'evidence', label: '硬约束（启停间隔）复验', entryId: 'kpi-entry-downtime-constraint' }],
  },
]

export default function KpiPanel({ onOpenDestination }: { onOpenDestination?: (t: KpiTarget) => void }) {
  const [openLabel, setOpenLabel] = useState<string | null>(null)
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>生产指标</h2>
      </div>
      <div className="kpi-grid">
        {KPIS.map((k) => (
          <div className="kpi-card unverified" key={k.label}>
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value">未验证</span>
            <Popover
              label="查看依据"
              ariaLabel={`${k.label} 缺失依据与已实现证据入口`}
              triggerId={`kpi-basis-${k.key}`}
              open={openLabel === k.label}
              onOpenChange={(o) => setOpenLabel(o ? k.label : null)}
            >
              <p className="kpi-basis">{k.basis}</p>
              <ul className="kpi-entries">
                {k.targets.map((t) => (
                  <li key={t.label}>
                    <button
                      type="button"
                      id={t.entryId}
                      className="kpi-entry-link"
                      onClick={() => { setOpenLabel(null); onOpenDestination?.({ ...t, originId: `kpi-basis-${k.key}` }) }}
                    >
                      {t.label}
                    </button>
                  </li>
                ))}
              </ul>
            </Popover>
          </div>
        ))}
      </div>
    </section>
  )
}
