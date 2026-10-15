import { DATA_SOURCES, type SourceId } from '../domain/sources'

interface Props {
  sourceId: SourceId
  seed: number
  detail?: string
}

export default function SourceBadge({ sourceId, seed, detail }: Props) {
  const source = DATA_SOURCES[sourceId]
  return (
    <section className={`source-badge ${source.readOnly ? 'readonly' : ''}`}>
      <div className="source-head">
        <span className={`tag ${source.readOnly ? 'warn' : 'ok'}`}>
          数据来源：{source.label}
        </span>

        {source.readOnly ? <span className="tag bad">只读</span> : null}
      </div>
      <details className="source-details"><summary>来源与口径</summary><p className="hint">固定种子 {seed}</p>
      <p className="source-scope">
        {source.scope} · 机组：{source.units}
      </p>
      <p className="source-note">{source.unitsNote}</p>
      {detail ? <p className="source-note">{detail}</p> : null}
      <ul className="source-boundaries">
        {source.unverifiedBoundaries.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul></details>
    </section>
  )
}