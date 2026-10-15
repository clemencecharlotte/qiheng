import { PERIODS_PER_DAY, STEP_MINUTES } from './demand'
import { RULE_VERSION } from './audit'
import {
  runScenario,
  type InitialUnitState,
  type ScenarioRun,
  type ScenarioRunTimingsMs,
} from './engine'
import { VERIFIER_VERSION, verifyPlanConstraints } from './constraints'
import { UNITS } from './units'
import type { PlanResult, ScenarioId, Unit } from './types'

/**
 * 同条件合成评测。
 *
 * 设计约束（不可更改）：
 * - 只用平台自有合成数据；不接外部包、不照搬任何本地 Python 的机组/策略/参数。
 * - 不重写建议算法或审批；评测只读当天已生成的计划，不改变当前候选/场景/观察/审批。
 * - 旧规则基线（legacy）保留为历史对照，不参与合法配对收益。
 * - 失败例全部保留，是否计入配对分母以独立校验通过为准；不适用指标记 null 并给原因，不填 0。
 */

export const PLAN_VARIANT_LABEL = {
  legacy: '旧规则基线（历史对照）',
  conservative: '保守规则基线',
  recommendation: '优化建议',
} as const

/** 冻结 manifest：先固定种子/版本/初态，再计算任何结果，避免结果导向换种子。 */
export const CONSERVATIVE_STRATEGY_NOTE =
  '保守规则基线：固定机组优先序；已开机尽量保持、只增不减（在最小启停间隔锁定与容量约束下不主动切除在役机组），仅在容量不足时按固定优先序补投；确定性供气。属少切换策略，不追求估算耗电最低。'

export const EVAL_MANIFEST = {
  manifestVersion: 'qiheng-eval-manifest-v2',
  generatorVersion: 'demand-shaper-v1（HOUR_SHAPE + mulberry32，步长 15 分钟，96 时段）',
  paramsVersion: 'units-v1（AC-01 螺杆 20 / AC-02 螺杆 12 / AC-03 离心 40，喘振边界未核实）',
  strategyVersion: `recommendation-${RULE_VERSION}`,
  conservativeStrategyVersion: 'conservative-fixed-priority-hold-v1',
  legacyStrategyVersion: 'legacy-priority-immediate-v1',
  verifierVersion: VERIFIER_VERSION,
  verificationContract:
    '独立复验器读取真实序列、共享初态、候选/安全资格与场景故障；计划不完整或伪造 demand/supply/ratio 一律 fail。',
  ruleVersion: RULE_VERSION,
  stepMinutes: STEP_MINUTES,
  periodsPerDay: PERIODS_PER_DAY,
  initial: {
    runningUnitIds: ['AC-01'],
    minutesSinceChange: { 'AC-01': 5 },
  } satisfies InitialUnitState,
  scenarios: ['normal', 'surge', 'unit_failure'] as ScenarioId[],
  devSeeds: [20261001, 20261002, 20261003],
  holdoutSeeds: [20261011, 20261012, 20261013, 20261014, 20261015, 20261016],
  computeBudget: {
    cases: 27,
    maxPeriodsPerCase: PERIODS_PER_DAY,
    /** 建议求解为固定小规模穷举（候选 ≤3，故掩码枚举 ≤2^3），不随初态放大。 */
    maxCandidateSubsets: 8,
    note: '全部用例同步计算，无外部服务调用；本机合成耗时，不外推为工业 SLA。',
  },
} as const

export const EX_ANTE_POWER_MODEL =
  '估算耗电 = Σ unitPower(机组, 负载) × 步长分钟/60；unitPower 为 unloadPowerRatio×ratedPower + (ratedPower − unloadPowerRatio×ratedPower) × 负载率 的线性插值模型。属模型推算，非现场实测能耗，不得宣称节能率。'

export interface PlanMetrics {
  status: 'planned' | 'not_found'
  /** 完整时段数（失败计划为 null，不填 0）。 */
  periodCount: number | null
  windowPeriodCount: number
  /** 独立复验得到的硬约束违规项数（失败计划为 null）。 */
  violationCount: number | null
  /** 未满足需求桶数（供气 < 需求的时段数）。 */
  unmetDemandBuckets: number | null
  /** 未满足需求体积 = Σ max(0, 需求 − 方案供气) × 步长分钟（m³）。 */
  unmetDemandVolumeM3: number | null
  /** 过量供气体积 = Σ max(0, 方案供气 − 需求) × 步长分钟（m³）。 */
  excessSupplyVolumeM3: number | null
  /** 机组状态翻转次数：每台机组每发生一次开机或停机各计 1（不是“启动次数”）。 */
  switchCount: number | null
  /** 与 switchCount 同口径的显式命名：逐机开/停翻转合计。 */
  unitStateFlips: number | null
  /** 逐机状态翻转明细：机组 → 翻转次数（开、停各计 1）。 */
  perUnitFlips: Record<string, number> | null
  /**
   * 实际运行机组·分钟 = Σ 每时段投运机组数 × 步长分钟。
   * 注意：这是机组运行时长口径，不是求解耗时；求解耗时另见 timingsMs。
   */
  runtimeUnitMinutes: number | null
  energyKwh: number | null
  reasons: string[]
}

const EPS = 1e-6

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * 共享指标函数：同一套口径用于旧基线 / 保守基线 / 建议，避免对某一方用更宽松口径。
 * 失败计划（未找到合法完整计划）全部指标记 null，只保留原因。
 */
export function computePlanMetrics(
  plan: PlanResult,
  run: ScenarioRun,
): PlanMetrics {
  const windowPeriodCount = run.series.points.length
  const verification = plan.feasible
    ? verifyPlanConstraints(plan, run)
    : null

  if (!plan.feasible || plan.periods.length === 0) {
    return {
      status: 'not_found',
      periodCount: null,
      windowPeriodCount,
      violationCount: null,
      unmetDemandBuckets: null,
      unmetDemandVolumeM3: null,
      excessSupplyVolumeM3: null,
      switchCount: null,
      unitStateFlips: null,
      perUnitFlips: null,
      runtimeUnitMinutes: null,
      energyKwh: null,
      reasons: plan.infeasibleReasons.slice(0, 3),
    }
  }

  let unmetBuckets = 0
  let unmetVolume = 0
  let excessVolume = 0
  let runtimeUnitMinutes = 0
  for (const p of plan.periods) {
    const shortage = p.demand - p.supply
    if (shortage > EPS) {
      unmetBuckets += 1
      unmetVolume += shortage * run.series.stepMinutes
    }
    const excess = p.supply - p.demand
    if (excess > EPS) excessVolume += excess * run.series.stepMinutes
    runtimeUnitMinutes += p.runningUnitIds.length * run.series.stepMinutes
  }

  const perUnitFlips: Record<string, number> = {}
  for (const u of run.allUnits) perUnitFlips[u.id] = 0
  let prevRunning = new Set(
    run.initial.runningUnitIds.filter((id) => perUnitFlips[id] !== undefined),
  )
  for (const p of plan.periods) {
    const cur = new Set(p.runningUnitIds)
    for (const u of run.allUnits) {
      const was = prevRunning.has(u.id)
      const is = cur.has(u.id)
      if (was !== is) perUnitFlips[u.id] += 1
    }
    prevRunning = cur
  }
  const unitStateFlips = Object.values(perUnitFlips).reduce((s, v) => s + v, 0)

  return {
    status: 'planned',
    periodCount: plan.periods.length,
    windowPeriodCount,
    violationCount: verification ? verification.violationCount : null,
    unmetDemandBuckets: unmetBuckets,
    unmetDemandVolumeM3: round3(unmetVolume),
    excessSupplyVolumeM3: round3(excessVolume),
    switchCount: plan.totalSwitches,
    unitStateFlips,
    perUnitFlips,
    runtimeUnitMinutes,
    energyKwh: round3(plan.totalEnergyKwh),
    reasons: [],
  }
}

export interface PairResult {
  eligible: boolean
  energyDeltaKwh: number | null
  switchDelta: number | null
  reason: string
}

export interface EvaluationCase {
  id: string
  split: 'dev' | 'holdout'
  scenario: ScenarioId
  scenarioLabel: string
  seed: number
  initial: InitialUnitState
  versions: {
    generator: string
    params: string
    legacyStrategy: string
    conservativeStrategy: string
    strategy: string
    ruleVersion: string
    verifierVersion: string
  }
  /**
   * 本机合成求解耗时（performance.now 差值，毫秒，仅三策略求解）。
   * 易变，只作单次真实读数，不参与确定性相等测试，也不外推为工业 SLA。
   */
  timingsMs: ScenarioRunTimingsMs & { totalMs: number }
  legacyBaseline: { metrics: PlanMetrics; verifiedPass: boolean }
  conservativeBaseline: {
    metrics: PlanMetrics
    verifiedPass: boolean
    executable: boolean
  }
  recommendation: {
    metrics: PlanMetrics
    verifiedPass: boolean
    executable: boolean
  }
  pair: PairResult
}

export interface SplitAggregate {
  split: 'dev' | 'holdout'
  totalCases: number
  pairedCases: number
  conservativePlannedCases: number
  conservativeVerifiedCases: number
  recommendationPlannedCases: number
  recommendationVerifiedCases: number
  meanEnergyDeltaKwh: number | null
  meanSwitchDelta: number | null
  /** 建议相对保守基线的估算耗电差值合计（仅合法配对样本），负值表示建议更低。 */
  totalEnergyDeltaKwh: number | null
}

export interface EvaluationResult {
  manifest: typeof EVAL_MANIFEST
  generatedAt: string
  powerModel: string
  cases: EvaluationCase[]
  aggregates: SplitAggregate[]
  decisionsUnchanged: true
  holdoutApprovable: false
}

function pairFor(
  conservative: { metrics: PlanMetrics; verifiedPass: boolean; executable: boolean },
  recommendation: { metrics: PlanMetrics; verifiedPass: boolean; executable: boolean },
): PairResult {
  if (conservative.metrics.status !== 'planned') {
    return {
      eligible: false,
      energyDeltaKwh: null,
      switchDelta: null,
      reason: '保守规则基线无合法完整计划，配对被排除。',
    }
  }
  if (recommendation.metrics.status !== 'planned') {
    return {
      eligible: false,
      energyDeltaKwh: null,
      switchDelta: null,
      reason: '优化建议无可行计划，配对被排除。',
    }
  }
  if (!conservative.executable) {
    return {
      eligible: false,
      energyDeltaKwh: null,
      switchDelta: null,
      reason: '保守规则基线未通过独立校验，不可执行，配对被排除。',
    }
  }
  if (!recommendation.executable) {
    return {
      eligible: false,
      energyDeltaKwh: null,
      switchDelta: null,
      reason: '优化建议未通过独立校验，不可执行，配对被排除。',
    }
  }
  const energyDelta =
    (recommendation.metrics.energyKwh as number) -
    (conservative.metrics.energyKwh as number)
  const switchDelta =
    (recommendation.metrics.switchCount as number) -
    (conservative.metrics.switchCount as number)
  return {
    eligible: true,
    energyDeltaKwh: round3(energyDelta),
    switchDelta,
    reason: '双方均通过独立硬约束复验，计入合法配对差值。',
  }
}

function aggregate(
  split: 'dev' | 'holdout',
  cases: EvaluationCase[],
): SplitAggregate {
  const paired = cases.filter((c) => c.pair.eligible)
  const energyDeltas = paired
    .map((c) => c.pair.energyDeltaKwh)
    .filter((v): v is number => v !== null)
  const switchDeltas = paired
    .map((c) => c.pair.switchDelta)
    .filter((v): v is number => v !== null)
  const total = energyDeltas.reduce((s, v) => s + v, 0)
  return {
    split,
    totalCases: cases.length,
    pairedCases: paired.length,
    conservativePlannedCases: cases.filter(
      (c) => c.conservativeBaseline.metrics.status === 'planned',
    ).length,
    conservativeVerifiedCases: cases.filter(
      (c) => c.conservativeBaseline.executable,
    ).length,
    recommendationPlannedCases: cases.filter(
      (c) => c.recommendation.metrics.status === 'planned',
    ).length,
    recommendationVerifiedCases: cases.filter(
      (c) => c.recommendation.executable,
    ).length,
    meanEnergyDeltaKwh:
      energyDeltas.length > 0 ? round3(total / energyDeltas.length) : null,
    meanSwitchDelta:
      switchDeltas.length > 0
        ? round3(switchDeltas.reduce((s, v) => s + v, 0) / switchDeltas.length)
        : null,
    totalEnergyDeltaKwh: energyDeltas.length > 0 ? round3(total) : null,
  }
}

function caseId(split: string, scenario: ScenarioId, seed: number): string {
  return `${split}-${scenario}-${seed}`
}

export function runSyntheticEvaluation(units: Unit[] = UNITS): EvaluationResult {
  const { scenarios, devSeeds, holdoutSeeds, initial } = EVAL_MANIFEST
  const cases: EvaluationCase[] = []

  const splits: Array<{ split: 'dev' | 'holdout'; seeds: readonly number[] }> = [
    { split: 'dev', seeds: devSeeds },
    { split: 'holdout', seeds: holdoutSeeds },
  ]

  for (const { split, seeds } of splits) {
    for (const scenario of scenarios) {
      for (const seed of seeds) {
        const run = runScenario(scenario, units, seed, initial)
        const legacyMetrics = computePlanMetrics(run.baseline, run)
        const legacyVerified = verifyPlanConstraints(run.baseline, run).passed
        const conservativeMetrics = computePlanMetrics(run.conservativeBaseline, run)
        const conservativeVerified = verifyPlanConstraints(
          run.conservativeBaseline,
          run,
        ).passed
        const recommendationMetrics = computePlanMetrics(run.recommendation, run)
        const recommendationVerified = verifyPlanConstraints(run.recommendation, run).passed

        const conservative = {
          metrics: conservativeMetrics,
          verifiedPass: conservativeVerified,
          executable:
            conservativeMetrics.status === 'planned' && conservativeVerified,
        }
        const recommendation = {
          metrics: recommendationMetrics,
          verifiedPass: recommendationVerified,
          executable:
            recommendationMetrics.status === 'planned' && recommendationVerified,
        }

        cases.push({
          id: caseId(split, scenario, seed),
          split,
          scenario,
          scenarioLabel: run.series.scenarioLabel,
          seed,
          initial,
          versions: {
            generator: EVAL_MANIFEST.generatorVersion,
            params: EVAL_MANIFEST.paramsVersion,
            legacyStrategy: EVAL_MANIFEST.legacyStrategyVersion,
            conservativeStrategy: EVAL_MANIFEST.conservativeStrategyVersion,
            strategy: EVAL_MANIFEST.strategyVersion,
            ruleVersion: EVAL_MANIFEST.ruleVersion,
            verifierVersion: EVAL_MANIFEST.verifierVersion,
          },
          timingsMs: {
            ...run.timingsMs,
            totalMs: round3(
              run.timingsMs.baselineMs +
                run.timingsMs.conservativeMs +
                run.timingsMs.recommendationMs,
            ),
          },
          legacyBaseline: { metrics: legacyMetrics, verifiedPass: legacyVerified },
          conservativeBaseline: conservative,
          recommendation,
          pair: pairFor(conservative, recommendation),
        })
      }
    }
  }

  return {
    manifest: EVAL_MANIFEST,
    generatedAt: new Date().toISOString(),
    powerModel: EX_ANTE_POWER_MODEL,
    cases,
    aggregates: [
      aggregate('dev', cases.filter((c) => c.split === 'dev')),
      aggregate('holdout', cases.filter((c) => c.split === 'holdout')),
    ],
    decisionsUnchanged: true,
    holdoutApprovable: false,
  }
}

export const EVALUATION_DECLARATIONS = [
  '同条件合成评测：全部用例为平台自有合成数据（固定种子），非现场实测，也不代表主办方或现场泛化。',
  '不发布：评测结果只用于本地演示对比，不改变当前候选/场景/观察状态，不参与审批，不能批准留出集。',
  '样例 kWh 仅为上述功率模型的推算值，不构成节能率或收益承诺；压力合格率与喘振预警率仍未验证。',
  '失败计划（not_found）保留在结果中，其指标为 null 并附原因，不以 0 填充，也不从汇总消失。',
  '旧规则基线为历史对照，不参与合法配对收益；配对差值只在双方均通过独立硬约束复验的样本上计算。',
  `对照基线口径：${CONSERVATIVE_STRATEGY_NOTE}`,
  '状态翻转口径：switchCount/unitStateFlips 为逐机开、停翻转各计 1 的合计，不称“启动次数”；能源降低的同时逐机翻转可能增加，明细见 perUnitFlips。',
  'runtimeUnitMinutes 为 Σ 投运机组数 × 步长分钟的机组·分钟口径，代表机组运行时长，不代表求解耗时。',
  `求解耗时口径：timingsMs.totalMs 为单次本机合成 performance.now 读数（仅三策略求解），易变，不参与确定性相等测试，也不外推为 60 秒级工业 SLA。`,
  `复验合同版本：${VERIFIER_VERSION}（规则版本 ${RULE_VERSION}）；旧规则版本审批不自动升级，须按现行规则重新人工审查。`,
]

export function exportEvaluationJson(result: EvaluationResult): string {
  return JSON.stringify(
    {
      declarations: EVALUATION_DECLARATIONS,
      localOnly: true,
      manifest: result.manifest,
      generatedAt: result.generatedAt,
      powerModel: result.powerModel,
      decisionsUnchanged: result.decisionsUnchanged,
      holdoutApprovable: result.holdoutApprovable,
      aggregates: result.aggregates,
      cases: result.cases,
    },
    null,
    2,
  )
}