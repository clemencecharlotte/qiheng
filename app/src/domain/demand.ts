import type { DemandPoint, ScenarioId, ScenarioSummary, SyntheticSeries } from './types'

export const STEP_MINUTES = 15
export const PERIODS_PER_DAY = (24 * 60) / STEP_MINUTES

const HOUR_SHAPE = [
  0.35, 0.3, 0.28, 0.27, 0.28, 0.32, 0.45, 0.65, 0.85, 0.95, 1.0, 0.98, 0.8, 0.85,
  0.95, 1.0, 0.98, 0.9, 0.75, 0.62, 0.52, 0.45, 0.4, 0.36,
]

export const BASE_DEMAND = 24
export const SURGE_WINDOW_START_HOUR = 8
export const SURGE_WINDOW_END_HOUR = 16
export const SURGE_MULTIPLIER = 1.6

export const SCENARIOS: ScenarioSummary[] = [
  {
    id: 'normal',
    label: '常态',
    description: '三台机组配置、日负荷曲线常规波动，自动调度候选仅两台螺杆机。',
  },
  {
    id: 'surge',
    label: '需求突增',
    description:
      '08:00–17:00（结束不含 17:00，即覆盖 08:00 至 16:45 的时段）用气需求抬升至基准的 1.6 倍，超过安全可用容量。',
  },
  {
    id: 'unit_failure',
    label: '单机故障',
    description: '1# 螺杆机故障退出（合成场景），可用安全容量下降。',
  },
]

export const SCENARIO_FAULT_UNIT: Record<ScenarioId, string | null> = {
  normal: null,
  surge: null,
  unit_failure: 'AC-01',
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function formatMinuteOfDay(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60)
  const m = minuteOfDay % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function buildSeries(scenario: ScenarioId, seed: number): SyntheticSeries {
  const rng = mulberry32(seed + scenario.length * 7919)
  const points: DemandPoint[] = []
  for (let i = 0; i < PERIODS_PER_DAY; i += 1) {
    const minuteOfDay = i * STEP_MINUTES
    const hour = Math.floor(minuteOfDay / 60)
    const noise = (rng() * 2 - 1) * 1.8
    let demand = BASE_DEMAND * HOUR_SHAPE[hour] + noise
    if (
      scenario === 'surge' &&
      hour >= SURGE_WINDOW_START_HOUR &&
      hour <= SURGE_WINDOW_END_HOUR
    ) {
      demand *= SURGE_MULTIPLIER
    }
    demand = Math.max(0, round1(demand))
    points.push({
      index: i,
      minuteOfDay,
      label: formatMinuteOfDay(minuteOfDay),
      demand,
    })
  }
  const meta = SCENARIOS.find((s) => s.id === scenario)
  return {
    seed,
    scenario,
    scenarioLabel: meta ? meta.label : scenario,
    synthetic: true,
    stepMinutes: STEP_MINUTES,
    points,
    note: `合成演示：固定种子 ${seed}，${STEP_MINUTES} 分钟步长，共 ${PERIODS_PER_DAY} 个时段；非生产实测数据。`,
  }
}