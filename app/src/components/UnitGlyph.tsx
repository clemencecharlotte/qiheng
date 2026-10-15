import type { Unit } from '../domain/types'

export type DeviceVisualState = 'running' | 'idle' | 'fault' | 'unknown'

interface Props {
  unit: Unit
  state: DeviceVisualState
  size?: number
}

function ScrewGlyph({ state }: { state: DeviceVisualState }) {
  return (
    <svg viewBox="0 0 128 84" role="presentation" focusable="false">
      <ellipse className="glyph-shadow" cx="64" cy="74" rx="52" ry="5" />
      <rect className="glyph-ground" x="8" y="69" width="112" height="6" rx="3" />
      <rect className="glyph-body-side" x="12" y="28" width="74" height="42" rx="9" />
      <rect className="glyph-body" x="12" y="24" width="74" height="42" rx="9" />
      <rect className="glyph-top" x="20" y="28" width="58" height="5" rx="2.5" />
      <rect className="glyph-panel" x="20" y="37" width="34" height="22" rx="4" />
      <g className="glyph-rotor">
        <path d="M24 46c4-6 8-6 12 0s8 6 12 0" />
        <path d="M24 53c4-6 8-6 12 0s8 6 12 0" />
      </g>
      <rect className="glyph-motor-side" x="86" y="34" width="28" height="30" rx="7" />
      <rect className="glyph-motor" x="86" y="30" width="28" height="30" rx="7" />
      <g className="glyph-motor-lines">
        <line x1="93" y1="37" x2="93" y2="53" />
        <line x1="100" y1="37" x2="100" y2="53" />
        <line x1="107" y1="37" x2="107" y2="53" />
      </g>
      <rect className="glyph-port" x="46" y="14" width="16" height="10" rx="3" />
      <rect className="glyph-port" x="86" y="60" width="24" height="8" rx="3" />
      {state === 'running' ? (
        <circle className="glyph-live" cx="100" cy="45" r="8" />
      ) : null}
      {state === 'fault' ? (
        <g className="glyph-fault">
          <line x1="92" y1="36" x2="108" y2="54" />
          <line x1="108" y1="36" x2="92" y2="54" />
        </g>
      ) : null}
    </svg>
  )
}

function CentrifugalGlyph({ state }: { state: DeviceVisualState }) {
  return (
    <svg viewBox="0 0 128 84" role="presentation" focusable="false">
      <ellipse className="glyph-shadow" cx="66" cy="76" rx="50" ry="5" />
      <rect className="glyph-ground" x="8" y="69" width="112" height="6" rx="3" />
      <rect className="glyph-motor-side" x="10" y="36" width="30" height="28" rx="7" />
      <rect className="glyph-motor" x="10" y="32" width="30" height="28" rx="7" />
      <g className="glyph-motor-lines">
        <line x1="18" y1="39" x2="18" y2="53" />
        <line x1="25" y1="39" x2="25" y2="53" />
        <line x1="32" y1="39" x2="32" y2="53" />
      </g>
      <circle className="glyph-body-side" cx="85" cy="48" r="30" />
      <circle className="glyph-body" cx="84" cy="46" r="30" />
      <circle className="glyph-panel" cx="84" cy="46" r="20" />
      <g className="glyph-impeller">
        <path d="M84 46 84 28" />
        <path d="M84 46 99 37" />
        <path d="M84 46 99 55" />
        <path d="M84 46 84 64" />
        <path d="M84 46 69 55" />
        <path d="M84 46 69 37" />
      </g>
      <circle className="glyph-hub" cx="84" cy="46" r="4" />
      <rect className="glyph-port" x="78" y="10" width="16" height="10" rx="3" />
      <rect className="glyph-port" x="112" y="42" width="12" height="10" rx="3" />
      {state === 'running' ? (
        <circle className="glyph-live" cx="84" cy="46" r="6" />
      ) : null}
      {state === 'fault' ? (
        <g className="glyph-fault">
          <line x1="72" y1="34" x2="96" y2="58" />
          <line x1="96" y1="34" x2="72" y2="58" />
        </g>
      ) : null}
    </svg>
  )
}

export default function UnitGlyph({ unit, state, size = 128 }: Props) {
  return (
    <div
      className={`unit-glyph state-${state}`}
      style={{ width: size }}
      aria-hidden="true"
    >
      {unit.kind === 'screw' ? (
        <ScrewGlyph state={state} />
      ) : (
        <CentrifugalGlyph state={state} />
      )}
    </div>
  )
}