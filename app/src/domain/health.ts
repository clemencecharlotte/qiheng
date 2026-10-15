import {
  HISTORY_MACHINES,
  HISTORY_TOTAL_ARCHIVE_RATED_FLOW,
  type HistoryFixture,
  type MinuteSample,
} from './history'
import { STATION_ID } from './quality'

export interface HealthRule {
  id: string
  label: string
  threshold: string
  window: string
  severity: 'info' | 'watch'
}

export const HEALTH_RULES: HealthRule[] = [
  {
    id: 'RATED_POWER_EXCEEDANCE',
    label: '功率超档案额定',
    threshold: '分钟功率 > 105% × 档案额定功率',
    window: '连续 ≥ 3 分钟',
    severity: 'watch',
  },
  {
    id: 'PRESSURE_ZERO_WITH_FLOW',
    label: '零压力仍有流量',
    threshold: '压力 = 0 MPa 且流量 > 0 m³/min',
    window: '连续 ≥ 2 分钟',
    severity: 'watch',
  },
  {
    id: 'FLOW_OVER_RATED_TOTAL',
    label: '总流量超档案额定',
    threshold: `分钟总流量 > 档案额定总流量 ${HISTORY_TOTAL_ARCHIVE_RATED_FLOW} m³/min`,
    window: '连续 ≥ 3 分钟',
    severity: 'watch',
  },
  {
    id: 'UNKNOWN_STATE_REPEAT',
    label: '未知运行状态聚集',
    threshold: '同一 15 分钟桶内未知状态 ≥ 5 分钟',
    window: '按桶统计',
    severity: 'info',
  },
]

export interface HealthFinding {
  id: string
  ruleId: string
  ruleLabel: string
  machineId: string
  severity: 'info' | 'watch'
  statement: string
  threshold: string
  window: string
  basisMinutes: number[]
  basisLabels: string[]
  sampleKeys: string[]
  unknowns: string[]
  action: string
}

const UNVERIFIED_NOTE = [
  '离心机喘振边界与启停边界未核实，不能据此推断喘振真值。',
  '缺少故障标签真值，本项不是故障预测，也不计算准确率。',
]

export function findRuns<T extends { minuteIndex: number }>(
  samples: T[],
  predicate: (s: T) => boolean,
): T[][] {
  const sorted = [...samples].sort((a, b) => a.minuteIndex - b.minuteIndex)
  const runs: T[][] = []
  let current: T[] = []
  for (const s of sorted) {
    const contiguous =
      current.length > 0 &&
      s.minuteIndex === current[current.length - 1].minuteIndex + 1
    if (predicate(s)) {
      if (contiguous || current.length === 0) {
        current.push(s)
      } else {
        // 命中但分钟不连续（含缺测造成的断点）：先保存前一段，再开启新段，
        // 不允许跨缺测把两段拼成一段。
        runs.push(current)
        current = [s]
      }
    } else if (current.length > 0) {
      runs.push(current)
      current = []
    }
  }
  if (current.length > 0) runs.push(current)
  return runs
}

function makeFinding(
  rule: HealthRule,
  machineId: string,
  members: MinuteSample[],
): HealthFinding {
  const ruleMeta = HEALTH_RULES.find((r) => r.id === rule.id) ?? rule
  return {
    id: `${rule.id}:${machineId}:${members[0].minuteIndex}`,
    ruleId: rule.id,
    ruleLabel: rule.label,
    machineId,
    severity: ruleMeta.severity,
    statement: `规则异常提示（非故障预测）：${ruleMeta.label}，触发窗口 ${members[0].label} 起，共 ${members.length} 分钟。`,
    threshold: ruleMeta.threshold,
    window: ruleMeta.window,
    basisMinutes: members.map((m) => m.minuteIndex),
    basisLabels: members.map((m) => m.label),
    sampleKeys: members.map((m) => `${m.machineId}:${m.minuteIndex}`),
    unknowns: UNVERIFIED_NOTE,
    action:
      rule.id === 'UNKNOWN_STATE_REPEAT'
        ? '由数据质量员确认运行状态来源，必要时转人工核对台账。'
        : '由设备健康员结合档案复核，形成待观察清单；不自动下发起停指令。',
  }
}

function stationMinuteTotals(fixture: HistoryFixture): Array<{
  minuteIndex: number
  label: string
  total: number
  samples: MinuteSample[]
}> {
  const byMinute = new Map<number, MinuteSample[]>()
  for (const s of fixture.samples) {
    const list = byMinute.get(s.minuteIndex) ?? []
    list.push(s)
    byMinute.set(s.minuteIndex, list)
  }
  return [...byMinute.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([minuteIndex, samples]) => ({
      minuteIndex,
      label: samples[0].label,
      total: samples.reduce((acc, s) => acc + (s.flow ?? 0), 0),
      samples,
    }))
}

export function assessHealth(fixture: HistoryFixture): HealthFinding[] {
  const findings: HealthFinding[] = []

  for (const machine of HISTORY_MACHINES) {
    const samples = fixture.samples.filter((s) => s.machineId === machine.id)

    const powerRule = HEALTH_RULES[0]
    for (const run of findRuns(
      samples,
      (s) => s.power !== null && s.power > machine.archiveRatedPower * 1.05,
    )) {
      if (run.length >= 3) findings.push(makeFinding(powerRule, machine.id, run))
    }

    const zeroRule = HEALTH_RULES[1]
    for (const run of findRuns(
      samples,
      (s) => s.state === 'running' && s.pressure === 0 && (s.flow ?? 0) > 0,
    )) {
      if (run.length >= 2) findings.push(makeFinding(zeroRule, machine.id, run))
    }
  }

  const totals = stationMinuteTotals(fixture)
  const flowRule = HEALTH_RULES[2]
  for (const run of findRuns(totals, (t) => t.total > HISTORY_TOTAL_ARCHIVE_RATED_FLOW)) {
    if (run.length >= 3) {
      const pseudo: MinuteSample[] = run.map((t) => t.samples[0])
      findings.push(makeFinding(flowRule, STATION_ID, pseudo))
    }
  }

  const unknownRule = HEALTH_RULES[3]
  for (const machine of HISTORY_MACHINES) {
    for (let b = 0; b < fixture.bucketCount; b += 1) {
      const start = b * fixture.bucketMinutes
      const end = start + fixture.bucketMinutes
      const unknown = fixture.samples.filter(
        (s) =>
          s.machineId === machine.id &&
          s.minuteIndex >= start &&
          s.minuteIndex < end &&
          s.state === 'unknown',
      )
      if (unknown.length >= 5) findings.push(makeFinding(unknownRule, machine.id, unknown))
    }
  }

  return findings
}