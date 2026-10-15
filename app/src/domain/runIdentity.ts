import type { InitialUnitState, Unit, UnitEligibility } from './types'

/**
 * 完整确认身份（强 identity）：显示 / 捕获 / 草稿绑定 / 提交端快照核验共用。
 * 与持久 runRef（存储兼容）分开。两种模式都追加“确定性权威输入签名”：
 * 实际序列（时刻/需求/种子/步长）、完整机组参数与资格/故障、共享初态、
 * 来源/规则与完整计划签名。lab 另保留完整 lab.identity（偏好/夹具/方法）。
 */
export interface RunIdentityParts {
  mode: 'legacy' | 'lab'
  persistentRunRef: string
  scenario: string
  ruleVersion: string
  candidateRef: string
  planSignature: string
  initial: InitialUnitState
  stepMinutes: number
  seed: number
  points: ReadonlyArray<{ minuteOfDay: number; demand: number }>
  units: ReadonlyArray<Unit>
  eligibility: ReadonlyArray<UnitEligibility>
  faultUnitId: string | null
  labIdentity?: string
}

export const RUN_IDENTITY_VERSION = 'run-identity-v2'

/**
 * 精确保留有限 JS 数值的确定性序列化（不四舍五入）：
 * 用 Number.toString 的精确往返表示，避免 0.00001 级差异被舍成同一身份。
 * -0 归一为 '0'；非有限值显式标记。
 */
function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  return Object.is(value, -0) ? '0' : String(value)
}

function initialSignature(initial: InitialUnitState): string {
  return `run=${[...initial.runningUnitIds].sort().join(',')};age=${Object.keys(
    initial.minutesSinceChange,
  )
    .sort()
    .map((k) => `${k}=${initial.minutesSinceChange[k]}`)
    .join(',')}`
}

export function computeRunIdentity(parts: RunIdentityParts): string {
  const points = parts.points
    .map((p) => `${p.minuteOfDay}:${formatNumber(p.demand)}`)
    .join(',')
  const units = parts.units
    .map(
      (u) =>
        `${u.id}:${u.kind}:${formatNumber(u.ratedCapacity)}:${formatNumber(
          u.minLoadRatio,
        )}:${formatNumber(u.ratedPower)}:${formatNumber(
          u.unloadPowerRatio,
        )}:${u.minStartStopInterval}:${u.surgeBoundaryVerified}`,
    )
    .join(';')
  const eligibility = parts.eligibility
    .map((e) => `${e.unitId}:${e.eligible ? 1 : 0}:${e.reason ?? ''}`)
    .join(';')

  return [
    RUN_IDENTITY_VERSION,
    `mode=${parts.mode}`,
    `runRef=${parts.persistentRunRef}`,
    `rule=${parts.ruleVersion}`,
    `scenario=${parts.scenario}`,
    `candidate=${parts.candidateRef}`,
    `fault=${parts.faultUnitId ?? 'none'}`,
    `initial=${initialSignature(parts.initial)}`,
    `step=${parts.stepMinutes}`,
    `seed=${parts.seed}`,
    `points=${points}`,
    `units=${units}`,
    `eligibility=${eligibility}`,
    `plan=${parts.planSignature}`,
    `lab=${parts.labIdentity ?? 'none'}`,
  ].join('|')
}
