import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  PORTFOLIO_FIXTURES,
  PORTFOLIO_STRATEGIES,
  buildPortfolioFixture,
  computeParetoAudited,
  runPortfolioCandidate,
  type PortfolioCandidate,
} from './portfolio'

describe('portfolio-dev-v1 b01b 结果导出（16 次尝试全留，含生成时快照）', () => {
  it('4 场景 × 4 策略真实求解并写出 qiheng-portfolio-b01b-result.json', async () => {
    const cases = []
    for (const meta of PORTFOLIO_FIXTURES) {
      const fixture = buildPortfolioFixture(meta.id)
      const candidates: PortfolioCandidate[] = []
      for (const strategy of PORTFOLIO_STRATEGIES) {
        candidates.push(await runPortfolioCandidate(fixture, strategy, 1))
      }
      const audit = computeParetoAudited(candidates[0]?.inputIdentity ?? '', candidates)
      cases.push({
        fixtureId: meta.id,
        fixtureMeta: meta,
        // 生成时输入快照（权威），不从当前 fixture 重构
        inputSnapshot: candidates[0]?.inputSnapshot ?? null,
        // 样例完整检验内容（与快照一致，供审阅）
        inputCheck: {
          seed: fixture.seed,
          stepMinutes: fixture.stepMinutes,
          points: fixture.points,
          units: fixture.units,
          initial: fixture.initial,
          faultUnitId: fixture.faultUnitId,
        },
        evaluation: fixture.evaluation,
        candidates,
        pareto: { groups: audit.groups, rejected: audit.rejected },
      })
    }
    const payload = {
      schema: 'portfolio-dev-v1-b01b',
      canonicalVersion: 'portfolio-candidate-canonical-v1',
      generatedAt: new Date().toISOString(),
      development: true,
      note: 'development 组合比较；非 holdout/预测；16 次尝试（4 场景 × 4 策略）全部保留；失败/timeout/null 不删行；每条候选携带生成时输入快照。',
      attemptMatrix: {
        fixtures: PORTFOLIO_FIXTURES.map((f) => f.id),
        strategies: PORTFOLIO_STRATEGIES,
        plannedAttempts: PORTFOLIO_FIXTURES.length * PORTFOLIO_STRATEGIES.length,
      },
      cases,
    }
    writeFileSync('qiheng-portfolio-b01b-result.json', JSON.stringify(payload, null, 2))
    expect(payload.cases).toHaveLength(4)
    expect(payload.cases.reduce((n, c) => n + c.candidates.length, 0)).toBe(16)
  }, 300000)
})
