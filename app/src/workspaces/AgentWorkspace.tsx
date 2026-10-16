import { useEffect, useMemo, useRef, useState } from 'react'
import { loadPassportStore } from '../domain/passport'
import { buildHistoryFixture, FIXED_HISTORY_SEED } from '../domain/history'
import { aggregateQuality } from '../domain/quality'
import { assessHealth } from '../domain/health'
import { runHistoryChain, runScheduleChain } from '../domain/chain'
import { detectNarratorConfig } from '../domain/narrator'
import { buildScheduleSnapshot, buildHistorySnapshot } from '../integration/agent/build-snapshot.mjs'
import { RequestCoordinator } from '../integration/agent/request-coordinator.mjs'
import { fetchAgentResource, fetchAgentResources, fetchAgentStatus, fetchAgentTools, type AgentResourceMeta, type AgentStatus, type AgentToolMeta } from '../integration/agentClient'
import type { AgentViewSnapshot } from '../integration/evidenceReturn'
import type { HistoryFixture } from '../domain/history'
import { type QaView } from '../components/QaPanel'
import ChatConsole from '../components/ChatConsole'
import { Popover } from '../components/ui/Disclosure'
import '../styles/agent-chat.css'
import type { ScenarioRun } from '../domain/engine'
import type { EvidenceContext, EvidenceWorkspace } from '../domain/evidence'
import type { ApprovalDecision, ScenarioId } from '../domain/types'
import type { NarratedAnswer } from '../domain/narrator'

/**
 * M29 r17 · 智能体独立工作区：正规 MCP gateway + 用户可读结果 + 会话经唯一 sessionNav entry 恢复。
 */

interface Props {
  run: ScenarioRun
  scenario: ScenarioId
  scenarioLabel: string
  runIdentity: string
  fixtureId: string
  observationIndex: number
  observationLabel: string
  /** M29 r22 · 历史分源：真实夹具与历史时钟（与调度源不混）。 */
  historyFixture: HistoryFixture
  historyStartMinute: number
  historyBucketMinutes: number
  historyObservationIndex: number
  historyObservationLabel: string
  currentDecision?: ApprovalDecision | null
  decisionEventId?: string | null
  initialAgentView?: AgentViewSnapshot | null
  onAgentViewChange?: (v: Omit<AgentViewSnapshot, 'runIdentity'>) => void
  onJump: (workspace: EvidenceWorkspace, target: string, originId?: string) => void
  onOpenPassport?: (passportId: string, originId?: string) => void
  /** M29 r27 · 显式返回原会话（走 App 现有返回治理，非新导航栈）。 */
  onBack?: () => void
  /** M29 r30 · 窗口引用按真实 bucket 边界 a/b + source/t 定位。 */
  onOpenWindow?: (source: 'synthetic_schedule' | 'synthetic_history', a: number, b: number, originId: string) => void
  onAnswered?: (question: string, answer: NarratedAnswer) => void
  /** r44 E · 聊天会话快照（App 唯一 entry 捕获/恢复）。 */
  view?: QaView | null
  onViewChange?: (v: QaView | null) => void
}

interface RefView { kind: string; id?: string; source?: string; startMinute?: number; endMinute?: number }
interface ToolView {
  name: string
  state: string
  code?: string
  httpStatus?: number
  data: unknown
  refs: RefView[]
  protocol?: string
  requestId?: string
  snapshotHash?: string
}

const TOOL_LABEL: Record<string, string> = {
  get_device_constraints: '查设备与约束',
  get_time_window: '查指定时间窗',
  get_passport_evidence: '查决策/护照证据',
}
const STATE_LABEL: Record<string, string> = {
  ok: '成功', invalid: '参数或快照不合法（可修正后重试）', not_found: '未找到该对象（无数据）',
  denied: '未授权（服务端白名单/对象权限拒绝）', timeout: '超时（可重试）', cancelled: '已取消',
  superseded: '已被新请求取代', failed: '失败（服务不可达或响应异常）', unavailable: '服务不可用（gateway 未接）',
  running: '执行中', idle: '空闲',
}
function fmtData(data: unknown): Array<[string, string]> {
  if (data === null || data === undefined) return []
  if (typeof data === 'object' && !Array.isArray(data)) {
    return Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])
  }
  return [['值', JSON.stringify(data)]]
}

export default function AgentWorkspace({
  run, scenario, scenarioLabel, runIdentity, fixtureId, observationIndex, observationLabel,
  historyFixture, historyStartMinute, historyBucketMinutes, historyObservationIndex, historyObservationLabel,
  currentDecision, decisionEventId, initialAgentView, onAgentViewChange, onJump, onOpenPassport, onBack, onOpenWindow, onAnswered,
  view = null, onViewChange,
}: Props) {
  const [source, setSource] = useState<'schedule' | 'history'>(initialAgentView?.sourceMode ?? 'schedule')
  const narratorConfig = useMemo(() => detectNarratorConfig(), [])
  const qtCtx = useMemo<EvidenceContext>(() => {
    const fixture = buildHistoryFixture(fixtureId, FIXED_HISTORY_SEED)
    const quality = aggregateQuality(fixture)
    const health = assessHealth(fixture)
    return { run, normalRun: run, quality, health, scheduleChain: runScheduleChain({ scenario, scenarioLabel, run }), historyReview: runHistoryChain({ fixture, quality, health }), fixture, scenarioLabel }
  }, [run, scenario, scenarioLabel, fixtureId])
  const safetyAllowsApproval = qtCtx.scheduleChain.safety.verdict === 'allow'

  const [agent, setAgent] = useState<AgentStatus | null>(null)
  const [tools, setTools] = useState<AgentToolMeta[]>([])
  const [resources, setResources] = useState<AgentResourceMeta[]>([])
  const [resourceUri, setResourceUri] = useState<string | null>(initialAgentView?.resourceUri ?? null)
  const [resourceText, setResourceText] = useState<string | null>(initialAgentView?.resourceText ?? null)
  const [resourceTitle, setResourceTitle] = useState<string | null>(initialAgentView?.resourceTitle ?? null)
  const passports = useMemo(() => loadPassportStore().passports, [])
  const scheduleMinute = run.series.points[observationIndex]?.minuteOfDay ?? 0
  const historyMinute = historyStartMinute + historyObservationIndex * historyBucketMinutes
  const isHistory = source === 'history'
  const step = isHistory ? historyBucketMinutes : (run.series.stepMinutes || 15)
  const baseMinute = isHistory ? historyMinute : scheduleMinute
  const [deviceId, setDeviceId] = useState(initialAgentView?.deviceId ?? run.allUnits[0]?.id ?? 'AC-01')
  const [winStart, setWinStart] = useState(initialAgentView?.winStart ?? baseMinute)
  const [winEnd, setWinEnd] = useState(initialAgentView?.winEnd ?? baseMinute + step * 3)
  const [passportIdInput, setPassportIdInput] = useState(initialAgentView?.passportId ?? passports[0]?.passportId ?? '')
  const [result, setResult] = useState<ToolView | null>((initialAgentView?.result as ToolView | null) ?? null)
  const frozenRef = useRef<unknown | null>(initialAgentView?.frozenSnapshot ?? null)
  const coordinator = useRef<RequestCoordinator | null>(null)
  if (!coordinator.current) coordinator.current = new RequestCoordinator()
  const dev = useRef<HTMLElement | null>(null)

  const buildSnapshot = () => isHistory
    ? buildHistorySnapshot({ fixture: historyFixture as never, observationMinute: historyMinute, passports })
    : buildScheduleSnapshot({ run, scenario, observationMinute: scheduleMinute, passports })
  // 切源：清冻结，避免两源快照混用。**挂载恢复时不清**（否则 Back 回来 frozen/结果被清 → 串源假象）。
  const prevSourceRef = useRef(source)
  useEffect(() => {
    if (prevSourceRef.current !== source) {
      prevSourceRef.current = source
      frozenRef.current = null
      setResult(null)
      // 来源切换：窗口/设备按该源合法时域初始化，避免沿用旧源窗口 → not_found。
      const nextStart = source === 'history' ? historyMinute : scheduleMinute
      setWinStart(nextStart)
      setWinEnd(nextStart + (source === 'history' ? historyBucketMinutes : (run.series.stepMinutes || 15)) * 3)
      setDeviceId((source === 'history' ? historyFixture.machines[0]?.id : run.allUnits[0]?.id) ?? '')
    }
  }, [source])
  // 合法时域（分钟）：调度 0..末时段；回放 起点..起点+minuteCount-1。
  const legalRange = () => isHistory
    ? { lo: historyStartMinute, hi: historyStartMinute + historyFixture.minuteCount - 1 }
    : { lo: 0, hi: run.series.points[run.series.points.length - 1]?.minuteOfDay ?? 0 }

  useEffect(() => {
    const ac = new AbortController()
    void fetchAgentStatus(ac.signal).then(setAgent)
    void fetchAgentTools(ac.signal).then(setTools)
    void fetchAgentResources(ac.signal).then(setResources)
    return () => { ac.abort(); coordinator.current?.cancel() }
  }, [])

  // 回报会话快照（结果/冻结/输入/资源），供唯一 entry 捕获与恢复。
  useEffect(() => {
    onAgentViewChange?.({ result, frozenSnapshot: frozenRef.current, sourceMode: source, deviceId, winStart, winEnd, passportId: passportIdInput, resourceUri, resourceTitle, resourceText })
  }, [result, deviceId, winStart, winEnd, passportIdInput, resourceUri, resourceTitle, resourceText])

  // 设备目录/窗口随来源切换的最小约束：调度源仅列 AC 机组（本轮工具为调度源）。
  const unitOptions = useMemo(
    () => (isHistory ? historyFixture.machines.map((m) => ({ id: m.id, name: m.name })) : run.allUnits.map((u) => ({ id: u.id, name: u.name }))),
    [isHistory, historyFixture, run],
  )

  const callTool = async (name: string, args: Record<string, unknown>) => {
    if (name === 'get_time_window') {
      const { lo, hi } = legalRange()
      const a = Number(args.startMinute), b = Number(args.endMinute)
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || a < lo || b > hi) {
        setResult({ name, state: 'invalid', code: 'RANGE', data: { 合法区间: `${lo}–${hi} 分钟（${isHistory ? '回放' : '调度'}源）`, 收到: `${args.startMinute}–${args.endMinute}` }, refs: [] })
        return
      }
    }
    try {
      if (!frozenRef.current) frozenRef.current = buildSnapshot()
      setResult({ name, state: 'running', data: null, refs: [] })
      const r = await coordinator.current!.query(name, args, frozenRef.current as never)
      const res = (r.result ?? {}) as { status?: string; code?: string; data?: unknown; references?: RefView[]; provenance?: { snapshotHash?: string }; protocol?: string; requestId?: string }
      setResult({
        name,
        state: (res.status ?? r.status ?? 'failed'),
        code: res.code,
        httpStatus: r.httpStatus,
        data: res.data ?? null,
        refs: res.references ?? [],
        protocol: res.protocol,
        requestId: res.requestId,
        snapshotHash: res.provenance?.snapshotHash,
      })
    } catch (e) {
      setResult({ name, state: 'failed', code: 'CLIENT_EXCEPTION', data: String((e as Error)?.message ?? 'unknown'), refs: [] })
    }
  }

  const agentRefId = (ref: RefView, i: number) => `agent-ref-${ref.kind}-${ref.id ?? ref.startMinute ?? i}`
  const refToNav = (ref: RefView, originId: string) => {
    if (ref.kind === 'device' && ref.id) onJump('schedule', `unit:${ref.id}`, originId)
    else if (ref.kind === 'passport' && ref.id) onOpenPassport?.(ref.id, originId)
    else if (ref.kind === 'window') {
      const isHist = ref.source === 'synthetic_history'
      const lo = isHist ? historyStartMinute : 0
      const stepM = isHist ? historyBucketMinutes : (run.series.stepMinutes || 15)
      const a = Math.max(0, Math.floor(((ref.startMinute ?? lo) - lo) / stepM))
      const b = Math.max(a, Math.floor(((ref.endMinute ?? (ref.startMinute ?? lo)) - lo) / stepM))
      const src = isHist ? 'synthetic_history' : 'synthetic_schedule'
      if (onOpenWindow) onOpenWindow(src, a, b, originId)
      else onJump(isHist ? 'history' : 'schedule', isHist ? `bucket:${ref.id ?? 'STATION'}:${a}` : `period:${a}`, originId)
    }
  }

  const rowsOf = (data: unknown): Array<Record<string, unknown>> | null => {
    const rows = (data as { rows?: unknown })?.rows
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : null
  }
  const mcpState = agent?.mcp?.state
  const modelState = agent?.provider?.state ?? (narratorConfig.status === 'enabled' ? 'configured' : 'not_connected')

  const drawerContent = (
    <>
      <div className="toolbar">
        <label className="field"><span>来源</span>
          <select value={source} onChange={(e) => { setSource(e.target.value as 'schedule' | 'history'); setDeviceId((e.target.value === 'history' ? historyFixture.machines[0]?.id : run.allUnits[0]?.id) ?? '') }}>
            <option value="schedule">合成调度</option>
            <option value="history">合成回放</option>
          </select>
        </label>
        <span className="hint">{isHistory ? `观察 ${historyObservationLabel} · 回放夹具` : `观察 ${observationLabel} · 调度场景`}</span>
      </div>
      <div className="toolbar">
        <label className="field"><span>设备</span>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {unitOptions.map((u) => <option key={u.id} value={u.id}>{u.id} {u.name}</option>)}
            <option value="AC-99">AC-99（未知对象 · 测试）</option>
          </select>
        </label>
        <button type="button" className="btn" onClick={() => void callTool('get_device_constraints', { unitId: deviceId })}>{TOOL_LABEL.get_device_constraints}</button>
      </div>
      <div className="toolbar">
        <label className="field"><span>起始分钟</span><input type="number" min={0} value={winStart} onChange={(e) => setWinStart(Number(e.target.value))} /></label>
        <label className="field"><span>结束分钟</span><input type="number" min={0} value={winEnd} onChange={(e) => setWinEnd(Number(e.target.value))} /></label>
        <button type="button" className="btn" onClick={() => void callTool('get_time_window', { startMinute: winStart, endMinute: winEnd })}>{TOOL_LABEL.get_time_window}</button>
      </div>
      <div className="toolbar">
        <label className="field"><span>护照（本地封存）</span>
          <select value={passportIdInput} onChange={(e) => setPassportIdInput(e.target.value)} disabled={passports.length === 0}>
            {passports.length === 0 ? <option value="">无本地护照（需先封存）</option> : null}
            {passports.map((pp) => <option key={pp.passportId} value={pp.passportId}>{pp.passportId}</option>)}
            <option value="qp-absent">qp-absent（不存在 · 测试）</option>
          </select>
        </label>
        <button type="button" className="btn" disabled={!passportIdInput} onClick={() => void callTool('get_passport_evidence', { passportId: passportIdInput })}>{TOOL_LABEL.get_passport_evidence}</button>
        <button type="button" className="btn ghost" onClick={() => { coordinator.current?.cancel(); setResult((r) => r ? { ...r, state: 'cancelled' } : r) }}>取消</button>
        <button type="button" className="btn ghost" onClick={() => { frozenRef.current = buildSnapshot() }}>冻结本次快照</button>
      </div>
      {result ? (
        <div className={`agent-tool-result state-${result.state}`} role="status" data-testid="agent-tool-result">
          <div className="agent-tool-head">
            <b>{TOOL_LABEL[result.name] ?? result.name}</b>
            <span className={`tag ${result.state === 'ok' ? 'ok' : 'muted'}`}>{STATE_LABEL[result.state] ?? result.state}</span>
            {result.code ? <span className="hint">code {result.code}</span> : null}
          </div>
          {(() => {
            const rows = rowsOf(result.data)
            if (rows) {
              const step = (result.data as { stepMinutes?: number })?.stepMinutes
              const nulls = rows.filter((r) => r.flow == null || r.power == null).length
              return (
                <>
                  <p className="agent-summary">共 {rows.length} 行 · 粒度 {step ?? '—'} 分钟{nulls ? ` · 含 ${nulls} 行缺值（null 未补零）` : ''}</p>
                  <details className="agent-rows">
                    <summary>原始数据（{rows.length} 行）</summary>
                    <div className="agent-table-wrap">
                      <table className="period-table">
                        <thead><tr><th>分钟</th><th>机组</th><th>流量</th><th>功率</th><th>质量</th></tr></thead>
                        <tbody>
                          {rows.map((r, ri) => (
                            <tr key={ri}><td className="mono">{String(r.minute)}</td><td className="mono">{r.unitId ? String(r.unitId) : '站级'}</td><td className="mono">{r.flow == null ? '缺值' : String(r.flow)}</td><td className="mono">{r.power == null ? '缺值' : String(r.power)}</td><td>{String(r.quality ?? '—')}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )
            }
            return fmtData(result.data).length ? (
              <dl className="agent-tool-data">
                {fmtData(result.data).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
            ) : <p className="hint">无数据返回。</p>
          })()}
          {result.refs.length ? (
            <ul className="plain-list agent-refs">
              {result.refs.map((r, ri) => <li key={ri}><button type="button" id={agentRefId(r, ri)} className="btn" onClick={(e) => refToNav(r, e.currentTarget.id)}>定位 {r.kind}{r.id ? ` ${r.id}` : ''} →</button></li>)}
            </ul>
          ) : null}
          <Popover label="技术字段" ariaLabel="工具调用技术字段">
            <div className="source-details-body">
              <p>HTTP {result.httpStatus ?? '—'} · code {result.code ?? '—'} · protocol {result.protocol ?? '—'}</p>
              <p>requestId {result.requestId ?? '—'} · snapshotHash {result.snapshotHash ?? '—'} · certified=false</p>
            </div>
          </Popover>
        </div>
      ) : <p className="hint">以上为真实只读工具查询（非LLM聊天）；结果以消息内可展开结构呈现。</p>}
      <details>
        <summary>项目资料（{resources.length} 篇只读文档）</summary>
        <ul className="plain-list">
          {resources.length ? resources.map((r) => (
            <li key={r.uri}><button type="button" className="link-btn" onClick={() => void fetchAgentResource(r.uri).then((t) => { setResourceUri(r.uri); setResourceText(t); setResourceTitle(r.title ?? r.name ?? r.uri) })}>{r.title ?? r.name ?? r.uri}</button></li>
          )) : <li className="hint">资料未接（gateway 未联通）。</li>}
        </ul>
        {resourceText ? (
          <div className="agent-resource">
            <h4>{resourceTitle ?? '文档'}</h4>
            {resourceText.split('\n').map((line, li) => line.trim() === '' ? null : line.startsWith('#') ? <h5 key={li}>{line.replace(/^#+\s*/, '')}</h5> : <p key={li}>{line}</p>)}
          </div>
        ) : null}
      </details>
      <details>
        <summary>协议与边界</summary>
        <div className="source-details-body">
          <p>经同源 gateway → 正规 MCP SDK client → 独立 stdio server 调用；三只读工具。</p>
          <p>快照来自浏览器（client_snapshot, certified:false）；工具不读任意文件 / 不转发 url / 不批准 / 不启停。</p>
        </div>
      </details>
      {onBack ? <button type="button" className="btn ghost" onClick={onBack}>← 返回原会话</button> : null}
    </>
  )

  return (
    <div className="workspace agent-workspace" data-page="console" ref={(el) => { dev.current = el }}>
      <ChatConsole
        ctx={qtCtx}
        scenarioLabel={scenarioLabel}
        narratorConfig={narratorConfig}
        narratorTransport={null}
        safetyAllowsApproval={safetyAllowsApproval}
        currentDecision={currentDecision}
        decisionEventId={decisionEventId}
        runIdentity={runIdentity}
        onJump={onJump}
        onAnswered={onAnswered ?? (() => {})}
        view={view}
        onViewChange={onViewChange ?? (() => {})}
        statusTag={(
          <span className={`tag ${mcpState === 'available' ? 'ok' : 'muted'}`} data-testid="agent-model-status">
            模型{modelState === 'configured' ? '已配置' : '未连接'} · {mcpState === 'available' ? `工具 ${tools.length || 3} 项可用` : '工具待连接'}
          </span>
        )}
        drawerContent={drawerContent}
      />
    </div>
  )
}
