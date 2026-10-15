/**
 * D06-r02 · 对话框生命周期纯函数与锚点有效性合同。
 * 组件（OriginDialog）只做接线；此处为可单测的真实逻辑。
 */

export type DialogPhase = 'closed' | 'opening' | 'open' | 'closing'
export type DialogEvent = 'open' | 'close' | 'settle-open' | 'settle-closed'

/** 展示状态机（与业务执行分离；非法迁移返回 null） */
export function nextPhase(phase: DialogPhase, evt: DialogEvent): DialogPhase | null {
  switch (evt) {
    case 'open':
      return phase === 'closed' || phase === 'closing' ? 'opening' : null
    case 'close':
      return phase === 'open' || phase === 'opening' ? 'closing' : null
    case 'settle-open':
      return phase === 'opening' ? 'open' : null
    case 'settle-closed':
      return phase === 'closing' ? 'closed' : null
  }
}

export interface AnchorElLike {
  isConnected: boolean
  getBoundingClientRect(): { width: number; height: number }
}

/** 锚点可量测性：已连接 + 显示非 none + 有效矩形（宽高>0）。来源 display:none
 *  仍 isConnected 时必须判否——否则动画飞向旧坐标并回焦 BODY（D06-r01 实测）。 */
export function isMeasurableAnchor(el: AnchorElLike | null, computedDisplay?: string): boolean {
  if (!el || !el.isConnected) return false
  if (computedDisplay === 'none') return false
  const r = el.getBoundingClientRect()
  return Number.isFinite(r.width) && Number.isFinite(r.height) && r.width > 0 && r.height > 0
}

/** 背景锁一次性取得：首次保存原属性并置隔离；重入不覆盖（修复重开后
 *  root 仍 inert=true/aria-hidden=true 的泄漏）。 */
export interface BgState {
  inert: boolean
  aria: string | null
}
export function acquireBg(
  current: BgState | null,
  original: { inert: boolean; aria: string | null },
): BgState {
  return current ?? { ...original }
}
export function releaseBg(original: BgState): BgState {
  return { ...original }
}

/** 滚动锁一次性取得：保存 html 原 overflow/paddingRight；置 clip+7px 补偿；
 *  释放还原保存的原值（修复关闭后被清空）。 */
export interface ScrollLockState {
  overflow: string | null
  paddingRight: string | null
}
export function acquireScroll(
  current: ScrollLockState | null,
  original: ScrollLockState,
  _gap: number,
): ScrollLockState {
  return current ?? { ...original }
}
export function lockStyle(_state: ScrollLockState, gap: number): { overflow: string; paddingRight: string } {
  return { overflow: 'clip', paddingRight: `${Math.max(7, gap)}px` }
}

export function releaseScrollState(original: ScrollLockState): ScrollLockState {
  return { ...original }
}
