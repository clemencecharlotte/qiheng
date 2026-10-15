/**
 * D08-W1 · R4 ReversibleNudge——轻推 wrapper（消费 useNudgeProgress）。
 * 只给可消费 wrapper：外层写唯一 transform 变量，宿主内容照常布局/交互；
 * 不碰主线已有 Flow/Process/锚点；reduce=本位同内容。
 */
import { type ReactNode } from 'react'
import { useNudgeProgress } from './useNudgeProgress'
import './ReversibleNudge.css'

export interface ReversibleNudgeProps {
  children: ReactNode
  /** 减少动效时直接本位（默认自动跟随系统；宿主可强制） */
  forceStatic?: boolean
  /** aria 标签（区块语义由宿主内容自带） */
  ariaLabel?: string
}

export default function ReversibleNudge({ children, forceStatic = false, ariaLabel }: ReversibleNudgeProps) {
  const { ref, pose } = useNudgeProgress<HTMLDivElement>()
  const staticPose = forceStatic
  // r02 双层结构：外层 wrapper 仅量测（无 transform，getBoundingClientRect 为未变换基准）；
  // 内层节点唯一持有 transform/opacity——同 scroll 恒同姿态，无自测反馈回路。
  return (
    <div ref={ref} className="u-w1-nudge" aria-label={ariaLabel}>
      <div
        className="u-w1-nudge__inner"
        style={
          staticPose
            ? undefined
            : {
                transform: `translate(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px) rotate(${pose.rot.toFixed(3)}deg) scale(${pose.scale.toFixed(4)})`,
                opacity: pose.opacity.toFixed(3),
              }
        }
      >
        {children}
      </div>
    </div>
  )
}
