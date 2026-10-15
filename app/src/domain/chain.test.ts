import { describe, expect, it } from 'vitest'
import {
  historyStatusToChainStatus,
  runHistoryChain,
  runScheduleChain,
} from './chain'
import { runScenario } from './engine'
import { verifyPlanConstraints } from './constraints'
import { assessHealth } from './health'
import { aggregateQuality } from './quality'
import { buildHistoryFixture, FIXED_HISTORY_SEED } from './history'
import { FIXED_SEED, UNITS } from './units'
import type { ScenarioId, Unit } from './types'

function scheduleFor(scenario: ScenarioId, units: Unit[] = UNITS) {
  const run = runScenario(scenario, units, FIXED_SEED)
  return runScheduleChain({ scenario, scenarioLabel: scenario, run })
}

function historyFor(fixtureId: string) {
  const fixture = buildHistoryFixture(fixtureId, FIXED_HISTORY_SEED)
  const quality = aggregateQuality(fixture)
  const health = assessHealth(fixture)
  return runHistoryChain({ fixture, quality, health })
}

describe('调度决策链与安全审查（合成调度来源）', () => {
  it('常态允许批准且就绪', () => {
    const chain = scheduleFor('normal')
    expect(chain.scope).toBe('schedule')
    expect(chain.safety.verdict).toBe('allow')
    expect(chain.overallStatus).toBe('ready')
    expect(chain.roles).toHaveLength(3)
  })

  it('角色顺序为 安全→调度→值班员', () => {
    const chain = scheduleFor('normal')
    expect(chain.roles.map((r) => r.id)).toEqual([
      'safety_reviewer',
      'dispatcher',
      'duty_engineer',
    ])
  })

  it('建议无解时拒绝批准（喘振场景）', () => {
    const chain = scheduleFor('surge')
    expect(chain.safety.checks.recommendationFeasible).toBe(false)
    expect(chain.safety.verdict).toBe('reject')
    expect(chain.safety.reasons.join(' ')).toContain('建议不可行')
  })

  it('单机故障场景建议无解时拒绝批准', () => {
    const chain = scheduleFor('unit_failure')
    expect(chain.safety.verdict).toBe('reject')
  })

  it('关键参数缺失时拒绝批准', () => {
    const units = UNITS.map((u) =>
      u.id === 'AC-01' ? ({ ...u, ratedCapacity: undefined } as unknown as Unit) : u,
    )
    const chain = scheduleFor('normal', units)
    expect(chain.safety.checks.missingKeyParams).toBe(true)
    expect(chain.safety.reasons.join(' ')).toContain('关键参数缺失')
  })

  it('安全审查始终确认离心机未进入候选', () => {
    const chain = scheduleFor('normal')
    expect(chain.safety.checks.centrifugalExcluded).toBe(true)
  })

  it('相同输入结果一致', () => {
    const a = scheduleFor('normal')
    const b = scheduleFor('normal')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('批准阻断与独立约束复验', () => {
  it('常态：建议经独立复验通过才允许批准，且始终标注基线对照', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED)
    const chain = runScheduleChain({ scenario: 'normal', scenarioLabel: '常态', run })
    const verified = verifyPlanConstraints(run.recommendation, run)
    expect(chain.safety.checks.recommendationFeasible).toBe(
      run.recommendation.feasible && verified.passed,
    )
    expect(chain.safety.verdict).toBe('allow')
    expect(chain.safety.reasons.join(' ')).toContain('基线对照')
    expect(chain.safety.reasons.join(' ')).toContain('17')
  })

  it('有未满足供气（单机故障）时业务侧拒绝批准并给出原因', () => {
    const chain = scheduleFor('unit_failure')
    expect(chain.safety.verdict).toBe('reject')
    expect(chain.safety.reasons.length).toBeGreaterThan(0)
    expect(chain.safety.manualActions.join(' ')).toContain('人工')
  })

  it('需求突增 12:00 需求 29.8 未超可用容量 32，不因场景名误判该桶', () => {
    const run = runScenario('surge', UNITS, FIXED_SEED)
    const noon = run.series.points.find((p) => p.minuteOfDay === 12 * 60)
    expect(noon?.demand).toBe(29.8)
    const capacity = run.evaluation.candidates.reduce(
      (s, u) => s + u.ratedCapacity,
      0,
    )
    expect(capacity).toBe(32)
    const infeasibleNoon = run.recommendation.infeasiblePeriods.find(
      (p) => p.index === (12 * 60) / 15,
    )
    expect(infeasibleNoon).toBeUndefined()
    expect(run.recommendation.infeasiblePeriods.length).toBeGreaterThan(0)
  })
})

describe('回放核查链（合成回放来源，只读）', () => {
  it('全通过夹具为 trusted 且只有质量/健康两个角色', () => {
    const review = historyFor('fx_clean')
    expect(review.scope).toBe('history')
    expect(review.status).toBe('trusted')
    expect(review.roles.map((r) => r.id)).toEqual(['data_quality', 'equipment_health'])
    expect(review.roles.some((r) => r.id === 'dispatcher')).toBe(false)
  })

  it('存在 invalid 桶时回放统计被禁用', () => {
    const review = historyFor('fx_baseline')
    expect(review.status).toBe('blocked')
    expect(review.counts.invalid).toBeGreaterThan(0)
    expect(review.manualActions.join(' ')).toContain('C-01')
    expect(historyStatusToChainStatus(review.status)).toBe('blocked')
  })

  it('回放 invalid 不影响合成调度可行性/可否批准', () => {
    expect(historyFor('fx_baseline').status).toBe('blocked')
    const chain = scheduleFor('normal')
    expect(chain.safety.verdict).toBe('allow')
    expect(chain.overallStatus).toBe('ready')
  })

  it('调度无解不因回放全通过而可批准', () => {
    expect(historyFor('fx_clean').status).toBe('trusted')
    const chain = scheduleFor('unit_failure')
    expect(chain.safety.verdict).toBe('reject')
  })
})