import type { ChainRole, DecisionChainResult } from '../domain/chain'

const STATUS_LABEL: Record<DecisionChainResult['overallStatus'], string> = {
  ready: '就绪',
  conditional: '有条件（存在待复核数据）',
  blocked: '阻断',
}

const STATUS_CLASS: Record<DecisionChainResult['overallStatus'], string> = {
  ready: 'ok',
  conditional: 'warn',
  blocked: 'bad',
}

interface Props {
  roles: ChainRole[]
  overallStatus: DecisionChainResult['overallStatus']
  title?: string
  statusLabel?: string
}

export default function DecisionChainView({
  roles,
  overallStatus,
  title = '决策链（结构化，非聊天框）',
  statusLabel,
}: Props) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <span className={`tag ${STATUS_CLASS[overallStatus]}`}>
          {statusLabel ?? STATUS_LABEL[overallStatus]}
        </span>
      </div>
      <div className="chain-grid">
        {roles.map((role, index) => (
          <article
            key={role.id}
            className="chain-card"
            data-evidence={`role:${role.id}`}
            tabIndex={-1}
          >
            <header>
              <span className="chain-step">{index + 1}</span>
              <h3>{role.name}</h3>
            </header>
            <div className="chain-section">
              <span className="chain-label">消费字段</span>
              <div className="chip-list">
                {role.consumes.map((c) => (
                  <span className="chip" key={c}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <div className="chain-section">
              <span className="chain-label">结论</span>
              <p>{role.conclusion}</p>
            </div>
            <div className="chain-section">
              <span className="chain-label">依据</span>
              <ul className="plain-list">
                {role.basis.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
            <div className="chain-section">
              <span className="chain-label">未知项</span>
              <ul className="plain-list unknown">
                {role.unknowns.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
            <div className="chain-section">
              <span className="chain-label">建议动作</span>
              <ul className="plain-list">
                {role.actions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}