import './AppNav.css'

export type WorkspaceId = 'schedule' | 'device' | 'map' | 'agent' | 'data' | 'history' | 'events' | 'assistant'

interface WorkspaceMeta {
  id: WorkspaceId
  label: string
}

export const WORKSPACES: WorkspaceMeta[] = [
  {
    id: 'schedule',
    label: '调度',
  },
  {
    id: 'device',
    label: '设备',
  },
  {
    id: 'map',
    label: '关系MAP',
  },
  {
    id: 'agent',
    label: '智能体',
  },
  {
    id: 'data',
    label: '数据治理',
  },
  {
    id: 'events',
    label: '事件',
  },
  {
    id: 'history',
    label: '回放证据',
  },
  {
    id: 'assistant',
    label: '记录',
  },
]

function NavIcon({ id }: { id: WorkspaceId }) {
  if (id === 'schedule') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="8" y1="4" x2="8" y2="20" />
        <line x1="8" y1="9" x2="21" y2="9" />
        <line x1="12" y1="13" x2="18" y2="13" />
        <line x1="12" y1="16" x2="16" y2="16" />
      </svg>
    )
  }
  if (id === 'history') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <polyline points="7,15 11,10 14,13 19,6" />
        <circle cx="11" cy="10" r="1.3" />
        <circle cx="14" cy="13" r="1.3" />
      </svg>
    )
  }
  if (id === 'events') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="6" cy="6" r="2.2" />
        <circle cx="6" cy="18" r="2.2" />
        <circle cx="18" cy="12" r="2.2" />
        <path d="M8 6h4a3 3 0 0 1 3 3v0" />
        <path d="M8 18h4a3 3 0 0 0 3-3v0" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 18.5Z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  )
}

interface Props {
  value: WorkspaceId
  onChange: (id: WorkspaceId) => void
}

export default function AppNav({ value, onChange }: Props) {
  return (
    <nav className="app-nav console-nav" aria-label="工作区导航">
      {[
        { label: '决策与系统', ids: ['schedule', 'device', 'map', 'agent'] },
        { label: '数据与证据', ids: ['data', 'history', 'events', 'assistant'] },
      ].map((group) => (
        <div className="console-nav-group" key={group.label} role="group" aria-label={group.label}>
          <span className="console-nav-group-label" aria-hidden="true">{group.label}</span>
          {WORKSPACES.filter((w) => group.ids.includes(w.id)).map((w) => (
            <button
              type="button"
              key={w.id}
              data-tour-workspace={w.id}
              className={`nav-item${w.id === value ? ' active' : ''}`}
              aria-current={w.id === value ? 'page' : undefined}
              onClick={() => onChange(w.id)}
            >
              <span className="nav-icon"><NavIcon id={w.id} /></span>
              <span className="nav-label">{w.label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
