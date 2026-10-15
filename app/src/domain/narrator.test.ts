import { describe, expect, it } from 'vitest'
import {
  detectNarratorConfig,
  extractEvidenceTokens,
  narrateAnswer,
  validateNarration,
  type NarratorTransport,
} from './narrator'
import { askQuestion } from './qa'
import { runHistoryChain, runScheduleChain } from './chain'
import { runScenario } from './engine'
import { assessHealth } from './health'
import { aggregateQuality } from './quality'
import { buildHistoryFixture } from './history'
import { SCENARIOS } from './demand'
import { FIXED_SEED, UNITS } from './units'
import type { EvidenceContext } from './evidence'
import type { QaAnswer } from './qa'

function baseAnswer(): QaAnswer {
  const scenario = 'normal' as const
  const scenarioLabel = SCENARIOS[0].label
  const run = runScenario(scenario, UNITS, FIXED_SEED)
  const fixture = buildHistoryFixture('fx_clean')
  const quality = aggregateQuality(fixture)
  const health = assessHealth(fixture)
  const scheduleChain = runScheduleChain({ scenario, scenarioLabel, run })
  const historyReview = runHistoryChain({ fixture, quality, health })
  const ctx: EvidenceContext = {
    run,
    normalRun: run,
    quality,
    health,
    scheduleChain,
    historyReview,
    fixture,
    scenarioLabel,
  }
  return askQuestion(ctx, '第 40 时段的异常依据和数据质量如何？', { scenarioLabel })
}

const enabledConfig = {
  status: 'enabled' as const,
  endpoint: '/api/narrate',
  reason: 'ok',
}

function transportReturning(text: string): NarratorTransport {
  return { complete: async () => text }
}

describe('模型通道配置探测', () => {
  it('无服务端代理时禁用并说明原因', () => {
    const config = detectNarratorConfig({})
    expect(config.status).toBe('disabled')
    expect(config.reason).toContain('确定性规则解释')
  })

  it('服务端代理 + 服务端机密存储才启用', () => {
    const config = detectNarratorConfig({
      endpoint: '/api/narrate',
      serverSecretStored: true,
    })
    expect(config.status).toBe('enabled')
    expect(config.endpoint).toBe('/api/narrate')
  })
})

describe('模型输出校验', () => {
  it('抽取证据 token', () => {
    expect(extractEvidenceTokens('见 period:40 与 quality:C-01:6')).toEqual([
      'period:40',
      'quality:C-01:6',
    ])
  })

  it('拒绝无效证据引用', () => {
    const result = validateNarration('依据 quality:不存在:9 判断', ['period:40'], true)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('无效证据引用')
  })

  it('拒绝把被拒建议改写成可批准', () => {
    const result = validateNarration('该建议可以批准。', [], false)
    expect(result.ok).toBe(false)
  })

  it('拒绝空输出', () => {
    expect(validateNarration('   ', [], true).ok).toBe(false)
  })

  it('允许引用合法证据的解释', () => {
    expect(validateNarration('见 period:40 的约束通过。', ['period:40'], true).ok).toBe(true)
  })
})

describe('问答降级与模型润色', () => {
  const answer = baseAnswer()

  it('通道未启用时回退为规则解释', async () => {
    const result = await narrateAnswer(answer, {
      question: 'q',
      config: detectNarratorConfig({}),
      transport: null,
      safetyAllowsApproval: true,
    })
    expect(result.narrationMode).toBe('rule')
    expect(result.fallbackReason).toContain('确定性规则解释')
    expect(result.conclusion).toBe(answer.conclusion)
  })

  it('模型返回合法解释时标注为模型润色且不改结论', async () => {
    const allowed = answer.evidence.map((e) => e.id)
    const result = await narrateAnswer(answer, {
      question: 'q',
      config: enabledConfig,
      transport: transportReturning(`参考 ${allowed[0]} 的解释。`),
      safetyAllowsApproval: true,
    })
    expect(result.narrationMode).toBe('model')
    expect(result.narrationNote).toContain(allowed[0])
    expect(result.conclusion).toBe(answer.conclusion)
  })

  it('模型编造证据时回退为规则解释', async () => {
    const result = await narrateAnswer(answer, {
      question: 'q',
      config: enabledConfig,
      transport: transportReturning('依据 quality:伪造:1 的结论。'),
      safetyAllowsApproval: true,
    })
    expect(result.narrationMode).toBe('rule')
    expect(result.fallbackReason).toContain('无效证据引用')
  })

  it('模型调用失败时回退为规则解释', async () => {
    const failing: NarratorTransport = {
      complete: async () => {
        throw new Error('网络不可用')
      },
    }
    const result = await narrateAnswer(answer, {
      question: 'q',
      config: enabledConfig,
      transport: failing,
      safetyAllowsApproval: true,
    })
    expect(result.narrationMode).toBe('rule')
    expect(result.fallbackReason).toContain('网络不可用')
  })

  it('模型试图改写被拒建议时回退', async () => {
    const result = await narrateAnswer(answer, {
      question: 'q',
      config: enabledConfig,
      transport: transportReturning('该建议可以批准。'),
      safetyAllowsApproval: false,
    })
    expect(result.narrationMode).toBe('rule')
  })
})