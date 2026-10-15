/**
 * D05 · 模态焦点围栏（纯函数合同，便于在无浏览器环境做真实算法断言）。
 * 合同（MDN ARIA dialog role，已读 developer.mozilla.org 2026-10-07）：
 *   - 焦点不在面板内：Tab 进首、Shift+Tab 进尾（含初始 panel 本体聚焦的场景）；
 *   - 在首按 Shift+Tab → 尾；在尾按 Tab → 首；中间不动；
 *   - 零可聚焦子项：焦点钉在面板本体（preventDefault，两个方向都不逃）；
 *   - 非 Tab 键不处理。
 */

export interface FocusableLike {
  focus(): void
}
export interface PanelLike {
  contains(node: unknown): boolean
}
export interface TabEventLike {
  key: string
  shiftKey: boolean
  preventDefault(): void
}

export function trapModalTab(
  e: TabEventLike,
  panel: PanelLike,
  active: unknown,
  focusables: FocusableLike[],
): void {
  if (e.key !== 'Tab') return
  if (focusables.length === 0) {
    e.preventDefault()
    return
  }
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const inPanel = panel.contains(active)
  if (!inPanel) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
    return
  }
  if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
    return
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
    return
  }
  if (active === panel) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
  }
}

export interface ScrimPressEventLike {
  target: unknown
  currentTarget: unknown
  preventDefault(): void
}

/**
 * 遮罩按压关闭合同（D05-r02 唯一回修）：
 * 仅当按在遮罩本体（target === currentTarget）时关闭，且必须先 preventDefault——
 * 抑制同一次 mousedown 的默认焦点转移（浏览器默认会把焦点移到 body，
 * 覆盖 closeModal 的 trigger 回焦）。面板内点击不受影响，文本选择照常。
 */
export function shouldCloseOnScrimPress(e: ScrimPressEventLike): boolean {
  if (e.target !== e.currentTarget) return false
  e.preventDefault()
  return true
}
