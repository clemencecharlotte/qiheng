/** M29 r05 · 宿主真实观察快照（序幕与真实控制台消费同一选定源/时刻）。
 *  复用 App 既有 scheduleClock/historyClock(ObservationClockApi) 与合法既有长序列；
 *  调度/回放分源，不串分母；缺值用 null，不补零、不随机造数。 */
export interface HostPlaybackUnit {
  id: string
  eligible: boolean
  reason: string | null
}

export interface HostPlayback {
  source: 'schedule'
  sourceLabel: string
  stepMinutes: number
  /** 真实序列（合成调度）：与总览/证据同一 run 的 series 与 recommendation。 */
  labels: string[]
  demand: (number | null)[]
  supply: (number | null)[]
  power: (number | null)[]
  /** 逐时段能量 kWh（真实 recommendation.periods.energyKwh；缺值 null）。 */
  energy: (number | null)[]
  unitDemand: string
  unitPower: string
  window: string
  /** 共享观察时钟。 */
  index: number
  playing: boolean
  speed: 0.5 | 1 | 2
  onToggle: () => void
  onSeek: (i: number) => void
  onStep: (d: number) => void
  onSpeed: (s: 0.5 | 1 | 2) => void
  /** M29 r31 · 展示层循环（与真实控制台同一时钟）。 */
  looping: boolean
  onLoopChange: (v: boolean) => void
  /** 真实机组资格（AC-01/02/03）与当前时刻负载。 */
  units: HostPlaybackUnit[]
  /** 绝对负载 m³/min（unitLoads）。 */
  loadsAt: (i: number) => Record<string, number>
  /** 真实负载比（unitLoadRatios，0–1）。 */
  loadRatiosAt: (i: number) => Record<string, number>
}

/**
 * 由绝对流量与额定容量推真实负载比；非有限或额定≤0 → null（未知），**不做 clamp 掩盖超界**。
 * 修复：曾把绝对 m³/min 当比例乘 100 → 1970%。
 */
export function ratioFromLoad(absolute: number | null | undefined, rated: number | null | undefined): number | null {
  if (typeof absolute !== 'number' || !Number.isFinite(absolute)) return null
  if (typeof rated !== 'number' || !Number.isFinite(rated) || rated <= 0) return null
  return absolute / rated
}
export function formatLoadPercent(ratio: number | null | undefined): string {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return '未知'
  return `${(ratio * 100).toFixed(1)}%`
}
