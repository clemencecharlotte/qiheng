import { describe, expect, it } from 'vitest'
import { buildHistoryFixture } from './history'
import { assessHealth, findRuns } from './health'

interface Probe {
  minuteIndex: number
  hit: boolean
}

function runsOf(entries: Array<[number, boolean]>): number[][] {
  const samples: Probe[] = entries.map(([minuteIndex, hit]) => ({ minuteIndex, hit }))
  return findRuns(samples, (s) => s.hit).map((run) =>
    run.map((s) => s.minuteIndex),
  )
}

describe('findRuns 连续窗口切分', () => {
  it('连续命中切成一段', () => {
    expect(runsOf([[0, true], [1, true], [2, true]])).toEqual([[0, 1, 2]])
  })

  it('缺分钟后再命中不跨缺测拼接（保留前段）', () => {
    expect(runsOf([[0, true], [1, true], [3, true], [4, true]])).toEqual([
      [0, 1],
      [3, 4],
    ])
  })

  it('恢复一段时间后再次发生各成一段', () => {
    expect(
      runsOf([[0, true], [1, true], [2, true], [3, false], [4, true], [5, true]]),
    ).toEqual([
      [0, 1, 2],
      [4, 5],
    ])
  })

  it('缺值（该分钟不命中）不并入相邻段', () => {
    expect(runsOf([[0, true], [1, false], [2, true]])).toEqual([[0], [2]])
  })
})

describe('规则异常提示', () => {
  it('对照夹具不触发演示阈值内的规则异常', () => {
    expect(assessHealth(buildHistoryFixture('fx_clean'))).toHaveLength(0)
  })

  it('各演示阈值在对应异常桶触发', () => {
    const findings = assessHealth(buildHistoryFixture('fx_baseline'))
    const byRule = new Set(findings.map((f) => f.ruleId))
    expect(byRule.has('RATED_POWER_EXCEEDANCE')).toBe(true)
    expect(byRule.has('PRESSURE_ZERO_WITH_FLOW')).toBe(true)
    expect(byRule.has('FLOW_OVER_RATED_TOTAL')).toBe(true)
    expect(byRule.has('UNKNOWN_STATE_REPEAT')).toBe(true)
  })

  it('结论措辞为规则异常提示且声明非预测', () => {
    const findings = assessHealth(buildHistoryFixture('fx_baseline'))
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      expect(f.statement).toContain('规则异常提示')
      expect(f.statement).toContain('非故障预测')
      expect(f.unknowns.join('')).toContain('准确率')
    }
  })

  it('相同夹具与种子结果一致', () => {
    const a = assessHealth(buildHistoryFixture('fx_baseline'))
    const b = assessHealth(buildHistoryFixture('fx_baseline'))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})