/**
 * M13 r01 · 外观 popover 关闭回焦决策（纯函数，可测）。
 * 合同：每次关闭回到**本次触发入口**；入口卸载/失效时落可用替代节点；绝不落背景根（BODY）。
 */
export interface FocusCandidate {
  isConnected: boolean
  /** 可聚焦：有 layout（offsetParent/rects）且非 disabled */
  focusable: boolean
}

export type ReturnFocusKind = 'trigger' | 'fallback' | 'host'

export function chooseReturnFocus(
  trigger: FocusCandidate | null,
  fallback: FocusCandidate | null,
): ReturnFocusKind {
  if (trigger && trigger.isConnected && trigger.focusable) return 'trigger'
  if (fallback && fallback.isConnected && fallback.focusable) return 'fallback'
  return 'host'
}
