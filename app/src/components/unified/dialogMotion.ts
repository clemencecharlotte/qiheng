/**
 * D06-r03 · 面板运动控制器（可注入桩元素做真实接线单测）。
 * 合同（修复 r02 实测缺口）：
 *   1. close/open 取消**前**先采样当前位姿（r01 实测 0.872→1 重置 = 先取消后采样）；
 *   2. 令牌失效旧 onfinish（重开/快速切换不卸新窗、旧 settle 不执行）；
 *   3. 动画完成即取消 fill（读取位姿不被过期填充叠加影响）；
 *   4. reduce/零时长：瞬切 settle（无远距动画）；
 *   5. 每次意图只一条有效动画（新意图取消旧动画并令其回调失效）。
 */

export interface MotionStyle {
  transform: string
  opacity: string
}

export interface MotionElement {
  getComputedStyle(): MotionStyle
  animate(keyframes: Keyframe[], options: { duration: number; easing: string; fill: 'both' }): Animation
}

export interface Pose {
  x: number
  y: number
  scale: number
  opacity: number
}

export function samplePose(style: MotionStyle): Pose {
  const m = style.transform
  let x = 0
  let y = 0
  let scale = 1
  if (m && m !== 'none') {
    const parts = m.match(/matrix\(([^)]+)\)/)?.[1]?.split(',').map(Number)
    if (parts && parts.length >= 6) {
      scale = Math.hypot(parts[0], parts[1]) || 1
      x = parts[4]
      y = parts[5]
    }
  }
  const op = Number(style.opacity)
  return { x, y, scale, opacity: Number.isFinite(op) ? op : 1 }
}

export class PanelMotion {
  private anim: Animation | null = null
  constructor(private el: MotionElement) {}

  /** 采样当前位姿（不受过期 fill 影响的读法：调用方保证先 cancel 或在无动画时读） */
  sample(): Pose {
    return samplePose(this.el.getComputedStyle())
  }

  /** 取消当前动画（若存在）；此后 sample() 读到真实 CSS 状态 */
  cancel(): void {
    if (this.anim) {
      this.anim.cancel()
      this.anim = null
    }
  }

  /** 取消前采样：合同固定顺序 = 先读后取消 */
  sampleThenCancel(): Pose {
    const pose = this.sample()
    this.cancel()
    return pose
  }

  hasActive(): boolean {
    return this.anim !== null
  }

  /** 播放位姿过渡；每次意图只一条有效动画（先取消旧动画，令牌使其回调失效）；
   *  令牌失效旧回调；完成即 cancel 清 fill */
  play(from: Pose, to: Pose, dur: number, reduce: boolean, settle: () => void): void {
    this.cancel() // 旧动画取消（其 onfinish 因令牌失效不会重复 settle）
    if (reduce || dur <= 0) {
      settle()
      return
    }
    const anim = this.el.animate([poseToKeyframe(from), poseToKeyframe(to)], {
      duration: dur,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
    })
    this.anim = anim
    anim.onfinish = () => {
      if (this.anim !== anim) return // 令牌失效旧回调
      this.cancel() // 清 fill：后续 sample 不被过期填充叠加
      settle()
    }
  }
}

export function poseToKeyframe(pose: Pose): Keyframe {
  return {
    transform: `translate(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px) scale(${pose.scale.toFixed(4)})`,
    opacity: pose.opacity.toFixed(3),
  }
}
