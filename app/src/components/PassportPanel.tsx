import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  exportPassportJson,
  loadPassportStore,
  resolvePassportRef,
  type DecisionPassport,
  type PassportCandidateRecord,
} from '../domain/passport'
import { executionController } from '../domain/execution'
import StatusBadge, { type StatusTone } from './console/StatusBadge'
import { Popover } from './ui/Disclosure'

function downloadText(name: string, text: string, type = 'application/json;charset=utf-8'): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function statusText(r: PassportCandidateRecord): string {
  if (!r.verification.evaluated) return `无解/未运行（${r.status}）`
  return r.verification.ok ? '复验通过' : '复验未通过'
}

/** 真实状态 tone：未运行/无解不绿；复验未通过 severe；通过 normal（仅该项复验，不等执行）。 */
export function statusTone(r: PassportCandidateRecord): StatusTone {
  if (!r.verification.evaluated) return 'unknown'
  return r.verification.ok ? 'normal' : 'severe'
}

type EvidenceTarget = { kind: 'input' | 'candidate' | 'verification'; passportId: string; candidateId?: string; ref: string; triggerId: string }

type OpenExecution = (target: { passportId: string; candidateId: string; triggerId: string }) => void

function CandidateRecordView({
  r,
  passport,
  onOpenExecution,
  forceVerifyOpen = false,
  onReturnRef,
}: {
  r: PassportCandidateRecord
  passport: DecisionPassport
  onOpenExecution?: OpenExecution
  forceVerifyOpen?: boolean
  onReturnRef?: () => void
}) {
  const [manualOpen, setManualOpen] = useState(false)
  const open = forceVerifyOpen || manualOpen
  const setOpen = (v: boolean) => setManualOpen(v)
  const [admitMsg, setAdmitMsg] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const canSend = passport.status === 'complete' && r.verification.ok === true && r.planOrNull != null
  const triggerId = `passport-send-${passport.passportId}-${r.candidateId}`
  const onSend = () => {
    const res = executionController.admit(passport, r.candidateId, Date.now(), new Date().toISOString())
    if (!res.ok) {
      setAdmitMsg(`送交被拒绝：${res.reason}`)
      return
    }
    if (!onOpenExecution) {
      setAdmitMsg('已送交执行复验；请到「调度 · 合成执行」查看。')
      return
    }
    // 通过既有 App navigate/entryId 合同回调，保留当前 route 参数/来源/返回历史与焦点。
    onOpenExecution({ passportId: passport.passportId, candidateId: r.candidateId, triggerId })
  }
  return (
    <article className="lab-card passport-candidate" id={`candidate-${passport.passportId}-${r.candidateId}`} tabIndex={-1}>
      <header>
        <h4>
          {r.strategyLabel} <span className="hint">（strategy：{r.strategy}）</span>
        </h4>
        <StatusBadge tone={statusTone(r)} label={statusText(r)} />
      </header>
      {onReturnRef ? <button type="button" className="link-btn" onClick={onReturnRef}>← 返回证据引用</button> : null}
      <p className="hint">
        状态 {r.status} · 目标 {r.objectiveVersion} · 生产 {r.producer.kind}
        <br />
        {r.producer.note}
      </p>
      <div className="metric-row"><span>模型能量</span><strong>{r.metrics.energyKwh === null ? '—' : `${r.metrics.energyKwh.toFixed(2)} kWh`}</strong></div>
      <div className="metric-row"><span>逐机翻转</span><strong>{r.metrics.switches === null ? '—' : r.metrics.switches}</strong></div>
      <div className="metric-row"><span>过量供气</span><strong>{r.metrics.excessSupplyM3 === null ? '—' : `${r.metrics.excessSupplyM3.toFixed(2)} m³`}</strong></div>
      {r.reasons.length ? <p className="hint neg">{r.reasons.join('；')}</p> : null}
      <button
        ref={triggerRef}
        type="button"
        className="btn"
        style={{ minHeight: 44 }}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? '收起复验证据' : '展开复验证据'}
      </button>
      {canSend ? (
        <button ref={triggerRef} id={triggerId} type="button" className="btn primary" style={{ minHeight: 44 }} onClick={onSend}>
          送交执行
        </button>
      ) : null}
      {admitMsg ? <p className="hint" role="status">{admitMsg}</p> : null}
      {open ? (
        <div className="passport-verify" id={`verify-${passport.passportId}-${r.candidateId}`} tabIndex={-1}>
          {r.verification.evaluated ? (
            <>
              <p className="hint">
                身份：{r.verification.identity.ok ? '通过' : '未通过'}
                {r.verification.identity.reasons.length
                  ? `（${r.verification.identity.reasons.join('；')}）`
                  : ''}
              </p>
              <p className="hint">
                硬约束：hasSolution={String(r.verification.constraints?.hasSolution)} · complete=
                {String(r.verification.constraints?.complete)} ·{' '}
                {r.verification.constraints?.passed ? '通过' : '未通过'}（
                {r.verification.constraints?.violationCount ?? 0} 条；verifier{' '}
                {r.verification.constraints?.verifierVersion} / rule {r.verification.constraints?.ruleVersion}）
                {r.verification.constraints?.violations.length
                  ? `；${r.verification.constraints.violations
                      .slice(0, 6)
                      .map((v) => `#${v.periodIndex} ${v.type}`)
                      .join('，')}`
                  : ''}
              </p>
              <p className="hint">
                指标复算：{r.verification.metrics?.ok ? '一致' : '不一致'}（
                {r.verification.metrics?.mismatchCount ?? 0} 项）；复算能量{' '}
                {r.verification.metrics?.recomputed.totalEnergyKwh ?? '—'} kWh / 翻转{' '}
                {r.verification.metrics?.recomputed.totalSwitches ?? '—'}
              </p>
              <p className="hint">
                原声明指标：能量 {r.verification.declaredMetrics.energyKwh ?? '—'} / 翻转{' '}
                {r.verification.declaredMetrics.switches ?? '—'}（与复算
                {r.verification.declaredMatchesRecomputed ? '一致' : '不一致，不修值，取复算展示'}）
              </p>
              <p className="hint">canonical：{r.canonicalId.slice(0, 12)}… <Popover label="完整 canonical" ariaLabel="完整 canonical 与 verifier 版本"><p className="mono" style={{ overflowWrap: 'anywhere' }}>{r.canonicalId}</p><p>verifier {r.verification.constraints?.verifierVersion} / rule {passport.ruleVersion}</p></Popover></p>
            </>
          ) : (
            <p className="hint neg">{r.verification.notRunReason}</p>
          )}
          {r.verification.b01RejectReasons.length && r.verification.ok !== true ? (
            <p className="hint neg">B01 拒绝原因：{r.verification.b01RejectReasons.join('；')}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function PassportDetail({ passport, onOpenExecution, evidenceTarget, onLocateRef, onReturnRef }: { passport: DecisionPassport; onOpenExecution?: OpenExecution; evidenceTarget: EvidenceTarget | null; onLocateRef: (t: EvidenceTarget) => void; onReturnRef: () => void }) {
  const inputPoints = passport.inputSnapshot.points
  const [manualInputOpen, setManualInputOpen] = useState(false)
  const forcedInput = evidenceTarget?.kind === 'input' && evidenceTarget.passportId === passport.passportId
  const inputOpen = forcedInput || manualInputOpen
  return (
    <div className="passport-detail">
      <div className="panel-head">
        <h3 className="mono">{passport.passportId}</h3>
        <span className="tag warn">{passport.authorization}</span>
      </div>
      <p className="hint">
        来源 {passport.inputSource} · 场景 {passport.scenarioLabel} · 生成时间 {passport.generatedAt} ·
        生成捕获时间 {passport.captureStartedAt} · 来源采集时间 {passport.sourceCollectionTime}
      </p>

      <details open>
        <summary>摘要</summary>
        <ul className="plain-list">
          <li>范围：{passport.sourceRange.pointCount} 桶 × {passport.sourceRange.stepMinutes} 分钟（{passport.sourceRange.startMinute}–{passport.sourceRange.endMinute} 分钟）</li>
          <li>尝试 {passport.summary.attempted}：合法 {passport.summary.legal}；拒绝 {passport.summary.rejected}；无解/未运行 {passport.summary.notRun}</li>
          <li>状态 {passport.status}；安全下一动作：{passport.summary.legal > 0 ? '由人类评审后再决定，本护照不授权执行' : '无合法方案，需调整需求或资格后重生成'}</li>
          <li>数据质量：{passport.dataQuality.status}（{passport.dataQuality.scope}）</li>
        </ul>
      </details>

      <details>
        <summary>数据质量与 unknown</summary>
        <ul className="plain-list">
          {passport.dataQuality.reasons.map((r, i) => <li key={`dq-${i}`}>{r}</li>)}
          {passport.dataQuality.unknownFields.map((u) => (
            <li key={u.field} className="hint">unknown：{u.field} —— {u.reason}</li>
          ))}
        </ul>
      </details>

      <details id={`input-${passport.passportId}`} tabIndex={-1} open={inputOpen} onToggle={(e) => { if (!forcedInput) setManualInputOpen((e.currentTarget as HTMLDetailsElement).open) }}>
        <summary>输入与资格</summary>
        <ul className="plain-list">
          <li>seed {passport.inputSnapshot.seed} · step {passport.inputSnapshot.stepMinutes} · fault {passport.inputSnapshot.faultUnitId ?? 'none'}</li>
          <li>初态运行 {passport.inputSnapshot.initial.runningUnitIds.join(',') || '—'}</li>
          <li>
            资格：
            {passport.inputSnapshot.eligibility
              .map((e) => `${e.unitId}:${e.eligible ? '可用' : '不可用'}`)
              .join('，')}
          </li>
        </ul>
        <div className="table-wrap short passport-points">
          <table className="period-table">
            <thead>
              <tr><th>index</th><th>分钟</th><th>需求 m³/min</th></tr>
            </thead>
            <tbody>
              {inputPoints.map((p) => (
                <tr key={p.index}><td className="mono">{p.index}</td><td className="mono">{p.minuteOfDay}</td><td className="mono">{p.demand}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
              {forcedInput ? <button type="button" className="link-btn" onClick={onReturnRef}>← 返回证据引用</button> : null}
      </details>

      <details open>
        <summary>候选（{passport.attempts.length}）</summary>
        <div className="passport-candidates">
          {passport.attempts.map((r) => <CandidateRecordView key={r.candidateId} r={r} passport={passport} onOpenExecution={onOpenExecution} forceVerifyOpen={evidenceTarget?.kind === 'verification' && evidenceTarget.passportId === passport.passportId && evidenceTarget.candidateId === r.candidateId} onReturnRef={(evidenceTarget?.passportId === passport.passportId && evidenceTarget.candidateId === r.candidateId) ? onReturnRef : undefined} />)}
        </div>
      </details>

      <details>
        <summary>复验与证据引用</summary>
        <ul className="plain-list">
          <li>复验器 {passport.verifierVersion} · 规则 {passport.ruleVersion} · 模型 {passport.modelVersion} · 目标 {passport.objectiveVersion}</li>
          <li>证据引用仅指向本护照封存对象（点击定位，不跳当前 run）：</li>
          <li>
            <button type="button" id={`ref-input-${passport.passportId}`} className="link-btn" onClick={() => onLocateRef({ kind: 'input', passportId: passport.passportId, ref: passport.references.input, triggerId: `ref-input-${passport.passportId}` })}>
              输入快照 input（{passport.inputSnapshot.points.length} 桶）
            </button>
          </li>
          <li>
            候选引用：
            {passport.references.candidates.map((c) => (
              <button key={c.ref} type="button" id={`ref-cand-${passport.passportId}-${c.candidateId}`} className="link-btn" style={{ marginRight: 6 }} onClick={() => onLocateRef({ kind: 'candidate', passportId: passport.passportId, candidateId: c.candidateId, ref: c.ref, triggerId: `ref-cand-${passport.passportId}-${c.candidateId}` })}>
                {c.candidateId}
              </button>
            ))}
          </li>
          <li>
            复验引用：
            {passport.references.verifications.map((v) => (
              <button key={v.ref} type="button" id={`ref-verify-${passport.passportId}-${v.candidateId}`} className="link-btn" style={{ marginRight: 6 }} onClick={() => onLocateRef({ kind: 'verification', passportId: passport.passportId, candidateId: v.candidateId, ref: v.ref, triggerId: `ref-verify-${passport.passportId}-${v.candidateId}` })}>
                verify {v.candidateId}
              </button>
            ))}
          </li>
          <li>B01 复算/合法门仅作冻结结论展示，非防篡改证明</li>
        </ul>
      </details>

      <details>
        <summary>版本与记录</summary>
        <ul className="plain-list">
          <li>schema {passport.schema} · envelope v{passport.envelopeVersion} · passport {passport.passportVersion} · batchId {passport.batchId} · epoch {passport.epoch}</li>
          {passport.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      </details>

      <div className="toolbar">
        <button
          type="button"
          className="btn primary"
          onClick={() => downloadText(`${passport.passportId}.json`, exportPassportJson(passport))}
        >
          导出本护照 JSON（只读同一封存对象）
        </button>
      </div>
    </div>
  )
}

interface Props {
  mode: 'compare' | 'records'
  /** M29 · 由外部真实 passportId 定位（records 子页）：存在则选中，不存在/失效诚实反馈。 */
  initialPassportId?: string | null
  latest?: DecisionPassport | null
  persistFeedback?: string | null
  onOpenExecution?: OpenExecution
}

export default function PassportPanel({ mode, latest = null, persistFeedback = null, onOpenExecution, initialPassportId = null }: Props) {
  const [tick, setTick] = useState(0)
  const store = useMemo(() => loadPassportStore(), [tick])
  const all = useMemo(() => {
    const list = [...store.passports]
    if (latest && !list.some((p) => p.passportId === latest.passportId)) list.unshift(latest)
    return list
  }, [store, latest])
  const [selected, setSelected] = useState<string | null>(initialPassportId ?? latest?.passportId ?? null)
  const [evidenceTarget, setEvidenceTarget] = useState<EvidenceTarget | null>(null)
  const [refNotice, setRefNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!initialPassportId) return
    const list = loadPassportStore().passports
    if (list.some((x) => x.passportId === initialPassportId)) setSelected(initialPassportId)
    else setRefNotice('护照不存在或已失效：未定位（封存原文未改）。')
  }, [initialPassportId])
  const [pendingReturn, setPendingReturn] = useState<{ triggerId: string; scrollY: number } | null>(null)
  const returnScrollRef = useRef(0)
  const onLocateRef = (t: EvidenceTarget) => {
    const p = all.find((x) => x.passportId === selected) ?? all[0] ?? null
    if (!p) return
    const resolved = resolvePassportRef(p, t.ref)
    if (t.passportId !== p.passportId) { setRefNotice('引用不可用：该引用不属于当前护照，未定位（封存原文未改）。'); return }
    if (!resolved.found || resolved.kind !== t.kind) {
      setRefNotice('引用不可用：该引用不属于当前护照或对应对象缺失，未定位（封存原文未改）。')
      return
    }
    setRefNotice(null)
    returnScrollRef.current = (document.scrollingElement || document.documentElement).scrollTop
    setEvidenceTarget(t)
  }
  const onReturnRef = () => {
    const t = evidenceTarget
    if (!t) return
    // 先清 target（触发折叠/展开复原），待 DOM commit 后再恢复 trigger/滚位（不先滚后变布局）。
    setEvidenceTarget(null)
    setPendingReturn({ triggerId: t.triggerId, scrollY: returnScrollRef.current })
  }
  useLayoutEffect(() => {
    if (!pendingReturn) return
    const el = document.getElementById(pendingReturn.triggerId) as HTMLElement | null
    if (el) {
      el.focus?.({ preventScroll: true }); el.scrollIntoView?.({ block: 'center' })
      // 实际滚动容器：沿触发器祖先找 overflowY auto/scroll，兜底 scrollingElement。
      let sc: HTMLElement | null = el.parentElement
      while (sc) { const oy = getComputedStyle(sc).overflowY; if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight) break; sc = sc.parentElement }
      if (sc) sc.scrollTop = pendingReturn.scrollY
      else { const se = document.scrollingElement || document.documentElement; se.scrollTop = pendingReturn.scrollY }
    }
    setPendingReturn(null)
  }, [pendingReturn])
  // 目标 DOM 就绪后一次 scroll/focus（不盲 getElementById/setTimeout）。
  useLayoutEffect(() => {
    if (!evidenceTarget) return
    const id = evidenceTarget.kind === 'input' ? `input-${evidenceTarget.passportId}` : evidenceTarget.kind === 'candidate' ? `candidate-${evidenceTarget.passportId}-${evidenceTarget.candidateId}` : `verify-${evidenceTarget.passportId}-${evidenceTarget.candidateId}`
    const el = document.getElementById(id) as HTMLElement | null
    if (!el) return
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'center' })
  }, [evidenceTarget])

  useEffect(() => {
    setSelected(latest?.passportId ?? all[0]?.passportId ?? null)
    setEvidenceTarget(null); setRefNotice(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.passportId])

  const current = all.find((p) => p.passportId === selected) ?? all[0] ?? null
  const currentId = current?.passportId ?? null
  const selectPassport = (id: string | null) => { setSelected(id); setEvidenceTarget(null); setRefNotice(null); setPendingReturn(null) }
  useEffect(() => { /* 选择/最新变化当次废弃旧 target，不闪现旧态 */ setEvidenceTarget(null); setRefNotice(null); setPendingReturn(null) }, [selected, latest?.passportId])

  return (
    <section className="panel passport-panel" aria-label="决策护照">
      <div className="panel-head">
        <h3>决策护照（本地封存 · {mode === 'records' ? '记录页' : '本轮'}）</h3>
        <span className="tag warn">尚未授权执行 · 非认证</span>
      </div>
      {store.corrupted ? <p className="hint neg">存储损坏：已保留原文，只读展示，未持久化。</p> : null}
      <details className="passport-rule">
        <summary className="hint">护照口径</summary>
        <p className="hint">一次真实规划 = 一份不可变护照；重新生成即使内容相同也新 ID。结构化证据只指向封存护照内部对象，不解析当前 run。</p>
      </details>
      {store.warnings.length ? (
        <ul className="plain-list">
          {store.warnings.map((w, i) => <li key={i} className="hint neg">{w}</li>)}
        </ul>
      ) : null}
      {persistFeedback ? <p className="hint" role="status">{persistFeedback}</p> : null}

      {mode === 'compare' ? (
        latest ? (
          <div className="toolbar">
            <button
              type="button"
              className="btn primary"
              style={{ minHeight: 44 }}
              onClick={() => selectPassport(latest.passportId)}
            >
              打开本轮护照（{latest.passportId}）
            </button>
            <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setTick((t) => t + 1)}>
              刷新记录
            </button>
          </div>
        ) : (
          <p className="hint">生成本轮组合后即可在此打开本轮护照。</p>
        )
      ) : null}

      {mode === 'records' && all.length ? (
        <div className="passport-list">
          <ul className="plain-list">
            {all.map((p) => (
              <li key={p.passportId}>
                <button
                  type="button"
                  className="link-btn"
                  aria-pressed={selected === p.passportId}
                  onClick={() => selectPassport(p.passportId)}
                >
                  {p.generatedAt} · {p.scenarioLabel} · 尝试 {p.summary.attempted} / 合法 {p.summary.legal} ·
                  {' '}{p.status} · {p.passportId}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

            {refNotice ? <p className="hint neg" role="status">{refNotice}</p> : null}
      {current ? <PassportDetail key={currentId ?? 'none'} passport={current} onOpenExecution={onOpenExecution} evidenceTarget={evidenceTarget} onLocateRef={onLocateRef} onReturnRef={onReturnRef} /> : <p className="hint">暂无护照记录。</p>}
    </section>
  )
}
