import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { evaluateUnits } from '../engine'
import { UNITS } from '../units'
import {
  buildFlowMilpDevFixture,
  solveFlowMilp,
  FLOW_MILP_MODEL_VERSION,
  FLOW_MILP_OBJECTIVE_VERSION,
  type FlowMilpInput,
} from './flowMilp'

/** 一次性真实求解并导出完整事实到根文件，供外部 oracle 独立核对。 */
describe('flow-milp 结果导出', () => {
  it('真实求解 4 桶并写出 qiheng-highs-poc-v1-result.json', async () => {
    const fixture = buildFlowMilpDevFixture()
    const evaluation = evaluateUnits(UNITS, 'normal')
    const input: FlowMilpInput = {
      fixtureId: fixture.fixtureId,
      seed: fixture.seed,
      points: fixture.points,
      stepMinutes: fixture.stepMinutes,
      units: UNITS,
      candidates: evaluation.candidates,
      eligibility: evaluation.eligibility,
      initial: fixture.initial,
      faultUnitId: null,
      timeLimitSeconds: 5,
    }
    const result = await solveFlowMilp(input)

    // 初态解锁反例：480 锁定不能启动，495 已解锁可解
    const unlockedInput: FlowMilpInput = {
      ...input,
      fixtureId: 'flow-milp-initial-unlock-2bucket',
      points: [
        { index: 0, minuteOfDay: 480, label: '08:00', demand: 0 },
        { index: 1, minuteOfDay: 495, label: '08:15', demand: 5 },
      ],
      initial: {
        runningUnitIds: [],
        minutesSinceChange: { 'AC-01': 5, 'AC-02': 0, 'AC-03': 0 },
      },
    }
    const unlockedResult = await solveFlowMilp(unlockedInput)

    // 固定项反例：AC-03 初始已开 age30（被排除），t0 强制停机，目标 +1.5
    const fixedStopInput: FlowMilpInput = {
      ...input,
      fixtureId: 'flow-milp-fixed-stop-ac03-on',
      initial: {
        runningUnitIds: ['AC-01', 'AC-03'],
        minutesSinceChange: { 'AC-01': 30, 'AC-02': 30, 'AC-03': 30 },
      },
    }
    const fixedStopResult = await solveFlowMilp(fixedStopInput)

    const payload = {
      schema: 'qiheng-highs-poc-v1c',
      generatedAt: new Date().toISOString(),
      upstream: {
        kernel: 'HiGHS 1.15.1 (via highs-js)',
        wrapper: 'highs@1.15.3 (MIT)',
        commit: '96981da1d88bbf657d81f7f3027377ba6a7e81bf',
      },
      modelVersion: FLOW_MILP_MODEL_VERSION,
      objectiveVersion: FLOW_MILP_OBJECTIVE_VERSION,
      cases: {
        normal: { fixtureId: input.fixtureId, input, result },
        initialUnlock: { fixtureId: unlockedInput.fixtureId, input: unlockedInput, result: unlockedResult },
        fixedStop: { fixtureId: fixedStopInput.fixtureId, input: fixedStopInput, result: fixedStopResult },
      },
    }
    writeFileSync('qiheng-highs-poc-v1c-result.json', JSON.stringify(payload, null, 2))
    expect(result.reasons.join(' ')).not.toContain('加载失败')
    expect(payload.cases.normal.input.points).toHaveLength(4)
    expect(unlockedResult.plan).not.toBeNull()
    expect(fixedStopResult.plan).not.toBeNull()
  }, 30000)
})
