import { THEME_OPTIONS, type ThemePreference } from '../theme'

interface Props {
  value: ThemePreference
  onChange: (value: ThemePreference) => void
  compact?: boolean
}

function ThemeIcon({ id }: { id: ThemePreference }) {
  if (id === 'light') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="4.2" />
        <g strokeLinecap="round">
          <line x1="12" y1="2.5" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="21.5" />
          <line x1="2.5" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="21.5" y2="12" />
          <line x1="5.2" y1="5.2" x2="7" y2="7" />
          <line x1="17" y1="17" x2="18.8" y2="18.8" />
          <line x1="5.2" y1="18.8" x2="7" y2="17" />
          <line x1="17" y1="7" x2="18.8" y2="5.2" />
        </g>
      </svg>
    )
  }
  if (id === 'dark') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.4 6.4 0 0 0 10.5 10.5Z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <line x1="8" y1="20" x2="16" y2="20" />
      <line x1="12" y1="16" x2="12" y2="20" />
    </svg>
  )
}

export default function ThemeSwitcher({ value, onChange, compact }: Props) {
  return (
    <div
      className={`theme-switch${compact ? ' compact' : ''}`}
      role="group"
      aria-label="主题"
    >
      {THEME_OPTIONS.map((opt) => (
        <button
          type="button"
          key={opt.id}
          className={`theme-option${value === opt.id ? ' active' : ''}`}
          aria-pressed={value === opt.id}
          title={`主题：${opt.label}`}
          onClick={() => onChange(opt.id)}
        >
          <ThemeIcon id={opt.id} />
          <span className="theme-option-label">{opt.label}</span>
        </button>
      ))}
    </div>
  )
}