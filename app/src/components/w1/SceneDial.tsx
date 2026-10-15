/**
 * D08-W1 r03 · SceneDial——ChatGPT 风格环境滑动条（照抄其 slider 视觉语言，文字为六环境）。
 *
 * 视觉（参考 chatgpt 网页滑杆，样式直译）：
 * - 细胶囊轨道（6px）+ 大白色圆拇指（18px，柔和投影），拖动/按住时拇指放大到 24px；
 * - 轨道已填充段用当前环境 accent 色（随 visual 连续变色）；
 * - 刻度即六环境名（文字换我们的设计），均匀落在轨道下方对应位置，点击跳档，
 *   当前档高亮加粗；滑动中显示实时插值位置。
 * - 键盘/触控等价：原生 input range（44 触达），focus-visible 环；reduce 无动画。
 * - aria-valuetext 实时播报「环境名 + 位置」。
 */
import { SCENE_ENVS } from './scenePalette'
import './SceneDial.css'

export default function SceneDial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const pct = (Math.min(5, Math.max(0, value)) / 5) * 100
  const activeIndex = Math.round(value / 1)
  return (
    <div className="u-w1-dial">
      <div className="u-w1-dial__rail u-glow">
        <input
          type="range"
          className="u-w1-dial__input"
          min={0}
          max={5}
          step={0.01}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-valuetext={`环境 ${SCENE_ENVS[Math.min(5, Math.floor(value))] ?? ''}，位置 ${value.toFixed(2)}`}
          aria-label="环境时间轴（晨前到夜班，连续滑动）"
          style={{ ['--w1-dial-fill' as string]: `${pct}%` }}
        />
      </div>
      <div className="u-w1-dial__ticks" aria-hidden="false">
        {SCENE_ENVS.map((e, i) => (
          <button
            key={e.id}
            type="button"
            className={`u-w1-dial__tick u-glow${activeIndex === i ? ' u-w1-dial__tick--on' : ''}`}
            style={{ left: `${i * 20}%` }}
            onClick={() => onChange(i)}
            aria-pressed={activeIndex === i}
          >
            {e.name}
          </button>
        ))}
      </div>
    </div>
  )
}
