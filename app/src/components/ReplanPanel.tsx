import { useEffect, useRef, useState } from 'react'
import {
  buildSuffixInput,
  captureIncident,
  classifySuffixOutcome,
  commitSuffixLedger,
  createSuffixExecution,
  replayPrefix,
  suffixCanonical,
  replanController,
  type Incident,
  type PrefixReplay,
  type SuffixAttempt,
  type SuffixExecutionRecord,
  type SuffixRequest,
} from '../domain/replan'
import { protectedEqual } from '../domain/execution'
import { RULE_VERSION } from '../domain/audit'
import { VERIFIER_VERSION } from '../domain/constraints'
import { executionController, type ExecutionEnvelope } from '../domain/execution'
import { FlowMilpController, type FlowMilpRunOutcome } from '../optimizer/flowMilpController'
import { attemptNarrative, suffixStatusText } from '../domain/statusNarrative'

/** 本组件唯一 suffix 求解 watchdog 期限（与本面板 run 配置同源）。 */
const SUFFIX_TIMEOUT_MS = 9000
import { Popover } from './ui/Disclosure'
import NoteRef from './console/NoteRef'

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

interface Pending {
  kind: 'approve' | 'start' | 'advance'
  suffixId: string
  verificationId: string
  requestEpoch: number
  revision: number
  expectedCursor: number
  snapshot: SuffixExecutionRecord
}
interface AsyncCapture {
  requestId: string
  epoch: number
  retiredParentSnapshot: ExecutionEnvelope
  replay: PrefixReplay
  cursor: number
  businessKey: string
  faultSet: string[]
}

export default function ReplanPanel() {
  const controllerRef = useRef<FlowMilpController | null>(null)
  const confirmRef = useRef<HTMLDivElement>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const captureRef = useRef<AsyncCapture | null>(null)
  const parentRef = useRef<ExecutionEnvelope | null>(null)
  const [, force] = useState(0)
  const [faultInput, setFaultInput] = useState('')
  const [operator, setOperator] = useState('')
  const [incident, setIncident] = useState<Incident | null>(null)
  const [replay, setReplay] = useState<PrefixReplay | null>(null)
  const [attempt, setAttempt] = useState<SuffixAttempt | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  useEffect(() => {
    const unsub = replanController.subscribe(() => force((v) => v + 1))
    return () => unsub()
  }, [])
  // 卸载取消 pending Worker，使该 request 永不可采用。
  useEffect(
    () => () => {
      controllerRef.current?.cancel()
      captureRef.current = null
    },
    [],
  )
  useEffect(() => {
    if (!pending || typeof document === 'undefined') return
    triggerRef.current = (document.activeElement as HTMLButtonElement | null) ?? null
    confirmBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setPending(null)
        return
      }
      if (e.key !== 'Tab' || !confirmRef.current) return
      const f = confirmRef.current.querySelectorAll<HTMLElement>('button')
      if (!f.length) return
      const first = f[0]
      const last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      triggerRef.current?.focus?.()
    }
  }, [pending])

  const parent = executionController.getLatest()
  const suffix = replanController.getLatest()
  const context = replanController.getContext()
  const knownUnits = new Set((parent?.inputSnapshot.units ?? []).map((u) => u.id))
  const parseFaults = () => faultInput.split(',').map((s) => s.trim()).filter(Boolean)

  const retireOnFault = () => {
    if (!parent) return setFeedback('无父执行')
    const faults = parseFaults()
    if (faults.length === 0) return setFeedback('故障机组不能为空（空集不得制造成功）')
    const unknown = faults.filter((f) => !knownUnits.has(f) || f === 'AC-03')
    if (unknown.length) return setFeedback(`未知/排除故障机组：${unknown.join(',')}，就地拒绝`)
    const faultSet = Array.from(new Set([...context.faultSet, ...faults]))
    controllerRef.current?.cancel()
    captureRef.current = null
    // 第二故障且已有已提交子桶：组合 prefix 续算未支持 → 明确阻断保账本，不退回父 cursor 重算。
    const prev = replanController.getLatest()
    if (prev && prev.cursor > 0 && prev.status !== 'terminated') {
      replanController.setBusinessContext({ faultSet })
      replanController.terminate('第二故障：尚不支持组合 prefix 续算，阻断并保留父 prefix+子 ledger')
      setFeedback('第二故障发生在已提交子桶之后：当前不支持组合 prefix 续算，已阻断并保留父 prefix 与子 ledger（不退回父 cursor 重算）。')
      return
    }
    replanController.setBusinessContext({ faultSet })
    const inc = captureIncident(parent, parent.cursor, `故障 ${faultSet.join('+')}`, new Date().toISOString(), faultSet)
    const rep = replayPrefix(parent.inputSnapshot, parent.plan, parent.ledger, parent.cursor, { executionId: parent.executionId, verificationId: parent.binding.verificationId })
    executionController.retire(`故障退休：${inc.reason}`)
    parentRef.current = executionController.getLatest() ?? parent
    setIncident(inc)
    setReplay(rep)
    setAttempt(null)
    setFeedback(`已登记故障（${faultSet.join('+')}）并退休；prefix 重放 ${rep.ok ? 'OK' : `阻断：${rep.reason}`}`)
  }

  const generateSuffix = () => {
    const retiredParent = executionController.getLatest()
    if (!replay || !retiredParent || !incident) return setFeedback('请先登记故障并退休')
    // 父保存屏障：退休须已落盘且 pendingSaveReason 为空。
    if (executionController.getPendingSaveReason() !== null) return setFeedback('父退休未保存（pendingSaveReason 非空），禁止子授权')
    // 同父已有已提交子桶：本片不支持组合 prefix 续算 → 真实生成入口阻断，保父 prefix+全部子 ledger。
    if (replanController.hasCommittedChild(retiredParent.executionId))
      return setFeedback('同父已有已提交子桶，组合 prefix 续算尚不支持，已阻断（保父 prefix 与全部子 ledger；不退回父 cursor 重算）')
    const faults = replanController.getContext().faultSet
    if (faults.length === 0) return setFeedback('faultSet 为空，禁止子授权')
    const built = buildSuffixInput(retiredParent.inputSnapshot, replay, faults)
    if (!built.ok || !built.input) {
      const empty: SuffixAttempt = { requestId: 'req', state: 'no_remaining', nativeState: null, reasons: [built.reason ?? 'no-input'], result: null, timedOut: false, cancelled: false, error: null }
      setAttempt(empty)
      setFeedback(`无可重规划段：${built.reason}`)
      return
    }
    const epoch = Date.now()
    const requestId = `suffix-${epoch.toString(36)}`
    const capture: AsyncCapture = { requestId, epoch, retiredParentSnapshot: retiredParent, replay, cursor: replay.cursor, businessKey: retiredParent.businessKey, faultSet: faults.slice() }
    captureRef.current = capture
    const req: SuffixRequest = {
      requestId, epoch,
      parentPassportId: retiredParent.binding.passportId, parentCandidateId: retiredParent.binding.candidateId,
      parentExecutionId: retiredParent.executionId, parentVerificationId: retiredParent.binding.verificationId,
      parentRevision: retiredParent.revision, businessKey: retiredParent.businessKey, cursor: replay.cursor,
      faultSet: faults, ruleVersion: RULE_VERSION, verifierVersion: VERIFIER_VERSION,
      inputCanonical: suffixCanonical(retiredParent.inputSnapshot, replay, faults, epoch), capturedAt: new Date().toISOString(),
    }
    if (!controllerRef.current) controllerRef.current = new FlowMilpController()
    setFeedback('重规划求解中…')
    controllerRef.current.run(built.input, requestId, {
      onDone: (outcome: FlowMilpRunOutcome) => {
        const cap = captureRef.current
        const liveParent = executionController.getLatest()
        // 迟到/换父/换 request/context 不同 → 不写 attempt/证据。
        if (!cap || cap.requestId !== requestId) return
        if (!liveParent || !protectedEqual(liveParent, cap.retiredParentSnapshot)) return
        const liveCtx = replanController.getContext()
        if (liveCtx.businessKey !== cap.businessKey || liveCtx.faultSet.slice().sort().join(',') !== cap.faultSet.slice().sort().join(',')) return
        const state = classifySuffixOutcome(outcome.state, outcome.result, outcome.error ?? null)
        const att: SuffixAttempt = {
          requestId, state, nativeState: outcome.result?.diagnostics.state ?? null,
          reasons: outcome.result?.reasons ?? (outcome.error ? [outcome.error] : []), result: outcome.result,
          timedOut: outcome.result?.diagnostics.timedOut ?? outcome.state === 'watchdog_terminated',
          cancelled: outcome.state === 'canceled', error: outcome.error ?? null,
        }
        setAttempt(att)
        replanController.recordAttempt({ requestId, parentExecutionId: cap.retiredParentSnapshot.executionId, state, planNull: !att.result?.plan, reasons: att.reasons, at: new Date().toISOString() })
        if (state !== 'ok' || !att.result?.plan) {
          const reason = att.reasons.length ? att.reasons.join('；') : null
          const narrative = attemptNarrative(state, Boolean(att.result?.plan), reason)
          const deadline = state === 'timeout' ? ` 本次 watchdog 期限 ${SUFFIX_TIMEOUT_MS / 1000} 秒。` : ''
          const reasonNote = reason ? '' : ' 未提供更具体原因。'
          setFeedback(`suffix 结果：${narrative}${deadline}${reasonNote}`)
          return
        }
        const planned = commitSuffixLedger(cap.retiredParentSnapshot.inputSnapshot, cap.replay, att.result.plan, att, cap.faultSet, { segmentExecutionId: 'pending', verificationId: 'pending', decisionId: '', auditId: '', variantId: 'pending' })
        if (!planned.ok) return setFeedback(`suffix 段复验失败：${planned.reason}`)
        const created = createSuffixExecution(req, att, planned, cap.replay, cap.retiredParentSnapshot)
        if (!created.ok || !created.record) return setFeedback(`子段创建失败：${created.reason}`)
        const r = replanController.createSuffix(created.record, incident)
        setFeedback(r.ok ? `suffix 成功：计划 ${planned.rows.length} 桶（未执行），累计仅 prefix` : `子段保存失败：${r.reason}`)
      },
    }, { timeoutMs: SUFFIX_TIMEOUT_MS })
  }

  const cancelSolving = () => {
    controllerRef.current?.cancel()
    captureRef.current = null
    setFeedback('已取消当前 suffix 求解（该 request 不再采用）')
  }

  const openConfirm = (kind: Pending['kind'], cursor = 0) => {
    const s = replanController.getLatest()
    if (!s) return
    setPending({ kind, suffixId: s.suffixId, verificationId: s.verificationId, requestEpoch: s.attemptRecord.epoch, revision: s.revision, expectedCursor: cursor, snapshot: s })
  }
  const submitConfirm = () => {
    const latest = replanController.getLatest()
    if (!pending || !latest) return setPending(null)
    if (!protectedEqual(latest, pending.snapshot) || latest.suffixId !== pending.suffixId || latest.revision !== pending.revision) {
      setFeedback('确认迟到：子段已变化，拒绝批准旧对象')
      setPending(null)
      return
    }
    let r: { ok: boolean; reason: string | null }
    if (pending.kind === 'approve') r = replanController.approve({ operator: operator.trim(), at: new Date().toISOString() })
    else if (pending.kind === 'start') r = replanController.start(`c-${Date.now()}`)
    else r = replanController.advance({ expectedCursor: pending.expectedCursor })
    setPending(null)
    setFeedback(r.ok ? `${pending.kind} 已提交` : `${pending.kind} 被拒绝：${r.reason}`)
  }

  return (
    <section className="panel replan-panel" aria-label="suffix 重规划">
      <div className="panel-head">
        <h3>故障 → 退休 → suffix 重规划 <NoteRef note="replanBarrier" text="suffix 父保存屏障口径" /></h3>
        <span className="tag warn">合成模拟 · 非设备控制</span>
      </div>
      <p className="hint">
        故障退休父执行后，由父保存屏障授权子段重规划；本面板仅视图。
        <Popover label="suffix 父保存屏障口径" ariaLabel="查看 suffix 父保存屏障口径">
          <p>
            模块级 replanController + executionController 父保存屏障；Panel 仅视图。确认弹层捕获 suffixId/epoch/verification/revision/完整 snapshot，提交再核。
          </p>
        </Popover>
      </p>
      <div className="toolbar">
        <label className="field"><span>故障机组（逗号分隔，非空）</span><input type="text" value={faultInput} onChange={(e) => setFaultInput(e.target.value)} style={{ minHeight: 44 }} /></label>
        <button type="button" className="btn" style={{ minHeight: 44 }} onClick={retireOnFault}>登记故障并退休</button>
        <button type="button" className="btn primary" style={{ minHeight: 44 }} onClick={generateSuffix}>生成 suffix 重规划</button>
        <button type="button" className="btn" style={{ minHeight: 44 }} onClick={cancelSolving}>取消求解</button>
        <label className="field"><span>人工操作者（合成）</span><input type="text" value={operator} onChange={(e) => setOperator(e.target.value)} style={{ minHeight: 44 }} /></label>
      </div>
      {feedback ? <p className="hint" role="status">{feedback}</p> : null}
      {replanController.getWarnings().map((w, i) => <p key={i} className="hint neg">{w}</p>)}
      {replanController.getPendingSaveReason() ? <p className="hint neg">未保存：{replanController.getPendingSaveReason()}</p> : null}

      {incident ? (
        <ul className="plain-list">
          <li>Incident {incident.incidentId} · 父 {incident.executionId} · epoch {incident.executionEpoch} · revision {incident.revision} · @index {incident.atIndex}</li>
          <li>原因 {incident.reason} · faultSet {incident.faultSet.join(',')} · context faultSet {context.faultSet.join(',') || '—'}</li>
        </ul>
      ) : null}
      {replay ? <p className="hint">prefix 重放 {replay.ok ? 'OK' : `阻断：${replay.reason}`} · cursor {replay.cursor} · 累计 {replay.cumulativeEnergyKwh.toFixed(3)} kWh</p> : null}
      {attempt ? <p className="hint">attempt {attempt.requestId} · 状态 {suffixStatusText(attempt.state).label}（{attempt.state}） · native {attempt.nativeState ?? '—'}</p> : null}
      {attempt ? <p className="hint" role="note">{attemptNarrative(attempt.state, Boolean(attempt.result?.plan), attempt.reasons[0] ?? null)}</p> : null}

      {suffix ? (
        <>
          <ul className="plain-list">
            <li>子段 {suffix.suffixId} · 状态 {suffixStatusText(suffix.status).label}（{suffix.status}） · verification {suffix.verificationId} · revision {suffix.revision}</li>
            <li>binding decision {suffix.binding.decisionId || '—'} · audit {suffix.binding.auditId || '—'}</li>
            <li>lineage 父 {suffix.lineage.parentExecutionId} · prefixCursor {suffix.lineage.prefixCursor} · windowStart {suffix.windowStartIndex} · segmentCursor {suffix.lineage.segmentCursor}</li>
            <li>faultSet {suffix.faultSet.join(',')} · 已提交 {suffix.cursor}/计划 {suffix.plannedRows.length} · 累计 {suffix.cumulativeEnergyKwh.toFixed(3)} kWh</li>
          </ul>
          {suffixStatusText(suffix.status).risk ? (
            <p className="hint" role="note">{suffixStatusText(suffix.status).risk}</p>
          ) : null}
          <div className="toolbar">
            <button ref={triggerRef} type="button" className="btn" style={{ minHeight: 44 }} disabled={suffix.status !== 'verified'} onClick={() => openConfirm('approve')}>子段人工批准</button>
            <button ref={triggerRef} type="button" className="btn primary" style={{ minHeight: 44 }} disabled={suffix.status !== 'approved'} onClick={() => openConfirm('start')}>子段 Start</button>
            <button ref={triggerRef} type="button" className="btn" style={{ minHeight: 44 }} disabled={suffix.status !== 'executing'} onClick={() => openConfirm('advance', suffix.cursor)}>段下一桶</button>
            <button type="button" className="btn ghost" style={{ minHeight: 44 }} onClick={() => setFeedback(replanController.terminate('人工终止').ok ? '子段已终止' : '终止失败')}>终止子段</button>
            <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => download(`${suffix.suffixId}.json`, JSON.stringify(suffix, null, 2))}>导出子段 JSON</button>
          </div>
          {pending ? (
            <div className="exec-confirm" role="dialog" aria-modal="true" aria-label="子段人工确认" ref={confirmRef}>
              <h4>确认{pending.kind === 'advance' ? '段下一桶' : pending.kind === 'start' ? '子段 Start' : '子段人工批准'}</h4>
              <p className="hint">
                捕获对象：suffix {pending.suffixId} · epoch {pending.requestEpoch} · verification {pending.verificationId} · revision {pending.revision}
                {pending.kind === 'advance' ? ` · 捕获桶 ${pending.expectedCursor}` : ''} · 状态 {pending.snapshot.status}；仅合成。
              </p>
              <div className="toolbar">
                <button ref={confirmBtnRef} type="button" className="btn primary" style={{ minHeight: 44 }} onClick={submitConfirm}>确认提交</button>
                <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setPending(null)}>取消</button>
              </div>
            </div>
          ) : null}
          <details>
            <summary>已提交段 ledger（{suffix.ledger.length} · 原 index 唯一）</summary>
            <div className="table-wrap short">
              <table className="period-table">
                <thead><tr><th>local</th><th>原 index</th><th>分钟</th><th>能量</th><th>累计</th></tr></thead>
                <tbody>
                  {suffix.ledger.map((r) => (
                    <tr key={r.originalIndex}><td className="mono">{r.index}</td><td className="mono">{r.originalIndex}</td><td className="mono">{r.minuteOfDay}</td><td className="mono">{r.energyKwh.toFixed(3)}</td><td className="mono">{r.cumulativeEnergyKwh.toFixed(3)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : null}
    </section>
  )
}
