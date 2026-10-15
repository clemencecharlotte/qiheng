import type { SupplyGap } from '../domain/capacity'

interface Props {
  gap: SupplyGap
}

export default function SupplyGapPanel({ gap }: Props) {
  return (
    <section className="panel supply-gap-panel">
      <div className="panel-head">
        <h2>供气缺口说明（容量下界）</h2>
        <span
          className={`tag ${
            gap.capacityInsufficient ? 'bad' : gap.planFeasible ? 'ok' : 'warn'
          }`}
        >
          {gap.title}
        </span>
      </div>
      <p>{gap.statement}</p>
      <p className="hint">{gap.note}</p>
      <details className="supply-gap-details">
        <summary>
          展开逐桶容量缺口表（{gap.gapBucketCount} 个缺口时段，共 {gap.buckets.length} 桶）
        </summary>
        <p className="hint">
          安全可用候选：{gap.candidates.join('、') || '无'}；合计额定{' '}
          {gap.availableCapacity.toFixed(1)} m³/min。
          {gap.excluded.length > 0
            ? ` 排除：${gap.excluded
                .map((e) => `${e.unitId}（${e.reason}）`)
                .join('；')}`
            : ''}
        </p>
        <table className="data-table">
          <thead>
            <tr>
              <th>时段</th>
              <th>需求 (m³/min)</th>
              <th>容量上限 (m³/min)</th>
              <th>缺口 (m³/min)</th>
            </tr>
          </thead>
          <tbody>
            {gap.buckets.map((b) => (
              <tr key={b.index} className={b.gap > 0 ? '' : 'muted'}>
                <td className="mono">{b.label}</td>
                <td>{b.demand.toFixed(1)}</td>
                <td>{b.availableCapacity.toFixed(1)}</td>
                <td>{b.gap > 0 ? b.gap.toFixed(1) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}
