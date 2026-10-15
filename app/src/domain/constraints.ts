import { RULE_VERSION } from './audit'
import type {
  EvaluationResult,
  InitialUnitState,
  PlanResult,
  SyntheticSeries,
  Unit,
  ViolationType,
} from './types'

const EPS = 1e-6
/** 计划供气量/负载率按两位小数落盘，独立复算容差需覆盖该舍入。 */
const DECLARED_EPS = 0.02

/** 独立复验合同版本：改合同必须同步 RULE_VERSION 并保留旧审批审计。 */
export const VERIFIER_VERSION = 'independent-verify-window-fault-v1'

/**
 * 只读复验上下文：独立硬约束复验所需的全部外部事实。
 * 不由计划字段自证：需求取真实序列，初态取共享初态，资格取候选/安全排除，
 * 故障取场景故障机。ScenarioRun 结构性满足该上下文，可直接传入。
 */
export interface VerifyContext {
  series: SyntheticSeries
  allUnits: Unit[]
  evaluation: EvaluationResult
  initial: InitialUnitState
  faultUnitId: string | null
}

export interface ConstraintViolationDetail {
  periodIndex: number
  periodLabel: string
  type: ViolationType
  unitId?: string
  message: string
}

export interface ConstraintVerification {
  /** 是否存在覆盖完整窗口且一一对应的方案（独立于 plan.feasible 声明）。 */
  hasSolution: boolean
  /** 独立复验：完整且通过全部可复算硬约束。 */
  passed: boolean
  /** 独立复算得到的违规项数（不等于覆盖时段数）。 */
  violationCount: number
  byType: Record<ViolationType, number>
  violations: ConstraintViolationDetail[]
  /** 计划是否完整、顺序/index/minute/需求与真实序列一致。 */
  complete: boolean
  /** 本次复验合同版本。 */
  verifierVersion: string
  ruleVersion: string
}

function emptyByType(): Record<ViolationType, number> {
  return {
    supply_shortage: 0,
    min_load: 0,
    start_stop_interval: 0,
    missing_params: 0,
    plan_completeness: 0,
    unknown_unit: 0,
    ineligible_unit: 0,
    invalid_load: 0,
    load_mismatch: 0,
  }
}

function push(
  byType: Record<ViolationType, number>,
  violations: ConstraintViolationDetail[],
  entry: ConstraintViolationDetail,
): void {
  byType[entry.type] += 1
  violations.push(entry)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 独立复验一个方案是否满足硬约束，不依赖 plan.feasible 标记、覆盖时段数、
 * 也不相信计划自带的 demand/supply/ratio 声明。
 *
 * 逐时段独立重算：
 * 1. 完整性：plan.periods 对 series.points 完整、一一对应，index/minute/需求一致；
 *    缺桶/重复桶/重排/错需求/非有限值均 fail。
 * 2. 初态：由共享 initial 初始化 prev/lastChange（首时刻减已持续分钟），
 *    t=0 早停/早启可被独立检出。
 * 3. 负载：由 unitLoads 重算有限/非负/不超额定/运行不低于最小负载/停机无正负载，
 *    并核 ratio=load/capacity、supply=Σloads，再对真实需求检查。
 * 4. 资格：未知/重复/故障/不合资格运行 ID 与未知负载键均违规。
 */
export function verifyPlanConstraints(
  plan: PlanResult,
  context: VerifyContext,
): ConstraintVerification {
  const byType = emptyByType()
  const violations: ConstraintViolationDetail[] = []
  const unitById = new Map(context.allUnits.map((u) => [u.id, u]))
  const eligibilityById = new Map(
    context.evaluation.eligibility.map((e) => [e.unitId, e]),
  )
  const candidateIds = new Set(context.evaluation.candidates.map((u) => u.id))
  const points = context.series.points

  const base = {
    violationCount: 0,
    byType,
    violations,
    verifierVersion: VERIFIER_VERSION,
    ruleVersion: RULE_VERSION,
  }

  if (!plan.feasible || plan.periods.length === 0) {
    return { hasSolution: false, passed: false, complete: false, ...base }
  }

  // ---- 1. 完整性：顺序一一对应，index/minute/label/需求与真实序列一致 ----
  let complete = true
  const seenIndex = new Set<number>()
  const periodByIndex = new Map<number, PlanResult['periods'][number]>()

  for (let pos = 0; pos < plan.periods.length; pos += 1) {
    const p = plan.periods[pos]
    if (seenIndex.has(p.index)) {
      complete = false
      push(byType, violations, {
        periodIndex: p.index,
        periodLabel: p.label,
        type: 'plan_completeness',
        message: `时段 index ${p.index} 在计划中重复出现，计划与来源序列不再一一对应。`,
      })
      continue
    }
    seenIndex.add(p.index)
    periodByIndex.set(p.index, p)

    const expected = points[pos]
    if (
      !expected ||
      p.index !== expected.index ||
      p.minuteOfDay !== expected.minuteOfDay ||
      p.label !== expected.label
    ) {
      complete = false
      push(byType, violations, {
        periodIndex: p.index,
        periodLabel: p.label,
        type: 'plan_completeness',
        message: expected
          ? `时段顺序/索引/时刻与来源不一致：计划为 index ${p.index} @ ${p.minuteOfDay}min，来源第 ${pos} 桶为 index ${expected.index} @ ${expected.minuteOfDay}min。`
          : `计划在来源序列之外多出时段 index ${p.index}，覆盖超出真实窗口。`,
      })
    } else if (!finite(p.demand) || Math.abs(p.demand - expected.demand) > EPS) {
      complete = false
      push(byType, violations, {
        periodIndex: p.index,
        periodLabel: p.label,
        type: 'plan_completeness',
        message: `时段 ${p.label} 计划需求 ${p.demand} 与来源真实需求 ${expected.demand} 不一致。`,
      })
    }
  }

  if (plan.periods.length !== points.length) {
    complete = false
    push(byType, violations, {
      periodIndex: plan.periods[0]?.index ?? 0,
      periodLabel: plan.periods[0]?.label ?? '—',
      type: 'plan_completeness',
      message: `计划覆盖 ${plan.periods.length} 个时段，来源窗口为 ${points.length} 个时段：缺桶或多余桶，覆盖时段数不代表完整。`,
    })
  }

  // ---- 2. 初态：首时刻减已持续分钟 ----
  const firstMinute = points.length > 0 ? points[0].minuteOfDay : 0
  const lastChange = new Map<string, number>()
  for (const u of context.allUnits) {
    const elapsed = context.initial.minutesSinceChange[u.id]
    lastChange.set(
      u.id,
      elapsed === undefined ? Number.NEGATIVE_INFINITY : firstMinute - elapsed,
    )
  }
  let prev = new Set(
    context.initial.runningUnitIds.filter((id) => unitById.has(id)),
  )

  // ---- 3/4. 逐时段独立重算（按真实序列顺序，用 plan index 取回时段） ----
  for (const point of points) {
    const p = periodByIndex.get(point.index)
    if (!p) continue // 缺失桶已在完整性中标记
    const demand = point.demand // 真实需求，不采信 p.demand

    const cur = new Set<string>()
    const declaredOnce = new Set<string>()
    for (const id of p.runningUnitIds) {
      if (declaredOnce.has(id)) {
        push(byType, violations, {
          periodIndex: p.index,
          periodLabel: p.label,
          type: 'unknown_unit',
          unitId: id,
          message: `${p.label} 运行 ID ${id} 重复出现，拒绝重复运行 ID。`,
        })
        continue
      }
      declaredOnce.add(id)
      const unit = unitById.get(id)
      if (!unit) {
        push(byType, violations, {
          periodIndex: p.index,
          periodLabel: p.label,
          type: 'unknown_unit',
          unitId: id,
          message: `${p.label} 运行 ID ${id} 不在机组档案中，未知机组不得投运。`,
        })
        continue
      }
      const eligible = eligibilityById.get(id)
      if (!eligible?.eligible || !candidateIds.has(id)) {
        push(byType, violations, {
          periodIndex: p.index,
          periodLabel: p.label,
          type: 'ineligible_unit',
          unitId: id,
          message: `${unit.name} 不在自动调度候选内（${
            eligible?.reason ?? (context.faultUnitId === id ? '单机故障' : '安全排除或关键参数缺失')
          }），不得作为运行机组。`,
        })
      }
      cur.add(id)
    }

    const loadById = p.unitLoads ?? {}
    for (const key of Object.keys(loadById)) {
      if (!unitById.has(key)) {
        push(byType, violations, {
          periodIndex: p.index,
          periodLabel: p.label,
          type: 'unknown_unit',
          unitId: key,
          message: `${p.label} 负载表出现未知机组键 ${key}。`,
        })
      }
    }

    let supply = 0
    for (const id of cur) {
      const unit = unitById.get(id) as Unit
      const load = loadById[id]
      if (!finite(load) || load < -EPS || load > unit.ratedCapacity + DECLARED_EPS) {
        push(byType, violations, {
          periodIndex: p.index,
          periodLabel: p.label,
          type: 'invalid_load',
          unitId: id,
          message: `${unit.name} 在 ${p.label} 的负载 ${
            finite(load) ? load.toFixed(2) : String(load)
          } m³/min 非有限值 / 为负 / 超出额定 ${unit.ratedCapacity} m³/min。`,
        })
        continue
      }
      supply += load
      const ratio = load / unit.ratedCapacity
      if (ratio + EPS < unit.minLoadRatio) {
        push(byType, violations, {
          periodIndex: p.index,
          periodLabel: p.label,
          type: 'min_load',
          unitId: id,
          message: `${unit.name} 负载率 ${(ratio * 100).toFixed(1)}% 低于最小稳定负载 ${(
            unit.minLoadRatio * 100
          ).toFixed(0)}%`,
        })
      }
      const declaredRatio = p.unitLoadRatios?.[id]
      if (
        !finite(declaredRatio) ||
        Math.abs(declaredRatio - ratio) > DECLARED_EPS
      ) {
        push(byType, violations, {
          periodIndex: p.index,
          periodLabel: p.label,
          type: 'load_mismatch',
          unitId: id,
          message: `${unit.name} 在 ${p.label} 声明负载率 ${
            finite(declaredRatio) ? declaredRatio.toFixed(4) : String(declaredRatio)
          } 与独立复算 ${ratio.toFixed(4)}（负载/额定）不一致。`,
        })
      }
    }

    for (const unit of context.allUnits) {
      if (cur.has(unit.id)) continue
      const load = loadById[unit.id]
      if (finite(load) && load > EPS) {
        push(byType, violations, {
          periodIndex: p.index,
          periodLabel: p.label,
          type: 'invalid_load',
          unitId: unit.id,
          message: `${unit.name} 在 ${p.label} 未投运却出现正负载 ${load.toFixed(
            2,
          )} m³/min。`,
        })
      }
    }

    const capacity = context.allUnits.reduce(
      (s, u) => (cur.has(u.id) ? s + u.ratedCapacity : s),
      0,
    )
    if (capacity + EPS < demand) {
      push(byType, violations, {
        periodIndex: p.index,
        periodLabel: p.label,
        type: 'supply_shortage',
        message: `需求 ${demand.toFixed(1)} 超出投运机组额定供气能力 ${capacity.toFixed(1)} m³/min`,
      })
    } else if (supply + DECLARED_EPS < demand) {
      push(byType, violations, {
        periodIndex: p.index,
        periodLabel: p.label,
        type: 'supply_shortage',
        message: `独立复算供气 ${supply.toFixed(1)} 低于真实需求 ${demand.toFixed(1)} m³/min`,
      })
    }

    if (!finite(p.supply) || Math.abs(p.supply - supply) > DECLARED_EPS) {
      push(byType, violations, {
        periodIndex: p.index,
        periodLabel: p.label,
        type: 'load_mismatch',
        message: `时段 ${p.label} 声明供气 ${
          finite(p.supply) ? p.supply.toFixed(2) : String(p.supply)
        } 与独立复算 Σloads ${supply.toFixed(2)} 不一致。`,
      })
    }

    for (const unit of context.allUnits) {
      const was = prev.has(unit.id)
      const is = cur.has(unit.id)
      if (was !== is) {
        const last = lastChange.get(unit.id) as number
        if (point.minuteOfDay - last < unit.minStartStopInterval) {
          push(byType, violations, {
            periodIndex: p.index,
            periodLabel: p.label,
            type: 'start_stop_interval',
            unitId: unit.id,
            message: `${unit.name} 在 ${p.label} ${
              is ? '启动' : '停机'
            }，距上次状态变更不足最小启停间隔 ${unit.minStartStopInterval} 分钟`,
          })
        }
        lastChange.set(unit.id, point.minuteOfDay)
      }
    }

    prev = cur
  }

  const violationCount = violations.length
  return {
    hasSolution: complete,
    passed: complete && violationCount === 0,
    violationCount,
    byType,
    violations,
    complete,
    verifierVersion: VERIFIER_VERSION,
    ruleVersion: RULE_VERSION,
  }
}