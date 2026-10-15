import { SCENARIOS } from '../domain/demand'
import type { ScenarioId } from '../domain/types'

interface Props {
  value: ScenarioId
  onChange: (id: ScenarioId) => void
  onRecompute: () => void
}

export default function ScenarioSwitcher({ value, onChange, onRecompute }: Props) {
  const current = SCENARIOS.find((s) => s.id === value)
  return (
    <section className="panel scenario-panel">
      <div className="panel-head">
        <h2>合成场景</h2>
        <button type="button" className="btn ghost" onClick={onRecompute}>
          重新计算
        </button>
      </div>
      <div className="scenario-tabs">
        {SCENARIOS.map((s) => (
          <button
            type="button"
            key={s.id}
            className={`scenario-tab${s.id === value ? ' active' : ''}`}
            onClick={() => onChange(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {current ? <p className="scenario-desc">{current.description}</p> : null}
    </section>
  )
}