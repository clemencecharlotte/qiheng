export type UnitKind = 'screw' | 'centrifugal'

export type ScenarioId = 'normal' | 'surge' | 'unit_failure'

export interface Unit {
  id: string
  name: string
  kind: UnitKind
  ratedCapacity: number
  minLoadRatio: number
  ratedPower: number
  unloadPowerRatio: number
  minStartStopInterval: number
  surgeBoundaryVerified: boolean
}

export interface UnitParamsInput extends Partial<Omit<Unit, 'id' | 'name' | 'kind'>> {
  id: string
  name: string
  kind: UnitKind
}

export interface DemandPoint {
  index: number
  minuteOfDay: number
  label: string
  demand: number
}

export interface SyntheticSeries {
  seed: number
  scenario: ScenarioId
  scenarioLabel: string
  synthetic: true
  stepMinutes: number
  points: DemandPoint[]
  note: string
}

export interface UnitEligibility {
  unitId: string
  eligible: boolean
  missingFields: string[]
  reason: string | null
}

export type ViolationType =
  | 'supply_shortage'
  | 'min_load'
  | 'start_stop_interval'
  | 'missing_params'
  /** 计划未覆盖完整窗口 / 顺序-索引-时刻-需求与来源序列不一致 / 缺桶重复桶。 */
  | 'plan_completeness'
  /** 运行 ID 未知，或同一时段重复出现，或负载表出现未知键。 */
  | 'unknown_unit'
  /** 运行 ID 属于故障机 / 安全排除 / 关键参数缺失等不合资格机组。 */
  | 'ineligible_unit'
  /** 负载非有限值 / 负数 / 超额定 / 停机机组出现正负载 / 运行机组缺负载。 */
  | 'invalid_load'
  /** 独立复算的负载率或供气量与计划声明不一致。 */
  | 'load_mismatch'

/**
 * 共享初始状态：保守基线与建议使用同一初态与已持续分钟，
 * 不允许通过调初态让某一方看起来更好。历史对照基线不读取它。
 */
export interface InitialUnitState {
  runningUnitIds: string[]
  /** 距上次状态变更已持续分钟；缺省视为已稳定（可自由投切）。 */
  minutesSinceChange: Record<string, number>
}

export const DEFAULT_INITIAL_STATE: InitialUnitState = {
  runningUnitIds: [],
  minutesSinceChange: {},
}

export interface ConstraintViolation {
  type: ViolationType
  unitId?: string
  message: string
}

export interface PeriodPlan {
  index: number
  minuteOfDay: number
  label: string
  demand: number
  runningUnitIds: string[]
  unitLoads: Record<string, number>
  unitLoadRatios: Record<string, number>
  supply: number
  margin: number
  powerKw: number
  energyKwh: number
  switches: number
  violations: ConstraintViolation[]
  rationale: string
}

export interface InfeasiblePeriod {
  index: number
  label: string
  demand: number
  availableCapacity: number
  reason: string
}

export type PlanVariant = 'legacy' | 'conservative' | 'recommendation'

export interface PlanResult {
  planType: 'baseline' | 'recommendation'
  /** 计划来源变体：历史对照基线 / 保守规则基线 / 优化建议。 */
  variant?: PlanVariant
  feasible: boolean
  infeasibleReasons: string[]
  infeasiblePeriods: InfeasiblePeriod[]
  periods: PeriodPlan[]
  totalEnergyKwh: number
  totalSwitches: number
  violationCount: number
  exclusionNotes: string[]
}

export interface EvaluationResult {
  candidates: Unit[]
  eligibility: UnitEligibility[]
  excludedNotes: string[]
}

export interface ScenarioSummary {
  id: ScenarioId
  label: string
  description: string
}

export interface ApprovalDecision {
  id: string
  scenario: ScenarioId
  action: 'approve' | 'reject'
  reason: string
  createdAt: string
  synthetic: true
  /** 来源与版本绑定：批准记录只对生成它的来源 / 场景 / 运行 / 候选生效，不迁移到其他场景。 */
  sourceId?: string
  runRef?: string
  candidateRef?: string
  ruleVersion?: string
  planFeasible?: boolean
  /**
   * 完整方案绑定：由建议方案逐时段需求/投运机组/负载生成的确定性签名。
   * 仅凭候选机组 ID 列表不足以代表完整方案。
   */
  planSignature?: string
  /** 与真实审计事件的双向 ID 关联（决策 → 审计）。缺失表示无关联审计，不算有效批准。 */
  auditId?: string | null
  /** ISO 时间，用于稳定排序；createdAt 为本地化展示文本。 */
  createdAtIso?: string
  /** 由旧 v1 存储迁移而来的可见历史；缺少原审计与完整方案上下文，永不作为有效批准。 */
  migrated?: boolean
}

/**
 * 一次人工处置的结果回执（用于原卡保留处置结果、理由与审计 ID）。
 * 被安全审查阻断时 decisionId 为 null，只留下阻断审计 ID。
 */
export interface DecisionOutcome {
  action: 'approve' | 'reject'
  reason: string
  /** 真正写入决策记录的 ID；被阻断时为 null。 */
  decisionId: string | null
  /** 对应审计事件 ID。 */
  auditId: string
  /** 是否写入决策（阻断的批准为 false）。 */
  written: boolean
  /** 被阻断时的人类可读原因。 */
  blockReason?: string
  /** 提交时携带的方案身份快照已过期 / 缺失：未写入、未记审计。 */
  stale?: boolean
}