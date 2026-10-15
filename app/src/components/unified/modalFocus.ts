/**
 * D06 · 模态焦点/遮罩合同（自 r02 已验收的 console/modalFocus 收编为
 * unified 自包含副本，便于 M10 只迁 components/unified；逻辑逐行同源）。
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

/** Tab/Shift+Tab 围栏：panel 未聚焦→入栏；panel 本体聚焦→Tab 进首/Shift+Tab 进尾；
 *  在首按 Shift+Tab→尾；在尾按 Tab→首；中间不拦；零可聚焦子项双向钉面板。 */
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

/** 遮罩按压：仅按在遮罩本体时关闭，且先 preventDefault 抑制默认焦点转移到 body
 *  （否则覆盖 closeModal 的触发器回焦）；面板内点击不受影响。 */
export function shouldCloseOnScrimPress(e: ScrimPressEventLike): boolean {
  if (e.target !== e.currentTarget) return false
  e.preventDefault()
  return true
}
