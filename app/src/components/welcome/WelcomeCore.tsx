/**
 * 气衡 Core —— 品牌对象（纯展示）。
 * 三层各管一件事：静态外框 / 鼠标追随层 / 匀速自转层（CSS 动画）。
 *
 * 2026-10-06：换回原版 `field-engine.js` 后，鼠标追随层接回原引擎的 Core 联动 ——
 * 引擎按 `#core-tilt` 查找元素并写 CSS 变量 `--tilt`（±6°，见引擎 §5.2），
 * 所以这里始终挂上 `id="core-tilt"`，由 welcome.css 消费 `--tilt` 做旋转。
 * reduced-motion 时停止自转（见 welcome.css）。
 */
export default function WelcomeCore({ tilt = false }: { tilt?: boolean }) {
  return (
    <div className="qh-core" id="qiheng-core" aria-hidden="true">
      <svg viewBox="0 0 120 120" fill="none" stroke="currentColor">
        <circle cx="60" cy="60" r="55" strokeWidth="0.7" opacity=".26" />
        <g className={tilt ? 'qh-core-tilt' : undefined} id="core-tilt">
          <g className="qh-core-orbit">
            <circle cx="60" cy="60" r="42" strokeWidth="0.9" opacity=".4" strokeDasharray="2 7" />
            <path d="M60 6 A54 54 0 0 1 107 33" strokeWidth="1.5" opacity=".8" strokeLinecap="round" />
            <path d="M60 114 A54 54 0 0 1 13 87" strokeWidth="1.5" opacity=".8" strokeLinecap="round" />
            <path d="M26 60 A34 34 0 0 1 60 26" strokeWidth="1.2" opacity=".58" strokeLinecap="round" />
            <path d="M94 60 A34 34 0 0 1 60 94" strokeWidth="1.2" opacity=".58" strokeLinecap="round" />
          </g>
        </g>
        <path d="M40 48c7.5 0 9-6 15-10M47 60h18M40 72c7.5 0 9 6 15 10" strokeWidth="1.6" opacity=".92" strokeLinecap="round" />
        <circle cx="60" cy="60" r="4" fill="currentColor" stroke="none" opacity=".9" />
      </svg>
    </div>
  )
}
