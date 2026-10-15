import { useEffect, useMemo, useRef, useState } from 'react'
import { evaluateUnits } from '../domain/engine'
import { UNITS } from '../domain/units'
import {
  buildFlowMilpDevFixture,
  FLOW_MILP_MODEL_VERSION,
  FLOW_MILP_OBJECTIVE_VERSION,
  FLOW_MILP_SWITCH_PENALTY_KWH,
  type FlowMilpInput,
  type FlowMilpResult,
} from '../domain/optimizer/flowMilp'
import { FlowMilpController, type FlowMilpRunOutcome } from '../optimizer/flowMilpController'

const OBJECTIVE_TEXT =
  'weighted-demo-v1 = min Σ 模型能量(kWh) + 1.5 kWh/次 × 实际逐机开停翻转；过量供气惩罚 0'

function buildInput(): FlowMilpInput {
  const fixture = buildFlowMilpDevFixture()
  const evaluation = evaluateUnits(UNITS, 'normal')
  return {
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

interface FlowMilpLabProps {
  /** 当前 App 身份：变化时取消旧请求并清旧结果（四桶夹具固定也做上下文隔离）。 */
  contextKey?: string
}

export default function FlowMilpLab({ contextKey = 'default' }: FlowMilpLabProps) {
  const controllerRef = useRef<FlowMilpController | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'solving' | 'verify' | 'canceled' | 'done'>('idle')
  const [result, setResult] = useState<FlowMilpResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const input = useMemo(() => buildInput(), [])
  const identity = useMemo(
    () => `${input.fixtureId}:${input.seed}:${contextKey}`,
    [input, contextKey],
  )

  // 身份/场景变化：取消旧请求并清旧结果与状态。
  useEffect(() => {
    return () => {
      controllerRef.current?.cancel()
    }
  }, [identity])

  // 卸载清理。
  useEffect(
    () => () => {
      controllerRef.current?.cancel()
    },
    [],
  )

  const start = () => {
    setError(null)
    setResult(null)
    if (!controllerRef.current) controllerRef.current = new FlowMilpController()
    controllerRef.current.run(
      input,
      identity,
      {
        onStatus: (s) => {
          if (s === 'loading' || s === 'solving') setStatus(s)
        },
        onDone: (outcome: FlowMilpRunOutcome) => {
          if (outcome.state === 'ok' && outcome.result) {
            setResult(outcome.result)
            setStatus('done')
          } else if (outcome.state === 'canceled') {
            setStatus('canceled')
          } else {
            setError(
              outcome.state === 'watchdog_terminated'
                ? '超时被 watchdog 终止（可取消）；未获得或未采用可行解。'
                : outcome.error ?? '求解失败',
            )
            setStatus('done')
          }
        },
      },
      { timeoutMs: 9000 },
    )
  }

  const cancel = () => {
    const receipt = controllerRef.current?.cancel()
    setStatus('canceled')
    if (receipt) setError(`已取消 ${receipt.requestId}（旧状态与 reasons 保留在结果区）。`)
  }

  const d = result?.diagnostics

  return (
    <section className="panel flow-milp" aria-label="连续负荷 MILP 开发算例">
      <div className="panel-head">
        <h3>连续负荷 MILP 开发算例（4 桶）</h3>
        <span className="tag warn">开发算例 · 与 96 桶 App 方案分开 · 不接审批</span>
      </div>
      <p className="hint">
        上游内核 HiGHS（highs-js, MIT）；模型 {FLOW_MILP_MODEL_VERSION}，目标{' '}
        {FLOW_MILP_OBJECTIVE_VERSION}（切换惩罚 {FLOW_MILP_SWITCH_PENALTY_KWH} kWh/次，
        过量供气惩罚 0）。来源：新 seed 20261003，minuteOfDay [480,495,510,525]，
        demand [11.4,22,11.4,22]，共享初态 AC-01 开、AC-02/AC-03 停，距上次变化 30min。
      </p>
      <p className="hint">数学目标：{OBJECTIVE_TEXT}</p>
      <div className="decision-actions">
        <button
          type="button"
          id="flow-milp-start"
          data-action="flow-milp-start"
          className="btn primary"
          onClick={start}
          disabled={status === 'loading' || status === 'solving' || status === 'verify'}
        >
          {status === 'loading' || status === 'solving' || status === 'verify'
            ? '求解中…'
            : '启动 4 桶 MILP 求解'}
        </button>
        <button
          type="button"
          id="flow-milp-cancel"
          data-action="flow-milp-cancel"
          className="btn"
          onClick={cancel}
        >
          取消
        </button>
        {result ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              downloadJson('qiheng-highs-poc-v1-result.json', JSON.stringify(result, null, 2))
            }
          >
            下载结果 JSON
          </button>
        ) : null}
        <span className="tag muted" role="status">
          状态：{status}
        </span>
      </div>

      {error ? <p className="neg" role="status">{error}</p> : null}

      {result ? (
        <>
          <div className="plan-grid">
            <article className="plan-card">
              <header>
                <h4>方案</h4>
                <span className={`tag ${result.plan ? 'ok' : 'bad'}`}>
                  {result.plan ? '复验通过' : '不展示（失败/null）'}
                </span>
              </header>
              <div className="metric-row"><span>模型能量</span><strong>{result.metrics.energyKwh === null ? '—' : `${result.metrics.energyKwh.toFixed(2)} kWh`}</strong></div>
              <div className="metric-row"><span>逐机翻转</span><strong>{result.metrics.switches === null ? '—' : result.metrics.switches}</strong></div>
              <div className="metric-row"><span>过量供气</span><strong>{result.metrics.excessSupplyM3 === null ? '—' : `${result.metrics.excessSupplyM3.toFixed(2)} m³`}</strong></div>
              <p className="hint">verification={String(result.verified)} · metricsOk={String(result.metricsOk)}</p>
            </article>
            <article className="plan-card">
              <header>
                <h4>诊断</h4>
                <span className="tag muted">{d?.state ?? '—'}</span>
              </header>
              <div className="metric-row"><span>call / modelStatus</span><strong className="mono">{d?.nativeCallStatus ?? '—'} / {d?.modelStatus || '—'}({d?.modelStatusCode ?? '—'})</strong></div>
              <div className="metric-row"><span>primal</span><strong>{d?.primalSolutionStatus ?? '—'} / {String(d?.hasPrimal)}</strong></div>
              <div className="metric-row"><span>mip_gap</span><strong>{d?.mipGap ?? '—'}</strong></div>
              <div className="metric-row"><span>mip_dual_bound</span><strong>{d?.mipDualBound ?? '—'}</strong></div>
              <div className="metric-row"><span>warnings</span><strong>{d?.nativeWarnings.length ?? 0}</strong></div>
              <div className="metric-row"><span>耗时 ms</span><strong className="mono">L{d?.timingsMs.loading ?? 0} M{d?.timingsMs.model ?? 0} S{d?.timingsMs.solve ?? 0} V{d?.timingsMs.verify ?? 0}</strong></div>
            </article>
          </div>
          {result.reasons.length ? <p className="hint neg">{result.reasons.join(' ')}</p> : null}
          {d?.notes.length ? <p className="hint">{d.notes.join(' ')}</p> : null}
        </>
      ) : null}

      <details className="transparent-limits">
        <summary>限制与方法边界</summary>
        <ul className="plain-list">
          <li>首轮限时 5 秒；超时有可行 incumbent 时不标 Optimal，仅可展示为 time_limit_with_incumbent。</li>
          <li>失败/无 primal/取消均显式保留，回退现有规则方案，不偷切默认。</li>
          <li>四桶开发闭环，未扩 96 桶/多目标/holdout；非现场 KPI。</li>
        </ul>
      </details>
    </section>
  )
}
