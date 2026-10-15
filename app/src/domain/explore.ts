import { formatMinuteOfDay } from './demand'
import type { SourceId } from './sources'

/**
 * 共享观察时钟与范围探查的纯逻辑。
 *
 * 设计约束（第二片）：
 * - 仅消费当前合成时轴；调度与回放来源的起点 / 桶数不同，不强行拼接分钟。
 * - hoverIndex 只用于 tooltip / 十字线；观察时刻 = timeLock ?? playIndex。
 * - 播放、hover、刷选都不触发求解、审批或执行命令。
 */

export type PlaySpeed = 0.5 | 1 | 2

export const PLAY_SPEEDS: PlaySpeed[] = [0.5, 1, 2]

/** 1× 下每个真实桶的演示回放间隔（毫秒）。 */
export const BASE_TICK_MS = 700

export interface TimelineClock {
  sourceId: SourceId
  /** 合法步长（分钟）。 */
  stepMinutes: number
  /** 合法桶数。 */
  count: number
  /** 首个桶对应的当日分钟（调度从 0，回放从 480）。 */
  startMinute: number
}

export interface ExploreState {
  /** 播放运输游标（真实桶索引）。 */
  playIndex: number
  /** 显式时间锁；null 表示跟随播放。 */
  timeLock: number | null
  /** 临时悬停游标，仅 tooltip / 十字线。 */
  hoverIndex: number | null
  /** 正在进行的刷选锚点；松手前不提交。 */
  brushStart: number | null
  /** 已提交的观察区间 [lo, hi]，null 表示全窗口。 */
  range: [number, number] | null
  playing: boolean
  speed: PlaySpeed
}

export function clockSignature(clock: TimelineClock): string {
  return `${clock.sourceId}:${clock.stepMinutes}:${clock.count}:${clock.startMinute}`
}

export function clampIndex(clock: TimelineClock, index: number): number {
  if (!Number.isFinite(index)) return 0
  const rounded = Math.round(index)
  return Math.min(clock.count - 1, Math.max(0, rounded))
}

export function initialExploreState(
  clock: TimelineClock,
  playIndex = 0,
): ExploreState {
  return {
    playIndex: clampIndex(clock, playIndex),
    timeLock: null,
    hoverIndex: null,
    brushStart: null,
    range: null,
    playing: false,
    speed: 1,
  }
}

export function effectiveIndex(state: ExploreState): number {
  return state.timeLock ?? state.playIndex
}

export function isTimeLocked(state: ExploreState): boolean {
  return state.timeLock !== null
}

/** 锁定后运输游标新推进的桶数；未锁定时恒为 0。 */
export function newBucketsSinceLock(state: ExploreState): number {
  if (state.timeLock === null) return 0
  return Math.max(0, state.playIndex - state.timeLock)
}

export function labelAt(clock: TimelineClock, index: number): string {
  return formatMinuteOfDay(
    clock.startMinute + clampIndex(clock, index) * clock.stepMinutes,
  )
}

/**
 * 桶结束边界标签（半开区间右端）：第 index 桶覆盖 [labelAt(index), bucketEndLabel(index))。
 * 跨日时明确标注“次日”，避免把 24:00 与 00:00 混为一谈。
 */
export function bucketEndLabel(clock: TimelineClock, index: number): string {
  const endMinute =
    clock.startMinute + (clampIndex(clock, index) + 1) * clock.stepMinutes
  if (endMinute >= 1440) {
    return `次日 ${formatMinuteOfDay(endMinute % 1440)}`
  }
  return formatMinuteOfDay(endMinute)
}

export interface AdvanceResult {
  state: ExploreState
  atEnd: boolean
}

/** 播放推进一个真实桶；到达末端自动暂停。 */
export function advance(clock: TimelineClock, state: ExploreState): AdvanceResult {
  const next = clampIndex(clock, state.playIndex + 1)
  if (next === state.playIndex) {
    return { state: { ...state, playing: false }, atEnd: true }
  }
  return { state: { ...state, playIndex: next }, atEnd: next >= clock.count - 1 }
}

/** 手动步进运输游标（不改变锁定与范围）。 */
export function stepTransport(
  clock: TimelineClock,
  state: ExploreState,
  delta: number,
): ExploreState {
  return { ...state, playIndex: clampIndex(clock, state.playIndex + delta) }
}

export function setSpeed(state: ExploreState, speed: PlaySpeed): ExploreState {
  return { ...state, speed }
}

export function togglePlaying(
  clock: TimelineClock,
  state: ExploreState,
): ExploreState {
  if (state.playing) return { ...state, playing: false }
  const atEnd = state.playIndex >= clock.count - 1
  return { ...state, playing: true, playIndex: atEnd ? 0 : state.playIndex }
}

export function pause(state: ExploreState): ExploreState {
  return state.playing ? { ...state, playing: false } : state
}

/** 显式锁定到某个真实桶：运输游标对齐该桶，之后播放不抢观察读数。 */
export function lockTime(
  clock: TimelineClock,
  state: ExploreState,
  index: number,
): ExploreState {
  const i = clampIndex(clock, index)
  return { ...state, timeLock: i, playIndex: i, hoverIndex: null }
}

/** 仅显式“跟随播放”解除时间锁。 */
export function followPlayback(state: ExploreState): ExploreState {
  return { ...state, timeLock: null }
}

export function setHoverIndex(
  clock: TimelineClock,
  state: ExploreState,
  index: number | null,
): ExploreState {
  return {
    ...state,
    hoverIndex: index === null ? null : clampIndex(clock, index),
  }
}

export function beginBrush(
  clock: TimelineClock,
  state: ExploreState,
  index: number,
): ExploreState {
  const i = clampIndex(clock, index)
  return { ...state, brushStart: i, hoverIndex: i }
}

export function moveBrush(
  clock: TimelineClock,
  state: ExploreState,
  index: number,
): ExploreState {
  return { ...state, hoverIndex: clampIndex(clock, index) }
}

export interface EndBrushResult {
  state: ExploreState
  committedRange: [number, number] | null
  lockedIndex: number | null
}

/** 松手：水平跨至少一桶则提交刷选，否则视为单击点锁。 */
export function endBrush(
  clock: TimelineClock,
  state: ExploreState,
  index: number,
): EndBrushResult {
  const i = clampIndex(clock, index)
  const anchor = state.brushStart
  if (anchor === null) {
    return { state, committedRange: null, lockedIndex: null }
  }
  const range = brushRange(anchor, i)
  if (range) {
    return {
      state: { ...state, brushStart: null, hoverIndex: i, range },
      committedRange: range,
      lockedIndex: null,
    }
  }
  return {
    state: { ...lockTime(clock, state, i), brushStart: null },
    committedRange: null,
    lockedIndex: i,
  }
}

export function cancelBrush(state: ExploreState): ExploreState {
  if (state.brushStart === null) return state
  return { ...state, brushStart: null, hoverIndex: null }
}

/** Reset：只清探查状态（范围 / 时间锁 / 游标 / 未提交刷选），不改运输与速度。 */
export function resetExploreState(state: ExploreState): ExploreState {
  return {
    ...state,
    range: null,
    timeLock: null,
    hoverIndex: null,
    brushStart: null,
  }
}

/** 水平拖跨至少一桶才算刷选；单桶返回 null。 */
export function brushRange(a: number, b: number): [number, number] | null {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (hi - lo < 1) return null
  return [lo, hi]
}

/** 解析 HH:MM 为当日分钟；非法或越界返回 null。 */
export function parseClockLabel(text: string): number | null {
  const match = text.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** 当日分钟映射到真实桶索引；须对齐步长且在时轴内，否则 null。 */
export function indexFromMinute(
  clock: TimelineClock,
  minuteOfDay: number,
): number | null {
  const offset = minuteOfDay - clock.startMinute
  if (offset < 0) return null
  const index = offset / clock.stepMinutes
  if (!Number.isInteger(index)) return null
  if (index > clock.count - 1) return null
  return index
}

export interface RangeInputResult {
  range: [number, number] | null
  error: string | null
}

/**
 * 由起止时刻得到观察区间（与刷卡共用同一 range 状态与边界校验）。
 * 闭区间 [起桶, 止桶]；必须对齐步长、落在时轴内，且止桶晚于起桶（至少跨一桶）。
 */
export function rangeFromLabels(
  clock: TimelineClock,
  startLabel: string,
  endLabel: string,
): RangeInputResult {
  const startMinute = parseClockLabel(startLabel)
  const endMinute = parseClockLabel(endLabel)
  if (startMinute === null || endMinute === null) {
    return { range: null, error: '时间格式应为 HH:MM（24 小时制）。' }
  }
  const lo = indexFromMinute(clock, startMinute)
  const hi = indexFromMinute(clock, endMinute)
  if (lo === null || hi === null) {
    return {
      range: null,
      error: `时间不在当前时轴内或未对齐 ${clock.stepMinutes} 分钟步长。`,
    }
  }
  if (hi <= lo) {
    return { range: null, error: '止时间须晚于起时间（区间至少跨一个桶）。' }
  }
  return { range: [lo, hi], error: null }
}

export function isFullRange(
  range: [number, number] | null,
): boolean {
  return range === null
}

export function inRange(
  range: [number, number] | null,
  index: number,
): boolean {
  if (!range) return true
  return index >= range[0] && index <= range[1]
}

export type RangeGrade = 'pass' | 'review' | 'invalid'

/**
 * 桶是否计入区间 eligible（可参与指标分子与分母）。
 * 缺值（未观测 / 功率不齐）与 review / invalid 均排除；
 * 真实零值（value === 0）保留为 eligible，不与缺值混淆。
 */
export function energyEligibility(point: {
  value: number | null
  grade: RangeGrade
}): boolean {
  // 额外要求有限非负：NaN/Infinity/负值不得进入可信分子分母；真实 0 仍 eligible。
  return (
    typeof point.value === 'number' &&
    Number.isFinite(point.value) &&
    point.value >= 0 &&
    point.grade === 'pass'
  )
}

export function presetFull(clock: TimelineClock): [number, number] {
  return [0, clock.count - 1]
}

/**
 * 最近一小时：按步长换算完整桶数（15 分钟桶 → 4 桶），右端取最后一个完整桶。
 * 索引区间是闭区间 [lo, hi]，桶数为 hi - lo + 1 = buckets。
 */
export function presetLastHour(clock: TimelineClock): [number, number] {
  const buckets = Math.max(1, Math.round(60 / clock.stepMinutes))
  const hi = clock.count - 1
  const lo = Math.max(0, hi - buckets + 1)
  return [lo, hi]
}

export interface RangeSummary {
  fromIndex: number
  toIndex: number
  fromLabel: string
  /** 末桶起始标签（闭区间语义）。 */
  toLabel: string
  /** 末桶结束标签（半开区间右端，跨日标注“次日”）。 */
  endLabel: string
  bucketCount: number
  eligibleCount: number
  excludedCount: number
  note: string
}

export function summarizeRange(
  clock: TimelineClock,
  range: [number, number],
  eligibleFlags: ReadonlyArray<boolean>,
): RangeSummary {
  const [lo, hi] = range
  let eligibleCount = 0
  let excludedCount = 0
  for (let i = lo; i <= hi; i += 1) {
    if (eligibleFlags[i]) eligibleCount += 1
    else excludedCount += 1
  }
  const bucketCount = hi - lo + 1
  const fromLabel = labelAt(clock, lo)
  const toLabel = labelAt(clock, hi)
  const endLabel = bucketEndLabel(clock, hi)
  const note = `观察区间 ${fromLabel}–${endLabel}（半开：含起始桶，止于末桶结束），共 ${bucketCount} 桶；eligible ${eligibleCount} / excluded ${excludedCount}（review / invalid 不参与指标分子与分母）。刷选只改观察区间，全日指标不随游标变化。`
  return {
    fromIndex: lo,
    toIndex: hi,
    fromLabel,
    toLabel,
    endLabel,
    bucketCount,
    eligibleCount,
    excludedCount,
    note,
  }
}

/** 观察时刻落在已提交区间之外时的说明；不假造区间内读数。 */
export function outOfRangeNote(
  clock: TimelineClock,
  range: [number, number] | null,
  index: number,
): string | null {
  if (!range || inRange(range, index)) return null
  return `当前观察时刻 ${labelAt(clock, index)} 不在已刷选区间 ${labelAt(
    clock,
    range[0],
  )}–${bucketEndLabel(clock, range[1])}（半开）内；读数仍来自当前时轴，不虚构区间内数值。`
}