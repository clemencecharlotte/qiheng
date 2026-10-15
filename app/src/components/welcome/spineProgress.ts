/**
 * M22 · 叙事线进度纯函数（几何与驱动解耦，可窄测）。
 *
 * 目标（本人实测证据）：进度不能"文档Y比例 × 全长弧长"——长横段会吃掉进度，
 * 滚动到 647/1294 仍为 0。改按**实际路径纵段**投射 55% 阅读线 Y：
 * - 纵段：阅读线落入其 [yMin,yMax] → 返回 (累计弧长 + 局部)/总弧长；
 * - 横接段：仅在阅读线越过其自身 Y（gutter/phase）时整段计入（不在中间插值，防长横扫吃进度）；
 * - 单调、可逆、同位置同姿态。
 */

export interface SpineSeg {
  x0: number
  y0: number
  x1: number
  y1: number
  /** 纵段（|dy| ≥ |dx|）；横接段 false */
  vertical: boolean
}

/** 由折线点集生成分段（相邻点），自动判定纵/横。 */
export function segmentsFromPoints(points: Array<{ x: number; y: number }>): SpineSeg[] {
  const segs: SpineSeg[] = []
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    segs.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, vertical: Math.abs(b.y - a.y) >= Math.abs(b.x - a.x) })
  }
  return segs
}

export function segmentLength(s: SpineSeg): number {
  return Math.hypot(s.x1 - s.x0, s.y1 - s.y0)
}

/**
 * 阅读线 Y → 归一路径进度 [0,1]。
 * @param segs 顺序分段
 * @param readingY 当前阅读线（文档/SVG 坐标系，与分段同系）
 */
export function spineProgressAt(segs: SpineSeg[], readingY: number): number {
  const lens = segs.map(segmentLength)
  const total = lens.reduce((a, b) => a + b, 0)
  if (total <= 0) return 0
  let acc = 0
  for (let i = 0; i < segs.length; i += 1) {
    const s = segs[i]
    if (s.vertical) {
      const yMin = Math.min(s.y0, s.y1)
      const yMax = Math.max(s.y0, s.y1)
      if (readingY <= yMin) return acc / total
      if (readingY < yMax) return (acc + (readingY - yMin)) / total
      acc += lens[i]
    } else {
      // 横接段：只在阅读线越过其 Y 后计入（gutter/phase 过渡），不中途插值。
      const y = Math.max(s.y0, s.y1)
      if (readingY <= y) return acc / total
      acc += lens[i]
    }
  }
  return 1
}

/** 可见盒（本地坐标，含导航/卡/标题等的包络）。 */
export interface AvoidBox { left: number; right: number; top: number; bottom: number }

export interface SpineBase {
  baseX: number
  startY: number
  turnY: number
  laneX: number
  ctaY: number
  ctaX: number
}

export interface BuildOpts {
  /** 局部右/左移最大偏移（超出则断开，不长横扫）。默认 160。 */
  maxOffset?: number
  /** 与冲突盒分离间距。默认 20（16–24）。 */
  margin?: number
}

/**
 * 原构图（cue 下起笔 → 转折 → 左 lane → CTA）+ **仅在冲突段的局部避让**。
 * 仅在 baseX 纵向穿过的可见盒处，按 nearest gutter 做 ≤maxOffset 的局部偏移并**立即回原线**；
 * 若需偏移 > maxOffset 则该区间**断开**（返回多个子路径），不做长横扫。
 * 无冲突盒时退化为原直线路径（安全兜底）。
 */
export function buildSpine(base: SpineBase, boxes: AvoidBox[], opts: BuildOpts = {}): { subpaths: Array<Array<{ x: number; y: number }>>; segs: SpineSeg[] } {
  const maxOffset = opts.maxOffset ?? 160
  const margin = opts.margin ?? 20
  const subs: Array<Array<{ x: number; y: number }>> = []
  let cur: Array<{ x: number; y: number }> = [{ x: base.baseX, y: base.startY }]
  let curY = base.startY
  const sorted = boxes
    .filter((b) => b.bottom > base.startY && b.top < base.turnY)
    .sort((a, b) => a.top - b.top)
  for (const b of sorted) {
    const yEnter = Math.max(base.startY, b.top - 12)
    const yExit = Math.min(base.turnY, b.bottom + 12)
    if (yExit <= curY) continue
    const crosses = base.baseX >= b.left - 8 && base.baseX <= b.right + 8
    if (!crosses) continue
    cur.push({ x: base.baseX, y: yEnter })
    const right = b.right + margin
    const left = b.left - margin
    const bumpX = Math.abs(right - base.baseX) <= Math.abs(left - base.baseX) ? right : left
    const off = Math.abs(bumpX - base.baseX)
    if (off > maxOffset) {
      // 断开（合法短段断开），不在文字/按钮行画长横扫。
      subs.push(cur)
      cur = [{ x: base.baseX, y: yExit }]
      curY = yExit
      continue
    }
    cur.push({ x: bumpX, y: yEnter }, { x: bumpX, y: yExit }, { x: base.baseX, y: yExit })
    curY = yExit
  }
  cur.push({ x: base.baseX, y: base.turnY }, { x: base.laneX, y: base.turnY }, { x: base.laneX, y: base.ctaY }, { x: base.ctaX, y: base.ctaY })
  subs.push(cur)
  const segs: SpineSeg[] = []
  for (const s of subs) segs.push(...segmentsFromPoints(s))
  return { subpaths: subs, segs }
}

