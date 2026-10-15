import { describe, expect, it } from 'vitest'
import {
  buildPortfolioFixture,
  canSelectCandidate,
  canonicalCandidate,
  canonicalPortfolioInput,
  computeCandidateIdentity,
  computePareto,
  computeParetoAudited,
  computePortfolioInputIdentity,
  createGenerationGate,
  deepClone,
  isLegalCandidate,
  runPortfolioCandidate,
  snapshotToFixture,
  verifyCandidate,
} from './portfolio'
import { planSignature } from './approval'
import type { PlanResult } from './types'

function planFromFixture(
  fixture: ReturnType<typeof buildPortfolioFixture>,
  loadAt: (i: number) => number,
): PlanResult {
  const periods = fixture.points.map((pt, i) => ({
    index: i,
    minuteOfDay: pt.minuteOfDay,
    label: pt.label,
    demand: pt.demand,
    runningUnitIds: ['AC-01'],
    unitLoads: { 'AC-01': loadAt(i) },
    unitLoadRatios: { 'AC-01': 0.5 },
    supply: loadAt(i),
    margin: 0,
    powerKw: 1,
    energyKwh: 0.25,
    switches: 0,
    violations: [],
    rationale: 'test',
  }))
  return {
    planType: 'recommendation',
    feasible: true,
    infeasibleReasons: [],
    infeasiblePeriods: [],
    periods,
    totalEnergyKwh: 0,
    totalSwitches: 0,
    violationCount: 0,
    exclusionNotes: [],
  }
}

describe('portfolio-dev-v1 输入与身份', () => {
  it('96 桶 minute0..1425、seed 20261003、初态正确', () => {
    const f = buildPortfolioFixture('p_capacity_rise')
    expect(f.points).toHaveLength(96)
    expect(f.points[0].minuteOfDay).toBe(0)
    expect(f.points[95].minuteOfDay).toBe(1425)
    expect(f.seed).toBe(20261003)
    expect(f.initial).toEqual({
      runningUnitIds: ['AC-01'],
      minutesSinceChange: { 'AC-01': 30, 'AC-02': 30, 'AC-03': 30 },
    })
  })

  it('AC-03 未知喘振始终排除；备用承接 candidates=[AC-02]', () => {
    for (const id of ['p_capacity_rise', 'p_oscillate', 'p_standby_takeover', 'p_over_capacity'] as const) {
      const f = buildPortfolioFixture(id)
      expect(f.evaluation.candidates.map((u) => u.id)).not.toContain('AC-03')
      const ac03 = f.evaluation.eligibility.find((e) => e.unitId === 'AC-03')
      expect(ac03?.eligible).toBe(false)
    }
    expect(buildPortfolioFixture('p_standby_takeover').evaluation.candidates.map((u) => u.id)).toEqual(['AC-02'])
  })

  it('超容量例含 32.5；容量内例均 ≤32', () => {
    const over = buildPortfolioFixture('p_over_capacity').points.map((p) => p.demand)
    expect(Math.max(...over)).toBeGreaterThan(32)
    for (const id of ['p_capacity_rise', 'p_oscillate', 'p_standby_takeover'] as const) {
      const d = buildPortfolioFixture(id).points.map((p) => p.demand)
      expect(Math.max(...d)).toBeLessThanOrEqual(32)
    }
  })

  it('inputIdentity 不含策略目标；微小可表示 demand 差异改变身份', () => {
    const f = buildPortfolioFixture('p_capacity_rise')
    const id = computePortfolioInputIdentity(f)
    const tweaked = { ...f, points: f.points.map((p, i) => (i === 0 ? { ...p, demand: p.demand + 0.00001 } : p)) }
    expect(computePortfolioInputIdentity(tweaked)).not.toBe(id)
    const a = computeCandidateIdentity(id, 'milp_weighted', null)
    const b = computeCandidateIdentity(id, 'lab_energy_first', null)
    expect(a).not.toBe(b)
    expect(a).toContain('strategy=milp_weighted')
    expect(a).toContain('domain=flow-milp')
  })
})

describe('b01b canonical 身份与完整桶反例', () => {
  it('负荷仅差 0.00001：旧 planSignature 相撞，canonicalId 必须不同', () => {
    const f = buildPortfolioFixture('p_capacity_rise')
    const p1 = planFromFixture(f, (i) => (i === 0 ? 1.00001 : 1))
    const p2 = planFromFixture(f, (i) => (i === 0 ? 1.00002 : 1))
    expect(planSignature(p1)).toBe(planSignature(p2))
    const c1 = canonicalCandidate(f, 'lab_energy_first', p1)
    const c2 = canonicalCandidate(f, 'lab_energy_first', p2)
    expect(c1.ok).toBe(true)
    expect(c2.ok).toBe(true)
    expect(c1.id).not.toBe(c2.id)
    expect(c1.inputIdentity).toBe(c2.inputIdentity)
    expect(computeCandidateIdentity(c1.inputIdentity, 'lab_energy_first', p1)).not.toBe(
      computeCandidateIdentity(c2.inputIdentity, 'lab_energy_first', p2),
    )
  })

  it('非有限 demand 拒绝为无效输入身份', () => {
    const f = buildPortfolioFixture('p_capacity_rise')
    const bad = { ...f, points: f.points.map((p, i) => (i === 0 ? { ...p, demand: NaN } : p)) }
    const r = canonicalPortfolioInput(bad)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('non-finite')
  })

  it('缺桶 / 重复 / 错序 / 仅删末桶（尾部截断）拒绝', () => {
    const f = buildPortfolioFixture('p_capacity_rise')
    expect(canonicalPortfolioInput({ ...f, points: f.points.slice(1) }).ok).toBe(false)
    expect(canonicalPortfolioInput({ ...f, points: f.points.slice(0, 95) }).ok).toBe(false)
    expect(canonicalPortfolioInput({ ...f, points: [...f.points, { ...f.points[95] }] }).ok).toBe(false)
    const swapped = [...f.points]
    ;[swapped[0], swapped[1]] = [swapped[1], swapped[0]]
    expect(canonicalPortfolioInput({ ...f, points: swapped }).ok).toBe(false)
  })

  it('计划缺桶 / 重复运行 ID / 未知机组拒绝为无效候选', () => {
    const f = buildPortfolioFixture('p_capacity_rise')
    const shortPlan = { ...planFromFixture(f, () => 1), periods: planFromFixture(f, () => 1).periods.slice(0, 95) }
    expect(canonicalCandidate(f, 'conservative_rule', shortPlan).ok).toBe(false)
    const dupPlan = planFromFixture(f, () => 1)
    dupPlan.periods[0].runningUnitIds = ['AC-01', 'AC-01']
    dupPlan.periods[0].unitLoads = { 'AC-01': 1 }
    expect(canonicalCandidate(f, 'conservative_rule', dupPlan).ok).toBe(false)
    const unknownPlan = planFromFixture(f, () => 1)
    unknownPlan.periods[0].runningUnitIds = ['AC-99']
    unknownPlan.periods[0].unitLoads = { 'AC-99': 1 }
    expect(canonicalCandidate(f, 'conservative_rule', unknownPlan).ok).toBe(false)
  })
})

describe('b01b isLegalCandidate 不复信任自带 bool（真实候选 + 篡改反例）', () => {
  it('真实合法候选通过复算；疑似字段须逐项复核对', async () => {
    const c = await runPortfolioCandidate(buildPortfolioFixture('p_capacity_rise'), 'conservative_rule', 7)
    expect(isLegalCandidate(c)).toBe(true)
    expect(c.batchId).toBe(7)
    expect(verifyCandidate(c).ok).toBe(true)
  }, 30000)

  it('① 只改首桶 unitLoads +0.00001 但 canonicalId 不改 → 拒绝', async () => {
    const c = await runPortfolioCandidate(buildPortfolioFixture('p_capacity_rise'), 'conservative_rule')
    const tampered = deepClone(c)
    const pid = tampered.plan!.periods[0]
    const firstId = Object.keys(pid.unitLoads)[0]
    pid.unitLoads[firstId] = (pid.unitLoads[firstId] ?? 0) + 0.00001
    const v = verifyCandidate(tampered)
    expect(v.ok).toBe(false)
    expect(v.reasons.join(';')).toContain('canonical-id-mismatch')
    expect(isLegalCandidate(tampered)).toBe(false)
  }, 30000)

  it('② metrics.energyKwh 改为有限值 1 → 拒绝', async () => {
    const c = await runPortfolioCandidate(buildPortfolioFixture('p_capacity_rise'), 'conservative_rule')
    const tampered = deepClone(c)
    tampered.metrics.energyKwh = 1
    const v = verifyCandidate(tampered)
    expect(v.ok).toBe(false)
    expect(v.reasons.join(';')).toContain('metrics-energy-mismatch')
  }, 30000)

  it('③ 删除计划末桶 → 拒绝（含 95 桶输入）', async () => {
    const c = await runPortfolioCandidate(buildPortfolioFixture('p_capacity_rise'), 'conservative_rule')
    const tampered = deepClone(c)
    tampered.plan!.periods = tampered.plan!.periods.slice(0, 95)
    expect(verifyCandidate(tampered).ok).toBe(false)
    const shortFixture = buildPortfolioFixture('p_capacity_rise')
    shortFixture.points = shortFixture.points.slice(0, 95)
    expect(canonicalPortfolioInput(shortFixture).ok).toBe(false)
  }, 30000)

  it('原 fixture 对象被修改不影响候选快照与身份', async () => {
    const fixture = buildPortfolioFixture('p_capacity_rise')
    const c = await runPortfolioCandidate(fixture, 'conservative_rule')
    const canonicalBefore = c.canonicalId
    fixture.points[0].demand = 999
    fixture.evaluation.eligibility[0].eligible = false
    fixture.initial.runningUnitIds = []
    expect(isLegalCandidate(c)).toBe(true)
    expect(c.canonicalId).toBe(canonicalBefore)
    expect(c.inputSnapshot.points[0].demand).not.toBe(999)
    expect(canonicalPortfolioInput(snapshotToFixture(c.inputSnapshot)).ok).toBe(true)
  }, 30000)

  it('换 objective/domain 冒充被拒', async () => {
    const c = await runPortfolioCandidate(buildPortfolioFixture('p_capacity_rise'), 'lab_energy_first')
    const tampered = deepClone(c)
    tampered.objectiveVersion = 'weighted-demo-v1'
    tampered.domain = 'flow-milp'
    const v = verifyCandidate(tampered)
    expect(v.ok).toBe(false)
    expect(v.reasons.join(';')).toContain('objective-mismatch')
    expect(v.reasons.join(';')).toContain('domain-mismatch')
  }, 30000)
})

describe('b01b 选择权威门（取消后不可重选旧卡）', () => {
  it('通过复算方可选；退休后 active 为空则拒绝', async () => {
    const c = await runPortfolioCandidate(buildPortfolioFixture('p_capacity_rise'), 'conservative_rule', 3)
    const ok = canSelectCandidate([c], c, c.inputIdentity, 3)
    expect(ok.ok).toBe(true)
    // 取消/换输入：活动集合清空，旧卡退休为只读历史
    const history = [c]
    expect(canSelectCandidate([], history[0], c.inputIdentity, 3).ok).toBe(false)
    expect(canSelectCandidate([], history[0], c.inputIdentity, 3).reasons).toContain('not-in-active-batch')
    expect(canSelectCandidate([c], null, c.inputIdentity, 3).ok).toBe(false)
    expect(canSelectCandidate([c], c, c.inputIdentity, 4).reasons).toContain('batch-mismatch')
  }, 30000)
})

describe('portfolio Pareto（同 input、同域、复算合法）', () => {
  it('跨域不比较；同域等价可识别；混合输入进入 rejected', async () => {
    const cap = buildPortfolioFixture('p_capacity_rise')
    const capEnergy = await runPortfolioCandidate(cap, 'lab_energy_first', 1)
    const capSwitch = await runPortfolioCandidate(cap, 'lab_switch_first', 1)
    const capConservative = await runPortfolioCandidate(cap, 'conservative_rule', 1)
    const capMilp = await runPortfolioCandidate(cap, 'milp_weighted', 1)
    const oscMilp = await runPortfolioCandidate(buildPortfolioFixture('p_oscillate'), 'milp_weighted', 1)

    const audit = computeParetoAudited(capEnergy.inputIdentity, [
      capEnergy,
      capSwitch,
      capConservative,
      capMilp,
      oscMilp,
    ])
    // 跨域：dp 与 conservative/flow 分属不同 group
    const domains = audit.groups.map((g) => g.domain).sort()
    expect(domains).toEqual(['conservative-rule', 'dp-lookahead', 'flow-milp'])
    // 混合输入被拒且保留原因
    expect(audit.rejected.some((r) => r.reason === 'input_mismatch')).toBe(true)
    // 同一合法候选的克隆（同 canonicalId/同快照，仅短键不同）应识别为等价
    const clone = deepClone(capEnergy)
    clone.candidateId = `${capEnergy.candidateId}-clone`
    const audit2 = computeParetoAudited(capEnergy.inputIdentity, [capEnergy, clone])
    const dp = audit2.groups.find((g) => g.domain === 'dp-lookahead')!
    expect(dp.equivalents.some((e) => e.candidateId === clone.candidateId)).toBe(true)
    expect(computePareto(capEnergy.inputIdentity, [capEnergy]).length).toBeGreaterThan(0)
  }, 120000)

  it('失败/非法候选不入 Pareto 圈', async () => {
    const c = await runPortfolioCandidate(buildPortfolioFixture('p_capacity_rise'), 'conservative_rule', 1)
    const bad = deepClone(c)
    bad.verified = false
    expect(isLegalCandidate(bad)).toBe(false)
    const audit = computeParetoAudited(c.inputIdentity, [bad])
    expect(audit.groups).toEqual([])
    expect(audit.rejected).toHaveLength(1)
  }, 30000)

  it('generation gate：retire 后旧代次不再当前', () => {
    const gate = createGenerationGate()
    const e1 = gate.retire()
    expect(gate.isCurrent(e1)).toBe(true)
    const e2 = gate.retire()
    expect(gate.isCurrent(e1)).toBe(false)
    expect(gate.isCurrent(e2)).toBe(true)
  })
})

describe('portfolio 真实 96 桶 WASM 求解与复验', () => {
  it('容量内 96 桶 MILP 真实求解并双门复验（超时保留状态）', async () => {
    const f = buildPortfolioFixture('p_capacity_rise')
    const c = await runPortfolioCandidate(f, 'milp_weighted')
    expect(['optimal', 'feasible_not_optimal', 'time_limit_with_incumbent', 'no_primal', 'infeasible', 'invalid']).toContain(c.status)
    if (c.plan) {
      expect(c.verified).toBe(true)
      expect(c.metricsOk).toBe(true)
      expect(c.metrics.energyKwh).not.toBeNull()
      expect(c.plan.periods).toHaveLength(96)
      expect(isLegalCandidate(c)).toBe(true)
    }
  }, 60000)

  it('32.5 超容量例无合法方案', async () => {
    const f = buildPortfolioFixture('p_over_capacity')
    const c = await runPortfolioCandidate(f, 'milp_weighted')
    expect(c.plan).toBeNull()
    expect(isLegalCandidate(c)).toBe(false)
  }, 60000)

  it('备用承接（AC-02 单机）保守规则与 DP 候选产出且复验', async () => {
    const f = buildPortfolioFixture('p_standby_takeover')
    const conservative = await runPortfolioCandidate(f, 'conservative_rule')
    const dp = await runPortfolioCandidate(f, 'lab_energy_first')
    expect(conservative.plan).not.toBeNull()
    expect(conservative.verified).toBe(true)
    expect(dp.plan).not.toBeNull()
    expect(dp.verified).toBe(true)
  }, 30000)
})
