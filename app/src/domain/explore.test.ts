import { describe, expect, it } from 'vitest'
import {
  advance,
  beginBrush,
  brushRange,
  bucketEndLabel,
  cancelBrush,
  clockSignature,
  effectiveIndex,
  endBrush,
  energyEligibility,
  followPlayback,
  initialExploreState,
  isTimeLocked,
  labelAt,
  lockTime,
  newBucketsSinceLock,
  outOfRangeNote,
  presetFull,
  presetLastHour,
  rangeFromLabels,
  resetExploreState,
  setHoverIndex,
  summarizeRange,
  togglePlaying,
  parseClockLabel,
  indexFromMinute,
  type TimelineClock,
} from './explore'

const SCHEDULE: TimelineClock = {
  sourceId: 'synthetic_schedule',
  stepMinutes: 15,
  count: 96,
  startMinute: 0,
}

const HISTORY: TimelineClock = {
  sourceId: 'synthetic_history',
  stepMinutes: 15,
  count: 16,
  startMinute: 8 * 60,
}

describe('共享观察时钟', () => {
  it('hover 只改 tooltip 游标，不改观察时刻', () => {
    const base = initialExploreState(SCHEDULE, 48)
    const hovered = setHoverIndex(SCHEDULE, base, 10)
    expect(hovered.hoverIndex).toBe(10)
    expect(effectiveIndex(hovered)).toBe(48)
    expect(effectiveIndex(hovered)).toBe(effectiveIndex(base))
    expect(hovered.playIndex).toBe(base.playIndex)
    expect(hovered.timeLock).toBeNull()
  })

  it('锁时后播放推进运输游标，但不抢主读数与固定证据', () => {
    let state = lockTime(SCHEDULE, initialExploreState(SCHEDULE, 20), 30)
    expect(effectiveIndex(state)).toBe(30)
    expect(isTimeLocked(state)).toBe(true)
    for (let i = 0; i < 5; i += 1) {
      state = advance(SCHEDULE, state).state
    }
    expect(state.playIndex).toBe(35)
    expect(effectiveIndex(state)).toBe(30)
    expect(newBucketsSinceLock(state)).toBe(5)
  })

  it('末端自动暂停；跟随播放显式解除锁定', () => {
    const atEnd = { ...initialExploreState(SCHEDULE, 95), playing: true }
    const result = advance(SCHEDULE, atEnd)
    expect(result.atEnd).toBe(true)
    expect(result.state.playing).toBe(false)

    const locked = lockTime(SCHEDULE, initialExploreState(SCHEDULE, 10), 40)
    const followed = followPlayback(locked)
    expect(followed.timeLock).toBeNull()
    expect(effectiveIndex(followed)).toBe(followed.playIndex)

    const restarted = togglePlaying(SCHEDULE, initialExploreState(SCHEDULE, 95))
    expect(restarted.playing).toBe(true)
    expect(restarted.playIndex).toBe(0)
  })

  it('调度与回放时轴不同：签名不同、标签不拼接分钟', () => {
    expect(clockSignature(SCHEDULE)).not.toBe(clockSignature(HISTORY))
    expect(labelAt(SCHEDULE, 0)).toBe('00:00')
    expect(labelAt(HISTORY, 0)).toBe('08:00')
    expect(labelAt(HISTORY, 1)).toBe('08:15')
    expect(SCHEDULE.count).not.toBe(HISTORY.count)
  })
})

describe('刷选范围', () => {
  it('水平拖跨至少一桶才刷选，单击只点锁', () => {
    expect(brushRange(10, 10)).toBeNull()

    const single = beginBrush(SCHEDULE, initialExploreState(SCHEDULE, 10), 10)
    const singleResult = endBrush(SCHEDULE, single, 10)
    expect(singleResult.committedRange).toBeNull()
    expect(singleResult.lockedIndex).toBe(10)
    expect(singleResult.state.timeLock).toBe(10)
    expect(singleResult.state.range).toBeNull()

    const drag = beginBrush(SCHEDULE, initialExploreState(SCHEDULE, 10), 10)
    const dragResult = endBrush(SCHEDULE, drag, 14)
    expect(dragResult.committedRange).toEqual([10, 14])
    expect(dragResult.state.range).toEqual([10, 14])
    expect(dragResult.state.timeLock).toBeNull()
  })

  it('取消未提交刷选保留已提交区间；Reset 只清探查状态', () => {
    const committed = {
      ...initialExploreState(SCHEDULE, 20),
      range: [20, 30] as [number, number],
      timeLock: 24,
    }
    const brushing = beginBrush(SCHEDULE, committed, 21)
    expect(cancelledRange(cancelBrush(brushing))).toEqual([20, 30])

    const reset = resetExploreState(committed)
    expect(reset.range).toBeNull()
    expect(reset.timeLock).toBeNull()
    expect(reset.playIndex).toBe(committed.playIndex)
    expect(reset.speed).toBe(committed.speed)
  })

  it('区间摘要区分 eligible / excluded；缺值与 review/invalid 排除，真实零保留', () => {
    const flags = [
      true, // pass
      false, // review
      false, // invalid
      true, // pass
      false, // 未观测（缺功率，value=null）
      true, // 真实零功率但 pass
    ]
    const summary = summarizeRange(SCHEDULE, [0, 5], flags)
    expect(summary.bucketCount).toBe(6)
    expect(summary.eligibleCount).toBe(3)
    expect(summary.excludedCount).toBe(3)
    expect(summary.note).toContain('eligible 3 / excluded 3')

    expect(energyEligibility({ value: null, grade: 'pass' })).toBe(false)
    expect(energyEligibility({ value: 12, grade: 'review' })).toBe(false)
    expect(energyEligibility({ value: 0, grade: 'pass' })).toBe(true)
    // B05b2：NaN/±Infinity/负值不得入可信分子分母
    expect(energyEligibility({ value: NaN, grade: 'pass' })).toBe(false)
    expect(energyEligibility({ value: Infinity, grade: 'pass' })).toBe(false)
    expect(energyEligibility({ value: -1, grade: 'pass' })).toBe(false)
  })

  it('观察时刻落在区间外时给出说明，不虚构区间内读数', () => {
    const range: [number, number] = [10, 20]
    expect(outOfRangeNote(SCHEDULE, range, 15)).toBeNull()
    const note = outOfRangeNote(SCHEDULE, range, 40)
    expect(note).toContain('不在已刷选区间')
    expect(note).toContain('不虚构')
  })

  it('全窗口 / 最近一小时预设：4 个完整桶，无 off-by-one', () => {
    expect(presetFull(HISTORY)).toEqual([0, 15])
    // 回放 08:00 起 16 桶：最近一小时 = 11:00–12:00 共 4 桶 → 索引 [12, 15]
    expect(presetLastHour(HISTORY)).toEqual([12, 15])
    // 调度 00:00 起 96 桶：最近一小时 = 23:00–次日 00:00 共 4 桶 → 索引 [92, 95]
    expect(presetLastHour(SCHEDULE)).toEqual([92, 95])
  })

  it('区间摘要用半开口径并正确处理次日 00:00', () => {
    const scheduleSummary = summarizeRange(
      SCHEDULE,
      presetLastHour(SCHEDULE),
      new Array(SCHEDULE.count).fill(true),
    )
    expect(scheduleSummary.bucketCount).toBe(4)
    expect(scheduleSummary.fromLabel).toBe('23:00')
    expect(scheduleSummary.toLabel).toBe('23:45')
    expect(scheduleSummary.endLabel).toBe('次日 00:00')
    expect(scheduleSummary.note).toContain('23:00–次日 00:00')
    expect(scheduleSummary.note).toContain('半开')

    const historySummary = summarizeRange(
      HISTORY,
      presetLastHour(HISTORY),
      new Array(HISTORY.count).fill(true),
    )
    expect(historySummary.bucketCount).toBe(4)
    expect(historySummary.fromLabel).toBe('11:00')
    expect(historySummary.endLabel).toBe('12:00')

    expect(bucketEndLabel(SCHEDULE, 95)).toBe('次日 00:00')
    expect(bucketEndLabel(HISTORY, 15)).toBe('12:00')
  })
})

describe('来源与审批隔离（纯状态层）', () => {
  it('切来源签名变化，重新初始化不携带旧锁与范围', () => {
    const scheduleState = {
      ...initialExploreState(SCHEDULE, 50),
      range: [10, 20] as [number, number],
      timeLock: 50,
    }
    expect(scheduleState.timeLock).toBe(50)
    expect(scheduleState.range).toEqual([10, 20])

    // 回放来源使用独立初始状态，不继承调度来源的锁 / 区间。
    const historyState = initialExploreState(HISTORY, 0)
    expect(historyState.timeLock).toBeNull()
    expect(historyState.range).toBeNull()
  })

  it('时钟操作不触碰决策记录对象', () => {
    const decision = {
      id: 'normal-20260929',
      scenario: 'normal',
      action: 'approve',
      candidateRef: 'AC-01+AC-02',
      ruleVersion: 'qiheng-rules-v0.4.0',
    }
    const snapshot = JSON.stringify(decision)
    let state = lockTime(SCHEDULE, initialExploreState(SCHEDULE, 10), 30)
    state = advance(SCHEDULE, state).state
    state = setHoverIndex(SCHEDULE, state, 5)
    resetExploreState(state)
    expect(JSON.stringify(decision)).toBe(snapshot)
  })
})

function cancelledRange(state: ReturnType<typeof cancelBrush>): [number, number] | null {
  return state.range
}

describe('起止时刻区间边界（与刷卡共用同一 range）', () => {
  it('对齐步长且时轴内的起止返回闭区间', () => {
    expect(rangeFromLabels(SCHEDULE, '00:00', '00:45')).toEqual({
      range: [0, 3],
      error: null,
    })
    expect(rangeFromLabels(SCHEDULE, '12:00', '13:00')).toEqual({
      range: [48, 52],
      error: null,
    })
  })

  it('止不晚于起时拒绝（至少跨一个桶）', () => {
    expect(rangeFromLabels(SCHEDULE, '01:00', '00:00').error).toBeTruthy()
    expect(rangeFromLabels(SCHEDULE, '01:00', '01:00').error).toBeTruthy()
  })

  it('未对齐步长或越界时拒绝', () => {
    expect(rangeFromLabels(SCHEDULE, '00:10', '01:00').error).toContain('步长')
    // 96 桶末桶为 23:45，24:00 越界
    expect(rangeFromLabels(SCHEDULE, '23:45', '24:00').error).toBeTruthy()
  })

  it('回放时轴以 08:00 起、16 桶（末桶 11:45）为界', () => {
    expect(rangeFromLabels(HISTORY, '08:00', '09:00')).toEqual({
      range: [0, 4],
      error: null,
    })
    // 12:00 超出 16 桶时轴
    expect(rangeFromLabels(HISTORY, '11:00', '12:00').error).toBeTruthy()
  })

  it('parseClockLabel / indexFromMinute 边界', () => {
    expect(parseClockLabel('08:30')).toBe(510)
    expect(parseClockLabel('24:00')).toBeNull()
    expect(parseClockLabel('8:5')).toBeNull()
    expect(indexFromMinute(HISTORY, 8 * 60)).toBe(0)
    expect(indexFromMinute(HISTORY, 8 * 60 + 10)).toBeNull()
    expect(indexFromMinute(HISTORY, 8 * 60 + 16 * 15)).toBeNull()
  })
})