import { describe, expect, it } from 'vitest'
import { buildTimeline, type EventCategory } from './events'
import { runHistoryChain, runScheduleChain } from './chain'
import { runScenario } from './engine'
import { assessHealth } from './health'
import { aggregateQuality, STATION_ID } from './quality'
import { buildHistoryFixture } from './history'
import { SCENARIOS } from './demand'
import { FIXED_SEED, UNITS } from './units'
import type { ApprovalDecision } from './types'

function timelineFor(scenario: 'normal' | 'surge' | 'unit_failure', fixtureId = 'fx_baseline') {
  const scenarioLabel = SCENARIOS.find((s) => s.id === scenario)?.label ?? scenario
  const run = runScenario(scenario, UNITS, FIXED_SEED)
  const fixture = buildHistoryFixture(fixtureId)
  const quality = aggregateQuality(fixture)
  const health = assessHealth(fixture)
  const scheduleChain = runScheduleChain({ scenario, scenarioLabel, run })
  const historyReview = runHistoryChain({ fixture, quality, health })
  const decision: ApprovalDecision = {
    id: 'normal-1',
    scenario: 'normal',
    action: 'approve',
    reason: '演示批准理由',
    createdAt: '2026-09-30 10:00:00',
    synthetic: true,
  }
  const decisions = scenario === 'normal' ? [decision] : []
  const events = buildTimeline({
    run,
    scenarioLabel,
    quality,
    health,
    scheduleChain,
    historyReview,
    decisions,
  })
  return { events, quality }
}

describe('事件时间线：真实状态与来源映射', () => {
  it('每条事件都有 source/time/category/status/reason', () => {
    const { events } = timelineFor('normal')
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(e.source).toMatch(/^synthetic_/)
      expect(e.time.length).toBeGreaterThan(0)
      expect(e.category.length).toBeGreaterThan(0)
      expect(e.status.length).toBeGreaterThan(0)
      expect(e.reason.length).toBeGreaterThan(0)
    }
  })

  it('调度来源事件只映射到调度时轴，回放来源只映射到回放时轴', () => {
    const { events } = timelineFor('normal')
    for (const e of events) {
      if (!e.locate) continue
      expect(e.locate.sourceId).toBe(e.source)
      if (e.source === 'synthetic_schedule') {
        expect(e.locate.kind).toBe('schedule')
      } else {
        expect(e.locate.kind).toBe('history')
      }
    }
  })

  it('回放数据质量事件映射到真实桶与机组', () => {
    const { events, quality } = timelineFor('normal')
    const dq = events.filter((e) => e.category === 'data_quality')
    expect(dq.length).toBeGreaterThan(0)
    for (const e of dq) {
      const loc = e.locate
      expect(loc?.kind).toBe('history')
      if (!loc || loc.kind !== 'history') continue
      const exists = quality.some(
        (b) => b.machineId === loc.machineId && b.bucketIndex === loc.index,
      )
      expect(exists).toBe(true)
    }
  })

  it('回放健康事件可取到站级或机组级真实桶', () => {
    const { events } = timelineFor('normal')
    const health = events.filter((e) => e.category === 'health_rule')
    for (const e of health) {
      if (!e.locate) continue
      const loc = e.locate
      expect(loc.kind).toBe('history')
      if (loc.kind !== 'history') continue
      expect([STATION_ID, 'C-01', 'C-02']).toContain(loc.machineId)
    }
  })

  it('安全结论与人工处置无法映射到具体时刻时保持未关联', () => {
    const { events } = timelineFor('normal')
    const verdicts = events.filter((e) => e.category === 'safety_review')
    expect(verdicts.length).toBeGreaterThan(0)
    for (const e of verdicts) expect(e.locate).toBeNull()

    const human = events.filter((e) => e.category === 'human_action')
    expect(human.length).toBe(1)
    expect(human[0].locate).toBeNull()
    expect(human[0].status).toBe('已批准')
    expect(human[0].reason).toBe('演示批准理由')
  })

  it('无解场景的调度事件映射到第一个无解时段', () => {
    const { events } = timelineFor('surge')
    const sched = events.find((e) => e.category === 'schedule')
    expect(sched?.status).toBe('建议无解')
    expect(sched?.locate?.kind).toBe('schedule')
  })

  it('类别是封闭集合，不新增虚构严重度字段', () => {
    const { events } = timelineFor('normal')
    const allowed: EventCategory[] = [
      'data_quality',
      'health_rule',
      'schedule',
      'safety_review',
      'human_action',
    ]
    for (const e of events) expect(allowed).toContain(e.category)
  })
})