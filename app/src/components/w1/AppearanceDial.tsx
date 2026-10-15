/**
 * D08-W1 r05 · AppearanceDial——外观选择器（ChatGPT「滑杆卡片」直译重做）。
 *
 * r05 修正（协调指认 r04 未实际照抄）：
 * - 弹层=**滑杆卡片**：实底圆角卡（radius 20 + shadow），顶部行=左上小地球（随现实时间
 *   变化开关：线条→0.6s 渐变填充卡通地球；hover tooltip）+右上重置（环形箭头）；
 * - **分段滑杆**（ChatGPT segmented 语言）：胶囊容器内四段文字均分（跟随系统/日间/夜间/
 *   臻彩），**块状白色 thumb**（圆角块，非小圆点）滑到选中段，250ms 过渡；点击段/拖动/
 *   键盘（原生 range snap）等价；
 * - **仅臻彩显示二级滑杆卡**：环境时间轴（0 晨前 ↔ 5 夜班 连续），system/day/night 不出现
 *   任何滑杆（协调指定）；
 * - 实底无 blur；非模态（外点/Esc 关）；44 触达；reduce 无动画。
 */
import { useEffect, useRef, useState } from 'react'
import SceneDial from './SceneDial'
import { GlassSurface } from './GlassSurface'
import { APPEARANCE_MODES, type AppearanceMode } from './appearanceModel'
import './AppearanceDial.css'

export interface AppearanceDialProps {
  mode: AppearanceMode
  globeOn: boolean
  /** 臻彩档的手动环境值（二级滑杆绑定） */
  manualScene: number
  onModeChange: (m: AppearanceMode) => void
  onGlobeChange: (on: boolean) => void
  onManualSceneChange: (v: number) => void
  onReset: () => void
  /** 初始展开（测试/夹具用） */
  defaultOpen?: boolean
}

function GlobeOutlineIcon() {
  return (
    <svg className="u-w1-app__globe-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <ellipse cx="12" cy="12" rx="4.2" ry="9" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.4 9h17.2M3.4 15h17.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function GlobeFilledIcon() {
  return (
    <svg className="u-w1-app__globe-svg u-w1-app__globe-svg--on" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="u-w1-globe-sea" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5ec8f2" />
          <stop offset="100%" stopColor="#2a7fd4" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="9" fill="url(#u-w1-globe-sea)" />
      <path
        d="M7 8.4c1.2-.9 2.6-.2 3 .9.4 1-.4 1.7-1.5 2-1 .3-1.4 1-2.4.8-.9-.2-1.5-1-1-1.9.4-.8 1.2-1.3 1.9-1.8Zm6.8 1.2c1-.5 2.4-.2 2.9.8.4.9-.2 1.7-1.2 1.8-.9.1-1.8-.3-2.1-1.1-.3-.7-.2-1.2.4-1.5Zm-4.4 6.2c.8-.7 2-.8 2.9-.2.8.5.7 1.5-.2 2-.9.5-2.2.4-2.9-.3-.6-.6-.5-1 .2-1.5Zm5.6.3c.6-.4 1.5-.3 1.9.3.3.6-.1 1.2-.9 1.3-.7.1-1.4-.2-1.6-.8-.1-.4 0-.6.6-.8Z"
        fill="#4cb878"
        stroke="none"
      />
      <circle cx="12" cy="12" r="9" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg className="u-w1-app__reset-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.6 10a7.6 7.6 0 1 1-.5 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.2 5.6v4.6h4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function AppearanceDial({
  mode,
  globeOn,
  manualScene,
  onModeChange,
  onGlobeChange,
  onManualSceneChange,
  onReset,
  defaultOpen = false,
}: AppearanceDialProps) {
  const [open, setOpen] = useState(defaultOpen)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const selectedIndex = APPEARANCE_MODES.findIndex((m) => m.key === mode)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="u-w1-app">
      <button
        type="button"
        className="u-w1-app__trigger u-glow"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="u-w1-app__trigger-icon" aria-hidden="true">
          {mode === 'night' ? '☾' : '☀'}
        </span>
        <span className="u-w1-app__trigger-label">{APPEARANCE_MODES[selectedIndex]?.label ?? '外观'}</span>
      </button>

      {open ? (
        <GlassSurface className="u-w1-app__panel" ariaLabel="外观设置">
          <div className="u-w1-app__top">
            <button
              type="button"
              className={`u-w1-app__globe u-glow${globeOn ? ' u-w1-app__globe--on' : ''}`}
              aria-pressed={globeOn}
              aria-label={globeOn ? '随现实时间变化：已开启' : '随现实时间变化：未开启'}
              onClick={() => onGlobeChange(!globeOn)}
            >
              {globeOn ? <GlobeFilledIcon /> : <GlobeOutlineIcon />}
              <span className="u-w1-app__globe-tooltip" role="tooltip">
                随现实时间变化
              </span>
            </button>
            <span className="u-w1-app__panel-title">外观</span>
            <button type="button" className="u-w1-app__reset u-glow" aria-label="重置为跟随系统（默认）" onClick={onReset}>
              <ResetIcon />
            </button>
          </div>

          {/* 分段滑杆：胶囊容器内四段均分 + 块状白 thumb（ChatGPT segmented 语言） */}
          <div className="u-w1-app__segmented u-glow">
            <input
              type="range"
              className="u-w1-app__input"
              min={0}
              max={APPEARANCE_MODES.length - 1}
              step={1}
              value={selectedIndex}
              onChange={(e) => onModeChange(APPEARANCE_MODES[Number(e.target.value)].key)}
              aria-valuetext={APPEARANCE_MODES[selectedIndex]?.label}
              aria-label="外观模式（跟随系统/日间/夜间/臻彩）"
              style={{ ['--w1-app-seg' as string]: `${selectedIndex}` }}
            />
            <span className="u-w1-app__seg-thumb" aria-hidden="true" />
            <div className="u-w1-app__seg-labels">
              {APPEARANCE_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`u-w1-app__seg-label u-glow${selectedIndex === APPEARANCE_MODES.indexOf(m) ? ' u-w1-app__seg-label--on' : ''}`}
                  onClick={() => onModeChange(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 二级滑杆卡：仅臻彩显示环境时间轴（system/day/night 无滑杆） */}
          {mode === 'vivid' ? (
            <div className="u-w1-app__subcard u-glow">
              <p className="u-w1-app__subcard-title">环境时间轴（臻彩）</p>
              {globeOn ? (
                <p className="u-w1-app__subcard-note">小地球已开启：环境随现实时间自动变化，手动滑条暂不起作用。</p>
              ) : (
                <SceneDial value={manualScene} onChange={onManualSceneChange} />
              )}
            </div>
          ) : null}
        </GlassSurface>
      ) : null}
    </div>
  )
}
