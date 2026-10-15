import { formatMinuteOfDay } from './demand'
import { mulberry32, round } from './prng'

export const FIXED_HISTORY_SEED = 20260930
export const HISTORY_START_MINUTE = 8 * 60
export const HISTORY_FIXTURE_MINUTES = 240
export const BUCKET_MINUTES = 15
export const BUCKET_COUNT = HISTORY_FIXTURE_MINUTES / BUCKET_MINUTES

export const HISTORY_FIXTURE_BANNER = '合成回放夹具，不是主办方数据或现场实测'

export type RunningState = 'running' | 'stopped' | 'unknown'

export interface HistoryMachineArchive {
  id: string
  name: string
  kind: 'centrifugal'
  archiveRatedFlow: number
  archiveRatedPressure: number
  archiveRatedPower: number
}

export const HISTORY_MACHINES: HistoryMachineArchive[] = [
  {
    id: 'C-01',
    name: 'C-01 离心空压机（档案）',
    kind: 'centrifugal',
    archiveRatedFlow: 40,
    archiveRatedPressure: 0.8,
    archiveRatedPower: 250,
  },
  {
    id: 'C-02',
    name: 'C-02 离心空压机（档案）',
    kind: 'centrifugal',
    archiveRatedFlow: 32,
    archiveRatedPressure: 0.8,
    archiveRatedPower: 200,
  },
]

export const HISTORY_TOTAL_ARCHIVE_RATED_FLOW = HISTORY_MACHINES.reduce(
  (s, m) => s + m.archiveRatedFlow,
  0,
)

export interface MinuteSample {
  machineId: string
  minuteIndex: number
  minuteOfDay: number
  label: string
  state: RunningState
  flow: number | null
  pressure: number | null
  power: number | null
  stationTotalFlow: number | null
}

export type AnomalyKind =
  | 'minute_gap'
  | 'missing_power'
  | 'missing_pressure'
  | 'zero_pressure_with_flow'
  | 'flow_identity_mismatch'
  | 'over_rated_total'
  | 'unknown_state'
  | 'power_exceedance'

export interface BucketAnomaly {
  bucket: number
  kind: AnomalyKind
  machineId?: string
}

export interface HistoryFixtureMeta {
  id: string
  label: string
  description: string
  anomalies: BucketAnomaly[]
}

export interface HistoryFixture {
  id: string
  label: string
  seed: number
  synthetic: true
  readOnly: true
  note: string
  stepMinutes: 1
  bucketMinutes: number
  minuteCount: number
  bucketCount: number
  machines: HistoryMachineArchive[]
  anomalies: BucketAnomaly[]
  samples: MinuteSample[]
}

export const HISTORY_FIXTURES: HistoryFixtureMeta[] = [
  {
    id: 'fx_clean',
    label: '夹具 C｜全通过对照',
    description: '无注入异常的对照夹具，用于验证质量门全通过与安全审查允许批准的路径。',
    anomalies: [],
  },
  {
    id: 'fx_baseline',
    label: '夹具 A｜常态为主 + 异常桶',
    description:
      '多数桶为正常数据，含分钟缺口、功率缺值两个 invalid 桶，零压力有流量、流量恒等式不符、超档案额定总流量、未知运行状态四个 review 桶，以及一个质量合格但触发健康规则提示的功率超额定桶。',
    anomalies: [
      { bucket: 4, kind: 'minute_gap' },
      { bucket: 6, kind: 'missing_power', machineId: 'C-01' },
      { bucket: 8, kind: 'zero_pressure_with_flow', machineId: 'C-01' },
      { bucket: 9, kind: 'power_exceedance', machineId: 'C-01' },
      { bucket: 10, kind: 'flow_identity_mismatch' },
      { bucket: 12, kind: 'over_rated_total' },
      { bucket: 14, kind: 'unknown_state', machineId: 'C-02' },
    ],
  },
  {
    id: 'fx_gap_heavy',
    label: '夹具 B｜数据缺口集中',
    description:
      '连续出现分钟缺口、功率缺值、压力缺值，用于验证缺值不填零且不计入合格/节能统计。',
    anomalies: [
      { bucket: 2, kind: 'minute_gap' },
      { bucket: 3, kind: 'minute_gap' },
      { bucket: 5, kind: 'missing_power', machineId: 'C-01' },
      { bucket: 7, kind: 'missing_pressure', machineId: 'C-02' },
    ],
  },
]

function baseFlow(machine: HistoryMachineArchive, minuteIndex: number): number {
  const wave = 0.72 + 0.12 * Math.sin((minuteIndex / HISTORY_FIXTURE_MINUTES) * Math.PI * 2)
  return machine.archiveRatedFlow * wave
}

function buildRawSamples(
  machines: HistoryMachineArchive[],
  seed: number,
): MinuteSample[] {
  const samples: MinuteSample[] = []
  machines.forEach((machine, machineIndex) => {
    const rng = mulberry32(seed + (machineIndex + 1) * 104729)
    for (let i = 0; i < HISTORY_FIXTURE_MINUTES; i += 1) {
      const minuteOfDay = HISTORY_START_MINUTE + i
      const flow = baseFlow(machine, i) + (rng() * 2 - 1) * 0.8
      const pressure = machine.archiveRatedPressure * 0.97 + (rng() * 2 - 1) * 0.01
      const loadFactor = flow / machine.archiveRatedFlow
      const power =
        machine.archiveRatedPower * (0.45 + 0.4 * loadFactor) + (rng() * 2 - 1) * 3
      samples.push({
        machineId: machine.id,
        minuteIndex: i,
        minuteOfDay,
        label: formatMinuteOfDay(minuteOfDay),
        state: 'running',
        flow: round(flow, 2),
        pressure: round(pressure, 3),
        power: round(power, 2),
        stationTotalFlow: null,
      })
    }
  })
  return samples
}

function bucketRange(bucket: number): { start: number; end: number } {
  return { start: bucket * BUCKET_MINUTES, end: (bucket + 1) * BUCKET_MINUTES }
}

function applyAnomalies(
  samples: MinuteSample[],
  machines: HistoryMachineArchive[],
  anomalies: BucketAnomaly[],
): MinuteSample[] {
  let next = samples.map((s) => ({ ...s }))

  for (const anomaly of anomalies) {
    const { start, end } = bucketRange(anomaly.bucket)
    const inBucket = (s: MinuteSample) =>
      s.minuteIndex >= start && s.minuteIndex < end
    const targetMachines = anomaly.machineId
      ? machines.filter((m) => m.id === anomaly.machineId)
      : machines
    const targets = new Set(targetMachines.map((m) => m.id))

    if (anomaly.kind === 'minute_gap') {
      const gapMinute = start + 7
      next = next.filter((s) => s.minuteIndex !== gapMinute)
    } else if (anomaly.kind === 'missing_power') {
      next = next.map((s) =>
        inBucket(s) && targets.has(s.machineId) ? { ...s, power: null } : s,
      )
    } else if (anomaly.kind === 'missing_pressure') {
      next = next.map((s) =>
        inBucket(s) && targets.has(s.machineId) ? { ...s, pressure: null } : s,
      )
    } else if (anomaly.kind === 'zero_pressure_with_flow') {
      next = next.map((s) =>
        inBucket(s) && targets.has(s.machineId) ? { ...s, pressure: 0 } : s,
      )
    } else if (anomaly.kind === 'unknown_state') {
      next = next.map((s) =>
        inBucket(s) && targets.has(s.machineId) ? { ...s, state: 'unknown' } : s,
      )
    } else if (anomaly.kind === 'over_rated_total') {
      next = next.map((s) =>
        inBucket(s) && targets.has(s.machineId)
          ? { ...s, flow: round((s.flow ?? 0) * 1.8, 2) }
          : s,
      )
    } else if (anomaly.kind === 'power_exceedance') {
      next = next.map((s) => {
        if (!inBucket(s) || !targets.has(s.machineId)) return s
        const machine = machines.find((m) => m.id === s.machineId)
        return machine
          ? { ...s, power: round(machine.archiveRatedPower * 1.12, 2) }
          : s
      })
    }
  }

  // station total flow is derived after all flow mutations
  const stationSumByMinute = new Map<number, number>()
  for (const s of next) {
    stationSumByMinute.set(
      s.minuteIndex,
      (stationSumByMinute.get(s.minuteIndex) ?? 0) + (s.flow ?? 0),
    )
  }
  const identityBuckets = new Set(
    anomalies.filter((a) => a.kind === 'flow_identity_mismatch').map((a) => a.bucket),
  )
  next = next.map((s) => {
    const bucket = Math.floor(s.minuteIndex / BUCKET_MINUTES)
    const sum = stationSumByMinute.get(s.minuteIndex) ?? 0
    const value = identityBuckets.has(bucket) ? round(sum * 1.25, 2) : round(sum, 2)
    return { ...s, stationTotalFlow: value }
  })

  return next
}

export function buildHistoryFixture(
  fixtureId: string,
  seed: number = FIXED_HISTORY_SEED,
): HistoryFixture {
  const meta = HISTORY_FIXTURES.find((f) => f.id === fixtureId)
  if (!meta) {
    throw new Error(`未知的合成回放夹具：${fixtureId}`)
  }
  const raw = buildRawSamples(HISTORY_MACHINES, seed)
  const samples = applyAnomalies(raw, HISTORY_MACHINES, meta.anomalies)
  return {
    id: meta.id,
    label: meta.label,
    seed,
    synthetic: true,
    readOnly: true,
    note: `${HISTORY_FIXTURE_BANNER}；固定种子 ${seed}；${HISTORY_FIXTURE_MINUTES} 分钟 / ${
      HISTORY_FIXTURE_MINUTES / BUCKET_MINUTES
    } 个 15 分钟桶；只读回放，不产生启停指令。`,
    stepMinutes: 1,
    bucketMinutes: BUCKET_MINUTES,
    minuteCount: HISTORY_FIXTURE_MINUTES,
    bucketCount: BUCKET_COUNT,
    machines: HISTORY_MACHINES,
    anomalies: meta.anomalies,
    samples,
  }
}

export function bucketLabel(bucket: number): string {
  const start = HISTORY_START_MINUTE + bucket * BUCKET_MINUTES
  const end = start + BUCKET_MINUTES
  return `${formatMinuteOfDay(start)}-${formatMinuteOfDay(end)}`
}