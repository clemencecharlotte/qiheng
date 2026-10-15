/**
 * A-10 · MAP 视图 fit 布局 helper（MAP 专用；不改只读 integration/relations 布局）。
 *
 * 背景：`layoutRelations` 的画布尺寸 = 内容 bbox（列 pitch 220px）。MAP「站内拓扑」只有
 * device/pipeline 两列 → 画布 396px，而外层 `.qrel-graphwrap` 通常 ~1200px，于是节点全堆在
 * 左侧、右侧大片空白。此处把**只读布局的列/行序**归一到实测画布宽度：
 *   - 列序 = 基础布局里唯一 x 的升序（即类型顺序，KIND_ORDER 未导出，故由坐标反推，不复制口径）；
 *   - 行序 = 唯一 y 的升序（即同类型内真实顺序）；
 *   - 列间距按可用宽度重算 → 首列贴左边距、末列右沿贴右边距，节点分布吃满画布宽度。
 *
 * 合同（必须保持）：
 *   - 确定性：同输入恒定输出，无随机、无物理迭代、无时间依赖；
 *   - 不丢节点：positions 的 key 集合与输入完全一致（否则边端点取不到坐标 → 白屏，P0 回归）；
 *   - 不压叠：放不下时保持 `colGapMin` 下限并让画布宽超出视口（沿用既有横向滚动），绝不重叠节点；
 *   - 未测量（viewportWidth 非正/非有限）时原样返回基础布局 → SSR/jsdom 安全，不改既有宿主表现。
 */
import {
  GRAPH_COL_GAP,
  GRAPH_NODE_H,
  GRAPH_NODE_W,
  GRAPH_ROW_GAP,
  type GraphLayout,
} from '../../integration/relations'

/** 画布四周留白（px）。与外层次级卡内边距同量级，避免节点贴边。 */
export const MAP_FIT_MARGIN = 16

export interface MapFitOptions {
  /** 可用画布宽（px，容器实测）。<=0 或非有限值 = 未测量 → 不做 fit，原样返回。 */
  viewportWidth?: number | null
  /** 画布四周留白（px），默认 MAP_FIT_MARGIN。 */
  margin?: number
  /** 列间最小间距（px），默认 GRAPH_COL_GAP；内容放不下时以此下限保持横向滚动。 */
  colGapMin?: number
  /** 行间最小间距（px），默认 GRAPH_ROW_GAP。 */
  rowGapMin?: number
}

export interface LayoutBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** 节点实际占据的宽（maxX-minX，含节点自身宽高）。 */
  width: number
  height: number
}

/** 节点 bbox（含 GRAPH_NODE_W/H），供 fit 断言「是否吃满画布宽度」。空布局返回 null。 */
export function layoutBBox(layout: GraphLayout): LayoutBBox | null {
  const ids = Object.keys(layout.positions)
  if (ids.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const id of ids) {
    const p = layout.positions[id]
    if (!p) continue
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x + GRAPH_NODE_W > maxX) maxX = p.x + GRAPH_NODE_W
    if (p.y + GRAPH_NODE_H > maxY) maxY = p.y + GRAPH_NODE_H
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/** 升序唯一值 → 值到序号的映射（列/行序推导，确定性）。 */
function axisIndex(values: number[]): Map<number, number> {
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  return new Map(sorted.map((v, i) => [v, i]))
}

/**
 * 把基础布局归一到实测画布宽度（纯函数）。
 * 返回新的 GraphLayout；输入不被修改。
 */
export function fitGraphLayout(base: GraphLayout, opts: MapFitOptions = {}): GraphLayout {
  const ids = Object.keys(base.positions)
  if (ids.length === 0) return base
  const vw = opts.viewportWidth ?? null
  if (typeof vw !== 'number' || !Number.isFinite(vw) || vw <= 0) return base

  const margin = opts.margin ?? MAP_FIT_MARGIN
  const colGapMin = opts.colGapMin ?? GRAPH_COL_GAP
  const rowGapMin = opts.rowGapMin ?? GRAPH_ROW_GAP
  const nodeW = GRAPH_NODE_W
  const nodeH = GRAPH_NODE_H

  const colOf = axisIndex(ids.map((id) => base.positions[id]?.x ?? 0))
  const rowOf = axisIndex(ids.map((id) => base.positions[id]?.y ?? 0))
  const cols = colOf.size
  const rows = rowOf.size

  const availW = Math.max(0, vw - margin * 2)
  // 归一化列间距：放得下 → 均分剩余宽度（首列贴左、末列贴右）；放不下 → 取下限并允许横向滚动。
  const idealGap = cols > 1 ? (availW - cols * nodeW) / (cols - 1) : 0
  const colGap = cols > 1 ? Math.max(colGapMin, idealGap) : 0
  // 单列时水平居中（否则贴左又会留出右侧空白）。
  const singleX = margin + Math.max(0, (availW - nodeW) / 2)
  const rowPitch = nodeH + rowGapMin

  const positions: Record<string, { x: number; y: number }> = {}
  for (const id of ids) {
    const p = base.positions[id]
    if (!p) continue
    const ci = colOf.get(p.x) ?? 0
    const ri = rowOf.get(p.y) ?? 0
    positions[id] = {
      x: Math.round(cols === 1 ? singleX : margin + ci * (nodeW + colGap)),
      y: Math.round(margin + ri * rowPitch),
    }
  }

  const contentW = cols === 1
    ? margin * 2 + nodeW
    : margin * 2 + (cols - 1) * (nodeW + colGap) + nodeW
  const contentH = margin * 2 + Math.max(0, rows - 1) * rowPitch + nodeH

  return {
    // 画布至少与容器同宽（消除右侧空白），内容更宽时按内容宽（保留横向滚动）。
    width: Math.ceil(Math.max(vw, contentW, base.width)),
    height: Math.ceil(Math.max(contentH, base.height)),
    positions,
  }
}
