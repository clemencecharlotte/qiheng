import { useEffect, useRef, useState } from 'react'
import {
  PORTFOLIO_FIXTURES,
  PORTFOLIO_STRATEGIES,
  buildPortfolioFixture,
  canSelectCandidate,
  canonicalPortfolioInput,
  capturePortfolioSnapshot,
  computeParetoAudited,
  createGenerationGate,
  isLegalCandidate,
  portfolioMilpCandidate,
  retireBatch,
  runPortfolioCandidate,
  shortHash,
  snapshotToFixture,
  type FeasibleDomain,
  type ParetoAudit,
  type PortfolioCandidate,
  type PortfolioFixtureId,
  type PortfolioHistoryEntry,
  type PortfolioStrategy,
} from '../domain/portfolio'
import { FlowMilpController, type FlowMilpRunOutcome } from '../optimizer/flowMilpController'
import type { FlowMilpResult } from '../domain/optimizer/flowMilp'
import PassportPanel from './PassportPanel'
import {
  makeUnfinishedAttempt,
  newPassportId,
  savePassport,
  sealPortfolioPassport,
  type DecisionPassport,
} from '../domain/passport'
import type { PortfolioInputSnapshot } from '../domain/portfolio'

const DOMAIN_LABEL: Record<FeasibleDomain, string> = {
  'flow-milp': '连续流量 MILP',
  'dp-lookahead': 'DP 前瞻',
  'conservative-rule': '保守规则',
}

function downloadJson(name: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

type OpenExecution = (target: { passportId: string; candidateId: string; triggerId: string }) => void

interface Props {
  contextKey?: string
  onOpenExecution?: OpenExecution
}

export default function PortfolioCompare({ contextKey = 'default', onOpenExecution }: Props) {
  const controllerRef = useRef<FlowMilpController | null>(null)
  const gateRef = useRef(createGenerationGate())
  const resultsRef = useRef(new Map<PortfolioStrategy, PortfolioCandidate>())
  const [fixtureId, setFixtureId] = useState<PortfolioFixtureId>('p_capacity_rise')
  const [status, setStatus] = useState<'idle' | 'loading' | 'solving' | 'done' | 'canceled' | 'failed'>('idle')
  const [candidates, setCandidates] = useState<PortfolioCandidate[]>([])
  const [audit, setAudit] = useState<ParetoAudit | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [inputIdentity, setInputIdentity] = useState<string>('')
  const [batchId, setBatchId] = useState<number>(-1)
  const [error, setError] = useState<string | null>(null)
  const [selectError, setSelectError] = useState<string | null>(null)
  const [history, setHistory] = useState<PortfolioHistoryEntry[]>([])
  const [passport, setPassport] = useState<DecisionPassport | null>(null)
  const [persistFeedback, setPersistFeedback] = useState<string | null>(null)
  interface Draft {
    passportId: string
    startedAt: string
    inputSnapshot: PortfolioInputSnapshot
    inputCanonical: string
    epoch: number
    label: string
  }
  const draftRef = useRef<Draft | null>(null)
  const sealedRef = useRef(false)

  /** 4 策略全部成行：已完成的用真实结果，未完成的明确 not_run。 */
  const buildAttempts = (): PortfolioCandidate[] => {
    const draft = draftRef.current
    if (!draft) return []
    return PORTFOLIO_STRATEGIES.map(
      (s) => resultsRef.current.get(s) ?? makeUnfinishedAttempt(draft, s),
    )
  }

  /** 由 captured draft 封存一次（同步，供卸载用；不触发 setState）。 */
  const sealDraftSync = (lifeStatus: 'complete' | 'canceled' | 'failed') => {
    const draft = draftRef.current
    if (!draft || sealedRef.current) return null
    const attempts = buildAttempts()
    if (!attempts.length) return null
    const sealed = sealPortfolioPassport({
      epoch: draft.epoch,
      inputSnapshot: draft.inputSnapshot,
      inputCanonical: draft.inputCanonical,
      attempts,
      status: lifeStatus,
      startedAt: draft.startedAt,
      scenarioId: draft.inputSnapshot.id,
      scenarioLabel: draft.label,
      passportId: draft.passportId,
    })
    if (!sealed.ok || !sealed.passport) return { error: sealed.reason ?? '未知原因' }
    const saved = savePassport(sealed.passport)
    sealedRef.current = true
    return { passport: sealed.passport, saved }
  }

  const finalizeDraft = (lifeStatus: 'complete' | 'canceled' | 'failed') => {
    const r = sealDraftSync(lifeStatus)
    if (!r) return
    if ('error' in r) {
      setPersistFeedback(`封存被拒绝：${r.error}`)
      return
    }
    setPassport(r.passport)
    setPersistFeedback(
      r.saved.ok
        ? `封存成功（${r.saved.bytes} 字节）`
        : r.saved.overCapacity
          ? `未持久化：${r.saved.error}`
          : `未持久化：${r.saved.error ?? '写入失败'}`,
    )
  }

  // 取消/换输入/离页：当前活动结果退休为只读历史，清空活动卡/Pareto/选择。
  const retireActive = (reason: string) => {
    if (candidates.length) {
      setHistory((prev) => [...retireBatch(candidates, batchId, reason), ...prev].slice(0, 40))
    }
    setCandidates([])
    setAudit(null)
    setSelected(null)
    setBatchId(-1)
    setSelectError(null)
  }

  const reset = () => {
    // 换输入/离页前先封存旧 draft（未封存且有进度），再失效代次。
    finalizeDraft('canceled')
    gateRef.current.retire()
    resultsRef.current = new Map()
    draftRef.current = null
    sealedRef.current = false
    retireActive('reset')
    setInputIdentity('')
    setError(null)
    setStatus('idle')
  }

  useEffect(
    () => () => {
      // 卸载先封旧 draft 再使代次失效；迟到回执因代次不符不能重封。
      if (!sealedRef.current) sealDraftSync('canceled')
      gateRef.current.retire()
      controllerRef.current?.cancel()
    },
    [],
  )
  useEffect(() => {
    controllerRef.current?.cancel()
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureId, contextKey])

  const generate = () => {
    controllerRef.current?.cancel()
    // 旧 draft 未封存则先封存，再开新轮（新 passportId）。
    if (!sealedRef.current) finalizeDraft('canceled')
    gateRef.current.retire()
    resultsRef.current = new Map()
    sealedRef.current = false
    retireActive('superseded')
    setError(null)
    setStatus('loading')

    const epoch = gateRef.current.retire()
    const fixture = buildPortfolioFixture(fixtureId)
    const snapshot = capturePortfolioSnapshot(fixture)
    const snap = snapshotToFixture(snapshot)
    const inputId = canonicalPortfolioInput(snap).id
    if (!inputId) {
      setError('输入身份无效，已中止生成')
      setStatus('failed')
      return
    }
    const label = PORTFOLIO_FIXTURES.find((f) => f.id === fixtureId)?.label ?? fixtureId
    setInputIdentity(inputId)
    setBatchId(epoch)
    draftRef.current = {
      passportId: newPassportId(),
      startedAt: new Date().toISOString(),
      inputSnapshot: snapshot,
      inputCanonical: inputId,
      epoch,
      label,
    }
    setPassport(null)
    setPersistFeedback(null)

    const settle = (c: PortfolioCandidate) => {
      if (!gateRef.current.isCurrent(epoch) || c.batchId !== epoch) return
      resultsRef.current.set(c.strategy, c)
      if (resultsRef.current.size === PORTFOLIO_STRATEGIES.length) {
        const ordered = PORTFOLIO_STRATEGIES.map((s) => resultsRef.current.get(s)).filter(
          (x): x is PortfolioCandidate => Boolean(x),
        )
        const result = computeParetoAudited(inputId, ordered)
        setCandidates(ordered)
        setAudit(result)
        setSelected(ordered.find(isLegalCandidate)?.candidateId ?? null)
        setStatus('done')
        finalizeDraft('complete')
      }
    }

    // 快速域（DP / 保守）在快照上求解。
    void (async () => {
      for (const strategy of PORTFOLIO_STRATEGIES) {
        if (strategy === 'milp_weighted') continue
        try {
          const c = await runPortfolioCandidate(snap, strategy, epoch)
          settle(c)
        } catch (e) {
          settle({
            candidateId: shortHash(`${inputId}|${strategy}|error`),
            canonicalId: '',
            canonicalOk: false,
            canonicalReason: (e as Error).message,
            inputIdentity: inputId,
            inputSnapshot: snapshot,
            batchId: epoch,
            strategy,
            objectiveVersion: strategy,
            domain: strategy === 'conservative_rule' ? 'conservative-rule' : 'dp-lookahead',
            plan: null,
            verified: false,
            metricsOk: false,
            metrics: { energyKwh: null, switches: null, excessSupplyM3: null },
            status: 'invalid',
            reasons: [`求解异常：${(e as Error).message}`],
            diagnostics: null,
          })
        }
      }
    })()

    // MILP 通过原 Worker 求解（输入取自同一快照）。
    if (!controllerRef.current) controllerRef.current = new FlowMilpController()
    const milpInput = {
      fixtureId: snap.id,
      seed: snap.seed,
      points: snap.points,
      stepMinutes: snap.stepMinutes,
      units: snap.units,
      candidates: snap.evaluation.candidates,
      eligibility: snap.evaluation.eligibility,
      initial: snap.initial,
      faultUnitId: snap.faultUnitId,
      timeLimitSeconds: 5,
    }
    setStatus('solving')
    controllerRef.current.run(
      milpInput,
      `${inputId}|strategy=milp_weighted`,
      {
        onStatus: (s) => {
          if (!gateRef.current.isCurrent(epoch)) return
          if (s === 'loading') setStatus('loading')
          else if (s === 'solving') setStatus('solving')
        },
        onDone: (outcome: FlowMilpRunOutcome) => {
          if (!gateRef.current.isCurrent(epoch)) return
          if (outcome.state === 'canceled') {
            setStatus('canceled')
            return
          }
          if (outcome.state !== 'ok' || !outcome.result) {
            settle({
              candidateId: shortHash(`${inputId}|milp|${outcome.state}`),
              canonicalId: '',
              canonicalOk: false,
              canonicalReason: null,
              inputIdentity: inputId,
              inputSnapshot: snapshot,
              batchId: epoch,
              strategy: 'milp_weighted',
              objectiveVersion: 'weighted-demo-v1',
              domain: 'flow-milp',
              plan: null,
              verified: false,
              metricsOk: false,
              metrics: { energyKwh: null, switches: null, excessSupplyM3: null },
              status: outcome.state,
              reasons: [outcome.error ?? outcome.state],
              diagnostics: null,
            })
            return
          }
          settle(portfolioMilpCandidate(snapshot, outcome.result as FlowMilpResult, epoch))
        },
      },
      { timeoutMs: 9000 },
    )
  }

  const cancel = () => {
    controllerRef.current?.cancel()
    // 已完成则只退休活动选择，不重封不改原护照；生成中则按 draft 封存一次。
    if (!sealedRef.current) finalizeDraft('canceled')
    gateRef.current.retire()
    resultsRef.current = new Map()
    retireActive('canceled')
    setStatus('canceled')
  }

  const choose = (id: string) => {
    const candidate = candidates.find((c) => c.candidateId === id) ?? null
    const verdict = canSelectCandidate(candidates, candidate, inputIdentity, batchId)
    if (!verdict.ok) {
      setSelectError(verdict.reasons.join(';'))
      return
    }
    setSelectError(null)
    setSelected(id)
  }

  const selectedCandidate = selected ? candidates.find((c) => c.candidateId === selected) ?? null : null
  const paretoGroups = audit?.groups ?? []
  const rejected = audit?.rejected ?? []

  return (
    <section className="panel portfolio-compare" aria-label="完整一天方案组合">
      <div className="panel-head">
        <h3>完整一天方案组合</h3>
        <span className="tag warn">开发比较 · 尚未授权执行 · 不接审批</span>
      </div>
      <p className="hint">状态：{status}</p>
      <div className="toolbar">
        <label className="field">
          <span>development 场景</span>
          <select
            value={fixtureId}
            onChange={(e) => setFixtureId(e.target.value as PortfolioFixtureId)}
          >
            {PORTFOLIO_FIXTURES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          id="portfolio-generate"
          data-action="portfolio-generate"
          className="btn primary"
          onClick={generate}
          disabled={status === 'solving' || status === 'loading'}
        >
          生成组合
        </button>
        <button
          type="button"
          id="portfolio-cancel"
          data-action="portfolio-cancel"
          className="btn"
          onClick={cancel}
        >
          取消
        </button>
        {selectedCandidate ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              const verdict = canSelectCandidate(
                candidates,
                selectedCandidate,
                inputIdentity,
                batchId,
              )
              if (!verdict.ok) {
                setSelectError(verdict.reasons.join(';'))
                return
              }
              downloadJson(
                'qiheng-portfolio-b01b-selection.json',
                JSON.stringify(
                  {
                    exportedAt: new Date().toISOString(),
                    batchId,
                    inputIdentity,
                    inputSnapshot: selectedCandidate.inputSnapshot,
                    selected: selectedCandidate,
                    pareto: paretoGroups,
                    rejected,
                    attempts: candidates.map((c) => ({
                      candidateId: c.candidateId,
                      strategy: c.strategy,
                      status: c.status,
                      verified: c.verified,
                      metricsOk: c.metricsOk,
                      metrics: c.metrics,
                      reasons: c.reasons,
                      diagnostics: c.diagnostics,
                      canonicalId: c.canonicalId,
                    })),
                  },
                  null,
                  2,
                ),
              )
            }}
          >
            导出所选/证据 JSON
          </button>
        ) : null}
      </div>
      {error ? <p className="neg" role="status">{error}</p> : null}
      {selectError ? <p className="neg" role="status">不可选择：{selectError}</p> : null}

      <div className="portfolio-grid">
        {candidates.map((c) => {
          const legal = isLegalCandidate(c)
          return (
            <article
              key={c.candidateId}
              className={`lab-card${selected === c.candidateId ? ' is-linked' : ''}`}
            >
              <header>
                <h4>{c.strategy}</h4>
                <span className={`tag ${legal ? 'ok' : 'bad'}`}>
                  {legal ? '合法（复算+双门+身份）' : c.status}
                </span>
              </header>

              <div className="metric-row"><span>模型能量</span><strong>{c.metrics.energyKwh === null ? '—' : `${c.metrics.energyKwh.toFixed(2)} kWh`}</strong></div>
              <div className="metric-row"><span>逐机翻转</span><strong>{c.metrics.switches === null ? '—' : c.metrics.switches}</strong></div>
              <div className="metric-row"><span>过量供气</span><strong>{c.metrics.excessSupplyM3 === null ? '—' : `${c.metrics.excessSupplyM3.toFixed(2)} m³`}</strong></div>
              {!legal && c.reasons.length ? <p className="hint neg">{c.reasons.join(' ')}</p> : null}
              <button
                type="button"
                className="btn"
                style={{ minHeight: 44 }}
                onClick={() => choose(c.candidateId)}
                aria-pressed={selected === c.candidateId}
              >
                {selected === c.candidateId ? '已选为只读证据' : '选择该候选'}
              </button>
            </article>
          )
        })}
      </div>

      {paretoGroups.length ? (
        <details className="lab-limits">
          <summary>Pareto / 等价 / 被支配（同 input 同域）</summary>
          <ul className="plain-list">
            {paretoGroups.map((g) => (
              <li key={g.domain}>
                {DOMAIN_LABEL[g.domain]}：前沿 {g.frontiers.map((f) => f.strategy).join('、') || '—'}；
                被支配 {g.dominated.length}；等价 {g.equivalents.length}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {rejected.length ? (
        <details className="lab-limits">
          <summary>未入集合（保留原因，未删行）</summary>
          <ul className="plain-list">
            {rejected.map((r, i) => (
              <li key={`${r.candidateId}-${i}`}>
                {r.strategy}：{r.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {history.length ? (
        <details className="lab-limits">
          <summary>历史（只读 · 不可选为当前）</summary>
          <ul className="plain-list">
            {history.map((h, i) => (
              <li key={`${h.candidate.candidateId}-${i}`}>
                批次 {h.batchId} · {h.candidate.strategy} · {h.reason} · 状态 {h.candidate.status}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="lab-limits">
        <summary>诊断与限制</summary>
        <ul className="plain-list">
          <li>权威绑定为完整 canonicalId（有限原值全桶，不四舍五入）；candidateId 仅短展示。</li>
          <li>合法门不信任自带 bool，一律按生成时快照重新复算；失败/超时/取消/身份无效保留，不入 Pareto。</li>
          <li>96 桶 development（seed 20261003）；4 场景 × 4 策略共 16 次尝试全部保留；取消/换输入/离页清空活动卡与选择。</li>
        </ul>
      </details>

      <PassportPanel mode="compare" latest={passport} persistFeedback={persistFeedback} onOpenExecution={onOpenExecution} />
    </section>
  )
}
