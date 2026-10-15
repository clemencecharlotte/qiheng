/**
 * M14 r01 · 受约束锚定定位（内容感知）。
 * 以触发 rect、**真实内容高（scrollHeight）**、视口计算：优先在触发上方/下方中空间足够的一侧，
 * 返回可用最大高（内部 overflow-y:auto）；水平夹取；绝不为空壳高度定位、绝不滚出窗。
 */
export interface PlacementTrigger { left: number; top: number; bottom: number }
export interface PlacementViewport { width: number; height: number }
export interface PlacementResult { left: number; top: number; width: number; maxHeight: number; placedAbove: boolean; needsScroll: boolean }

export function computeAnchoredPlacement(
  trigger: PlacementTrigger,
  contentHeight: number,
  viewport: PlacementViewport,
  popWidth = 300,
  margin = 8,
  gap = 8,
): PlacementResult {
  const vw = Math.max(0, viewport.width)
  const vh = Math.max(0, viewport.height)
  const pw = Math.min(popWidth, Math.max(0, vw - margin * 2))
  const left = Math.min(Math.max(margin, trigger.left), Math.max(margin, vw - pw - margin))
  const aboveSpace = Math.max(0, trigger.top - gap - margin)
  const belowSpace = Math.max(0, vh - trigger.bottom - gap - margin)
  const h = Math.max(0, contentHeight)
  // 优先选择能放下内容的一侧；否则选空间更大的一侧。
  let placedAbove: boolean
  if (h <= aboveSpace) placedAbove = true
  else if (h <= belowSpace) placedAbove = false
  else placedAbove = aboveSpace >= belowSpace
  const sideSpace = placedAbove ? aboveSpace : belowSpace
  const needsScroll = h > sideSpace
  const maxHeight = Math.max(80, Math.min(h <= 0 ? sideSpace : h, sideSpace))
  const top = placedAbove ? Math.max(margin, trigger.top - gap - maxHeight) : Math.min(vh - margin - maxHeight, trigger.bottom + gap)
  return { left, top: Math.max(margin, top), width: pw, maxHeight, placedAbove, needsScroll }
}
