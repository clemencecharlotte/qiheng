import { useEffect, useMemo, useRef, useState } from 'react'
import { loadPassportStore, type DecisionPassport } from '../domain/passport'
import {
  executionController,
  exportExecutionJson,
  type ExecutionEnvelope,
} from '../domain/execution'
import { executionStatusText } from '../domain/statusNarrative'
import { Popover } from './ui/Disclosure'
import NoteRef from './console/NoteRef'

function uuid(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function')
    return globalThis.crypto.randomUUID()
  return `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

interface Eligible {
  passport: DecisionPassport
  candidateId: string
  strategy: string
}

interface Pending {
  kind: 'approve' | 'reject' | 'start' | 'advance'
  executionId: string
  executionEpoch: number
  verificationId: string
  passportId: string
  candidateId: string
  revision: number
  expectedCursor: number
}

export default function ExecutionPanel() {
  const [, force] = useState(0)
  const [tick, setTick] = useState(0)
  const [seed, setSeed] = useState('')
  const [operator, setOperator] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const confirmRef = useRef<HTMLDivElement>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const unsub = executionController.subscribe(() => force((v) => v + 1))
    return () => unsub()
  }, [])

  // 确认弹层：初始焦点进入、Tab 边界循环、Escape 取消、关闭返回触发按钮。
  useEffect(() => {
    if (!pending || typeof document === 'undefined') return
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null
    confirmBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setPending(null)
        return
      }
      if (e.key !== 'Tab' || !confirmRef.current) return
      const focusables = confirmRef.current.querySelectorAll<HTMLElement>('button')
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
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

  const eligible = useMemo<Eligible[]>(() => {
    const store = loadPassportStore()
    const list: Eligible[] = []
    for (const p of store.passports) {
      if (p.status !== 'complete') continue
      for (const a of p.attempts) {
        if (a.verification.ok === true && a.planOrNull && a.planOrNull.feasible) {
          list.push({ passport: p, candidateId: a.candidateId, strategy: a.strategy })
        }
      }
    }
    return list
  }, [tick])

  const latest: ExecutionEnvelope | null = executionController.getLatest()

  const refresh = () => setTick((t) => t + 1)

  const admitSelected = () => {
    const [pid, cid] = seed.split('|')
    const e = eligible.find((x) => x.passport.passportId === pid && x.candidateId === cid)
    if (!e) {
      setFeedback('请选择合格候选')
      return
    }
    const r = executionController.admit(e.passport, e.candidateId, Date.now(), new Date().toISOString())
    setFeedback(r.ok ? '复验通过，已生成执行绑定（待人工批准）' : `送交执行复验被拒绝：${r.reason}`)
  }

  const openConfirm = (kind: Pending['kind']) => {
    if (!latest) return
    // 打开时捕获精确身份/epoch/revision/桶；提交时再核最新 ref，迟到则拒绝。
    setPending({
      kind,
      executionId: latest.executionId,
      executionEpoch: latest.executionEpoch,
      verificationId: latest.binding.verificationId,
      passportId: latest.binding.passportId,
      candidateId: latest.binding.candidateId,
      revision: latest.revision,
      expectedCursor: latest.cursor,
    })
  }

  const submitConfirm = () => {
    if (!pending || !latest) return
    if (
      latest.executionId !== pending.executionId ||
      latest.executionEpoch !== pending.executionEpoch ||
      latest.binding.verificationId !== pending.verificationId ||
      latest.binding.passportId !== pending.passportId ||
      latest.binding.candidateId !== pending.candidateId ||
      latest.revision !== pending.revision
    ) {
      setFeedback('确认迟到：执行对象/epoch/revision 已变化，已拒绝提交')
      setPending(null)
      return
    }
    let r: { ok: boolean; reason: string | null; duplicate?: boolean }
    if (pending.kind === 'approve') r = executionController.approve({ operator: operator.trim(), approvedAt: new Date().toISOString() })
    else if (pending.kind === 'reject') r = executionController.reject({ operator: operator.trim(), reason: rejectReason.trim(), at: new Date().toISOString() })
    else if (pending.kind === 'start') r = executionController.start({ commandId: uuid(), startedAt: new Date().toISOString() })
    else {
      // 用本次捕获的 expectedCursor，不取最新 cursor。
      r = executionController.advance({ commandId: uuid(), executionEpoch: pending.executionEpoch, verificationId: pending.verificationId, expectedCursor: pending.expectedCursor, at: new Date().toISOString() })
    }
    setPending(null)
    setFeedback(r.ok ? `${pending.kind} 已提交${r.duplicate ? '（幂等）' : ''}` : `${pending.kind} 被拒绝：${r.reason}`)
  }

  const nextAction = !latest
    ? '选择合格候选并送交执行复验'
    : latest.status === 'verified'
      ? '人工批准或驳回'
      : latest.status === 'approved'
        ? 'Start（消费批准）'
        : latest.status === 'rejected'
          ? '已驳回；重送需新 epoch'
          : latest.status === 'executing'
            ? '人工 advance 下一桶'
            : latest.status === 'paused'
              ? 'Resume 或退休'
              : latest.status === 'completed'
                ? '已完成（不自动积分）'
                : '已退休（重送需新 epoch）'

  return (
    <section className="panel execution-panel" aria-label="合成执行">
      <div className="panel-head">
        <h3>合成执行链 <NoteRef note="executionIntake" text="执行准入技术口径" /></h3>
        <span className="tag warn">尚未接入执行/PLC</span>
      </div>
      <p className="hint">
        只接受状态为 complete 且合法的已封存护照候选；送交前走结构门与按快照独立复验。
        <Popover label="执行准入技术口径" ariaLabel="查看执行准入技术口径">
          <p>
            只接受 passport.status=complete 且合法 attempt（有限完整 plan）；admit 走 validateStoredPassport 结构门 +
            受支持 source/generator/canonicalVersion/版本 + 按快照独立复验。Start 不加桶；advance 人工逐桶、写成功才发布。
          </p>
        </Popover>
      </p>

      <div className="toolbar">
        <label className="field">
          <span>合格候选（来自已封存护照）</span>
          <select value={seed} onChange={(e) => setSeed(e.target.value)} style={{ minHeight: 44 }}>
            <option value="">
              {eligible.length ? '选择…' : '暂无合格候选（先完成一轮比较）'}
            </option>
            {eligible.map((e) => (
              <option key={`${e.passport.passportId}:${e.candidateId}`} value={`${e.passport.passportId}|${e.candidateId}`}>
                {e.strategy} · {e.passport.scenarioLabel} · {e.passport.passportId.slice(0, 18)}…
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn primary" style={{ minHeight: 44 }} onClick={admitSelected}>
          送交执行复验
        </button>
        <button type="button" className="btn" style={{ minHeight: 44 }} onClick={refresh}>
          刷新护照/执行
        </button>
      </div>

      <div className="toolbar">
        <label className="field">
          <span>人工操作者（合成记录，非认证）</span>
          <input type="text" value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="姓名/工号（合成）" style={{ minHeight: 44 }} />
        </label>
        <label className="field">
          <span>驳回理由（驳回时填写）</span>
          <input type="text" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ minHeight: 44 }} />
        </label>
      </div>

      {feedback ? <p className="hint" role="status">{feedback}</p> : null}
      {executionController.getWarnings().map((w, i) => <p key={i} className="hint neg">{w}</p>)}

      {latest ? (
        <>
          <ul className="plain-list">
            <li>执行 ID {latest.executionId} · 状态 {executionStatusText(latest.status).label}（{latest.status}） · 下一动作：{nextAction}</li>
            <li>来源 {latest.source} · 场景 {latest.scenarioLabel} · 捕获 {latest.capturedAt} · revision {latest.revision}</li>
            <li>游标 {latest.cursor}/{latest.plan.periods.length} · 模型能量 {latest.modelEnergyKwh.toFixed(3)} kWh（合成模拟）</li>
            <li>绑定 passport {latest.binding.passportId} · candidate {latest.binding.candidateId} · batch {latest.binding.batchId} · epoch {latest.executionEpoch} · verify {latest.binding.verificationId}</li>
            <li>授权：{latest.authorization} · 数据质量 {latest.dataQuality.note}</li>
          </ul>

          {executionStatusText(latest.status).risk ? (
            <p className="hint" role="note">{executionStatusText(latest.status).risk}</p>
          ) : null}

          <div className="toolbar">
            <button type="button" className="btn" style={{ minHeight: 44 }} disabled={latest.status !== 'verified'} onClick={() => openConfirm('approve')}>人工批准</button>
            <button type="button" className="btn" style={{ minHeight: 44 }} disabled={!['verified', 'approved'].includes(latest.status)} onClick={() => openConfirm('reject')}>驳回</button>
            <button type="button" className="btn primary" style={{ minHeight: 44 }} disabled={latest.status !== 'approved'} onClick={() => openConfirm('start')}>开始执行</button>
            <button type="button" className="btn" style={{ minHeight: 44 }} disabled={latest.status !== 'executing'} onClick={() => openConfirm('advance')}>人工下一桶</button>
            <button type="button" className="btn" style={{ minHeight: 44 }} disabled={latest.status !== 'executing'} onClick={() => setFeedback(executionController.pause(uuid()).ok ? '已 Pause（同实例）' : 'Pause 被拒绝')}>暂停</button>
            <button type="button" className="btn" style={{ minHeight: 44 }} disabled={latest.status !== 'paused'} onClick={() => setFeedback(executionController.resume(uuid()).ok ? '已 Resume（同实例）' : 'Resume 被拒绝')}>继续</button>
            <button type="button" className="btn ghost" style={{ minHeight: 44 }} onClick={() => setFeedback(executionController.retire('人工停步永久退休').ok ? '已永久退休（保留 prefix）' : '退休失败')}>退休</button>
            <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => downloadText(`${latest.executionId}.json`, exportExecutionJson(latest))}>导出执行 JSON</button>
          </div>

          {pending ? (
            <div className="exec-confirm" role="dialog" aria-modal="true" aria-label="人工确认" ref={confirmRef}>
              <h4>确认{pending.kind === 'advance' ? '下一桶' : pending.kind}</h4>
              <p className="hint">
                对象：passport {pending.passportId} · candidate {pending.candidateId} · epoch{' '}
                {pending.executionEpoch} · verify {pending.verificationId} · revision {pending.revision}
                {pending.kind === 'advance' ? ` · 桶 ${pending.expectedCursor}` : ''}；来源 {latest.source}；仅合成。
              </p>
              <div className="toolbar">
                <button ref={confirmBtnRef} type="button" className="btn primary" style={{ minHeight: 44 }} onClick={submitConfirm}>确认提交</button>
                <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setPending(null)}>取消</button>
              </div>
            </div>
          ) : null}

          <details>
            <summary>复验回执</summary>
            <ul className="plain-list">
              <li>策略 {latest.receipt.strategy} · verifier {latest.receipt.verifierVersion} · rule {latest.receipt.ruleVersion} · 模型 {latest.receipt.modelVersion} · 目标 {latest.receipt.objectiveVersion}</li>
              <li>hasSolution={String(latest.receipt.constraints.hasSolution)} · complete={String(latest.receipt.constraints.complete)} · passed={String(latest.receipt.constraints.passed)} · 违规 {latest.receipt.constraints.violationCount}</li>
              <li>复算能量 {latest.receipt.recomputedMetrics.totalEnergyKwh} kWh · 翻转 {latest.receipt.recomputedMetrics.totalSwitches}</li>
            </ul>
          </details>

          <details>
            <summary>局部 ledger（{latest.ledger.length} 桶）</summary>
            <div className="table-wrap short">
              <table className="period-table">
                <thead><tr><th>index</th><th>分钟</th><th>能量 kWh</th><th>累计 kWh</th><th>receipt</th></tr></thead>
                <tbody>
                  {latest.ledger.map((l) => (
                    <tr key={l.index}>
                      <td className="mono">{l.index}</td>
                      <td className="mono">{l.minuteOfDay}</td>
                      <td className="mono">{l.energyKwh.toFixed(3)}</td>
                      <td className="mono">{l.cumulativeEnergyKwh.toFixed(3)}</td>
                      <td className="mono">{l.receiptHash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="hint">尚未送交执行。可在「方案比较/记录」护照详情中对合法候选点「送交执行」进入本页。</p>
      )}
    </section>
  )
}
