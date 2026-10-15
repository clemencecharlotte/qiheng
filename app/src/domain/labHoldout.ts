import { RULE_VERSION } from './audit'
import { VERIFIER_VERSION } from './constraints'
import {
  LAB_FIXTURES,
  LAB_GENERATOR_VERSION,
  LAB_STATE_BUDGET,
  LAB_STRATEGY_VERSION,
  buildLabComparison,
  type LabFixtureId,
  type LabPlanView,
  type LabPreference,
} from './lab'
import type {
  EvaluationResult,
  InitialUnitState,
  PlanResult,
  SyntheticSeries,
  Unit,
} from './types'

/**
 * 独立留出 manifest（lab-v1 收尾）。
 *
 * 与开发种子 20261002 及旧评测 holdout 分离；使用当前冻结的 lab-fixtures-v1 /
 * lab-bounded-fs-v1，不据留出结果调参。评估只导出事实，不通过断言迫使全部方案成功。
 * 有限同生成器不同种子，非现场泛化、非连续全局最优。
 */

export const LAB_HOLDOUT_SEEDS = [
  104729, 130363, 155921, 196613, 262147, 314159,
] as const

export const LAB_HOLDOUT_FIXTURES: LabFixtureId[] = LAB_FIXTURES.map((f) => f.id)

export const LAB_HOLDOUT_PREFERENCES: LabPreference[] = [
  'energy_first',
  'switch_first',
]

export const LAB_HOLDOUT_MANIFEST = {
  schema: 'qiheng-lab-holdout-v1',
  generatorVersion: LAB_GENERATOR_VERSION,
  strategyVersion: LAB_STRATEGY_VERSION,
  verifierVersion: VERIFIER_VERSION,
  ruleVersion: RULE_VERSION,
  stepMinutes: 15,
  periods: 96,
  stateBudget: LAB_STATE_BUDGET,
  developmentSeed: 20261002,
  seeds: LAB_HOLDOUT_SEEDS,
  fixtures: LAB_HOLDOUT_FIXTURES,
  preferences: LAB_HOLDOUT_PREFERENCES,
  caseCount: LAB_HOLDOUT_FIXTURES.length * LAB_HOLDOUT_SEEDS.length,
  planCount: LAB_HOLDOUT_FIXTURES.length * LAB_HOLDOUT_SEEDS.length * 2,
  note:
    '有限同生成器不同种子（与开发种子 20261002 及旧 holdout 分离）；非现场泛化，也非连续全局最优。失败与 null 原样保留。',
} as const

export const LAB_HOLDOUT_DECLARATIONS = [
  '留出评估使用当前冻结的 lab-fixtures-v1 / lab-bounded-fs-v1；不据留出结果调参。',
  '仅有限同生成器不同种子，不代表现场泛化或连续全局最优；不称售后最优。',
  '失败 case 与 null 指标、原因、复验/指标门结果全部保留，不删除、不改种子、不修方法后再宣称未见。',
  '每方案最多由既有完整独立复验与独立指标核对共同判定；任一失败则比较数值为 null。',
  '本评估仅导出事实，不通过断言迫使 36 个方案全部成功。',
]

export interface HoldoutViewPayload {
  preference: LabPreference
  plan: PlanResult
  verified: boolean
  metricsOk: boolean
  notes: string[]
  declared: {
    totalEnergyKwh: number
    totalSwitches: number
  }
  metrics: {
    energyKwh: number | null
    switches: number | null
    excessSupplyM3: number | null
  }
}

export interface HoldoutCase {
  id: string
  fixtureId: LabFixtureId
  seed: number
  series: SyntheticSeries
  allUnits: Unit[]
  evaluation: EvaluationResult
  initial: InitialUnitState
  faultUnitId: string | null
  comparison: {
    energyFirst: HoldoutViewPayload
    switchFirst: HoldoutViewPayload
    equivalent: boolean
    deltas: {
      energyKwh: number | null
      switches: number | null
      excessSupplyM3: number | null
    }
  }
}

export interface LabHoldoutPayload {
  schema: 'qiheng-lab-holdout-v1'
  generatedAt: string
  manifest: typeof LAB_HOLDOUT_MANIFEST
  declarations: string[]
  localOnly: true
  cases: HoldoutCase[]
}

function viewPayload(view: LabPlanView): HoldoutViewPayload {
  return {
    preference: view.preference,
    plan: view.plan,
    verified: view.verified,
    metricsOk: view.metricsOk,
    notes: view.notes,
    declared: {
      totalEnergyKwh: view.plan.totalEnergyKwh,
      totalSwitches: view.plan.totalSwitches,
    },
    metrics: {
      energyKwh: view.energyKwh,
      switches: view.switches,
      excessSupplyM3: view.excessSupplyM3,
    },
  }
}

export function runLabHoldout(): LabHoldoutPayload {
  const cases: HoldoutCase[] = []
  for (const fixtureId of LAB_HOLDOUT_FIXTURES) {
    for (const seed of LAB_HOLDOUT_SEEDS) {
      const { run, comparison } = buildLabComparison(
        fixtureId,
        'energy_first',
        seed,
      )
      cases.push({
        id: `${fixtureId}-${seed}`,
        fixtureId,
        seed,
        series: run.series,
        allUnits: run.allUnits,
        evaluation: run.evaluation,
        initial: run.initial,
        faultUnitId: run.faultUnitId,
        comparison: {
          energyFirst: viewPayload(comparison.energyFirst),
          switchFirst: viewPayload(comparison.switchFirst),
          equivalent: comparison.equivalent,
          deltas: comparison.deltas,
        },
      })
    }
  }
  return {
    schema: 'qiheng-lab-holdout-v1',
    generatedAt: new Date().toISOString(),
    manifest: LAB_HOLDOUT_MANIFEST,
    declarations: LAB_HOLDOUT_DECLARATIONS,
    localOnly: true,
    cases,
  }
}
