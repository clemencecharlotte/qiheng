/**
 * D06 · OriginDialog 几何纯函数（FLIP 自触发器展开/收回）。
 * 纯函数便于无浏览器环境做真实算法断言；WAAPI 运行时行为属未测项。
 */

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface Pose {
  x: number
  y: number
  scale: number
  opacity: number
}

/** 面板最终位（fixed 居中）由视口与面板尺寸推导 */
export function centeredPanelRect(vw: number, vh: number, pw: number, ph: number): Rect {
  return {
    left: Math.max(0, (vw - pw) / 2),
    top: Math.max(0, (vh - ph) / 2),
    width: pw,
    height: ph,
  }
}

/** 从触发器矩形 → 面板最终位的 FLIP 位姿（x/y 平移 + scale 压缩，比例有下限） */
export function flipFromAnchor(anchor: Rect, panelFinal: Rect): Pose {
  const anchorCx = anchor.left + anchor.width / 2
  const anchorCy = anchor.top + anchor.height / 2
  const panelCx = panelFinal.left + panelFinal.width / 2
  const panelCy = panelFinal.top + panelFinal.height / 2
  const scale = Math.min(1, Math.max(0.4, anchor.width / Math.max(1, panelFinal.width)))
  return { x: anchorCx - panelCx, y: anchorCy - panelCy, scale, opacity: 0.4 }
}

/** 本位位姿 */
export function identityPose(): Pose {
  return { x: 0, y: 0, scale: 1, opacity: 1 }
}

/**
 * D06-r04 · opening 起点选择（组件实际调用的 from 决策，非纯参考）。
 * 合同：反转（closing→open）必须优先本次采样位姿（含 opacity），不回锚点；
 * 只完整 closed→open 才用本次来源 FLIP；来源无效 = 采样位姿兜底 → 就地淡出。
 */
export function chooseOpeningFrom(opts: {
  reversal: boolean
  sampled: Pose | null
  anchor: Rect | null
  originConnected: boolean
  panelFinal: Rect
}): Pose {
  if (opts.reversal) {
    return opts.sampled ?? vanishedPose()
  }
  return opts.anchor && isUsableRect(opts.anchor) && opts.originConnected
    ? flipFromAnchor(opts.anchor, opts.panelFinal)
    : opts.sampled ?? vanishedPose()
}

/**
 * D06-r04 · closing 终点选择（组件实际调用的 target 决策）。
 * 来源有效（startClose 已重测）→ 未变换布局 rect 的 FLIP 终点；
 * 来源无效/隐藏/移除 → **当前位置**仅 opacity 淡出（不 identity 跳变、不飞旧坐标）。
 */
export function chooseClosingTarget(opts: { anchor: Rect | null; pose: Pose; panelFinal: Rect }): Pose {
  return opts.anchor && isUsableRect(opts.anchor)
    ? flipFromAnchor(opts.anchor, opts.panelFinal)
    : { ...opts.pose, opacity: 0 }
}

/** 消失的触发器：无有效矩形 → 就地短淡出（无飞向左上角的角飞） */
export function vanishedPose(): Pose {
  return { x: 0, y: 0, scale: 0.97, opacity: 0 }
}

export function isUsableRect(r: Rect | null | undefined): boolean {
  return !!r && Number.isFinite(r.left) && Number.isFinite(r.top) && r.width > 0 && r.height > 0
}

/** 进度截断 [0,1] */
export function clampProgress(p: number): number {
  return Math.min(1, Math.max(0, p))
}

/** 两个位姿之间按进度插值（快速中途关闭/重开沿当前进度连续） */
export function lerpPose(from: Pose, to: Pose, p: number): Pose {
  const k = clampProgress(p)
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    scale: from.scale + (to.scale - from.scale) * k,
    opacity: from.opacity + (to.opacity - from.opacity) * k,
  }
}

/** 位姿 → WAAPI/transform 关键帧片段 */
export function poseToKeyframe(pose: Pose): Keyframe {
  return {
    transform: `translate(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px) scale(${pose.scale.toFixed(4)})`,
    opacity: pose.opacity.toFixed(3),
  }
}
