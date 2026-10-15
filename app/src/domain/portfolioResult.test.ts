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

describe('portfolio-dev-v1 b01 结果导出（16 次尝试全留）', () => {
  it('4 场景 × 4 策略真实求解并写出 qiheng-portfolio-b01-result.json', async () => {
    const cases = []
    for (const meta of PORTFOLIO_FIXTURES) {
      const fixture = buildPortfolioFixture(meta.id)
      const candidates: PortfolioCandidate[] = []
      for (const strategy of PORTFOLIO_STRATEGIES) {
        candidates.push(await runPortfolioCandidate(fixture, strategy))
      }
      const audit = computeParetoAudited(
        candidates[0]?.inputIdentity ?? '',
        candidates,
      )
      cases.push({
        fixtureId: meta.id,
        fixtureMeta: meta,
        fixture: {
          seed: fixture.seed,
          stepMinutes: fixture.stepMinutes,
          points: fixture.points,
          units: fixture.units,
          initial: fixture.initial,
          faultUnitId: fixture.faultUnitId,
        },
        evaluation: fixture.evaluation,
        candidates: candidates.map((c) => ({
          candidateId: c.candidateId,
          canonicalId: c.canonicalId,
          canonicalOk: c.canonicalOk,
          canonicalReason: c.canonicalReason,
          inputIdentity: c.inputIdentity,
          strategy: c.strategy,
          objectiveVersion: c.objectiveVersion,
          domain: c.domain,
          status: c.status,
          verified: c.verified,
          metricsOk: c.metricsOk,
          reasons: c.reasons,
          metrics: c.metrics,
          diagnostics: c.diagnostics,
          plan: c.plan,
        })),
        pareto: { groups: audit.groups, rejected: audit.rejected },
      })
    }
    const payload = {
      schema: 'portfolio-dev-v1-b01',
      canonicalVersion: 'portfolio-candidate-canonical-v1',
      generatedAt: new Date().toISOString(),
      development: true,
      note: 'development 组合比较；非 holdout/预测；16 次尝试（4 场景 × 4 策略）全部保留，失败/timeout/null 不删行。',
      attemptMatrix: {
        fixtures: PORTFOLIO_FIXTURES.map((f) => f.id),
        strategies: PORTFOLIO_STRATEGIES,
        plannedAttempts: PORTFOLIO_FIXTURES.length * PORTFOLIO_STRATEGIES.length,
      },
      cases,
    }
    writeFileSync('qiheng-portfolio-b01-result.json', JSON.stringify(payload, null, 2))
    expect(payload.cases).toHaveLength(4)
    expect(payload.cases.reduce((n, c) => n + c.candidates.length, 0)).toBe(16)
  }, 300000)
})
