/**
 * D08-W1 · R2 CapabilityTrack 几何/状态纯函数（组件实际调用的决策，可窄测）。
 * 尺寸数学（s1-r2-final-review 修正版，首版可调）：
 * - 手机 390：内容 358 → 卡 318 / gap 12 / 露下一卡 28
 * - 手机 320：内容 288 → 卡 248 / gap 12 / 露 28
 * - 桌面：内容 1200 → 卡 360 / gap 24 / 露 48
 * 卡宽 = 由容器内容宽推导，不使用 100vw。
 */

export type CapabilityCategory = '运行' | '决策' | '数据' | '智能'
export type CapabilityState = 'available' | 'unconfigured' | 'unavailable'

export interface CapabilityItem {
  id: string
  category: CapabilityCategory
  title: string
  summary: string
  /** 真实路由 hash（宿主提供；组件不造 routes） */
  route: string
  /** 入口自然中文（宿主提供；不向用户暴露 hash；缺省回退「打开」） */
  entryLabel?: string
  /** 真实对象 ID（宿主对象映射；证据/详情跳转由主线消费，组件透传） */
  objectId?: string
  state: CapabilityState
}

export interface TrackMetrics {
  cardWidth: number
  gap: number
  /** 下一卡露出量 */
  peek: number
}

/** 由容器内容宽推导轨道度量（窄容器安全：卡最小 216，peek 保 24–48） */
export function trackMetricsFor(contentWidth: number): TrackMetrics {
  const w = Math.max(216, Math.floor(contentWidth))
  if (w < 560) {
    // 手机：单卡 + 露 28；gap 12；极窄容器（<256）诚实退化为贴边无露卡
    const gap = 12
    // 容器比最小卡更窄（<228）：贴满容器优先（不制造横溢），可用性下限让位
    const card = Math.min(Math.max(216, w - 28 - gap), Math.max(160, w - gap))
    const peek = Math.max(0, w - card - gap)
    return { cardWidth: card, gap, peek }
  }
  // 桌面/平板：卡 360 / gap 24 / 露 48 为规格定值（s1-r2-final-review）；
  // 容器更窄时卡收缩（≥216），gap/peek 保持——同屏卡数由容器自然减少。
  const gap = 24
  const peek = 48
  const card = Math.max(216, Math.min(360, w - peek - gap))
  return { cardWidth: card, gap, peek }
}

export const CAPABILITY_CATEGORIES: CapabilityCategory[] = ['运行', '决策', '数据', '智能']

/** 分类过滤：未知类别回退全量（不造空组） */
export function capabilitiesForCategory(items: CapabilityItem[], c: CapabilityCategory): CapabilityItem[] {
  const list = items.filter((i) => i.category === c)
  return list
}

/** 离场组不可交互判定：除当前组外全部 aria-hidden/禁 Tab/禁点击 */
export function isGroupActive(current: CapabilityCategory, c: CapabilityCategory): boolean {
  return current === c
}
