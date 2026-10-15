/**
 * D07-r01 · StateEvidence——真实数据与服务状态的统一 presenter 组件。
 *
 * 真实接线合同（功能主线持有数据，本组件只接收 typed props）：
 * - state 五态 → label：unconfigured=未配置 / loading=读取中 / error=错误 /
 *   offline=离线 / ready=已加载。ready 恒为「已加载·最近批次」，组件在任何状态下
 *   都不渲染「在线 / live」字样——非实时批次不得宣称在线。
 * - reason 为实际原因，动态错误/拒绝始终呈现在明细（details）之外。
 * - source 三时间（来源观测/接收/心跳）分别呈现；null → 「未知」，绝不造 0 或日期。
 * - recent source 只是最近来源；「非全部来源」由宿主以 footnote 静态声明（角标收束）。
 * - 消息来自真实治理事件：empty/loading/error/ready 四态，不造未读红点/人数；
 *   消息错误同样呈现在 details 之外。
 * - retry 在 unconfigured/loading 禁用；其余状态可重试，回调语义由宿主定义
 *   （lab 中只改测试状态，不伪装服务恢复）。
 *
 * 视觉/交互（与 D06 r04 已接受语义一致）：
 * - 两种密度：dense=工具条紧凑摘要（一行）；默认=内容区卡（状态头 + 非模态 details 明细）。
 * - 数据文字实底（--pm-surface）；玻璃只留给宿主工具层（dense 版可挂 u-pm-glass）。
 * - 状态不只靠颜色：图标形状 + 文字 label + 边框语义。
 * - 明细用原生 details/summary（无模态、无 inert、无动画依赖；reduce 下天然可用）。
 * - 44 触达（retry 与 summary）；aria-live=polite 仅状态行；焦点可见。
 * - 时间戳原样呈现（mono/tabular-nums），不格式化不造。
 */
import { type ReactNode } from 'react'
// D07-r02 · 显式声明并加载已接受语义 token 层（D06 r04 ProductMaterial）：
// --pm-* 映射随组件走，避免宿主漏载导致空 token（r01 lab 实测白卡+暗 danger 对比 1.886）。
// 同时 StateEvidence.css 内含 .u-sev 独立作用域映射与正确 fallback，双保险。
import '../unified/ProductMaterial.css'
import './StateEvidence.css'

export type ConnectionStateKind = 'unconfigured' | 'loading' | 'error' | 'offline' | 'ready'

export interface SourceTimes {
  sourceId: string
  /** 来源侧观测时间（数据产生的真实时间戳；null = 未知） */
  sourceObservedAt: string | null
  /** 本侧接收时间（null = 未知） */
  receivedAt: string | null
  /** 心跳时间（null = 未知） */
  heartbeatAt: string | null
}

/** 时效判定由持有真实数据的宿主给出；presenter 只呈现，不自行取当前时间 */
export type SourceFreshness = 'fresh' | 'stale' | 'unknown'

export interface GovernanceMessage {
  id: string
  severity: 'info' | 'warn' | 'error'
  text: string
  /** 治理事件真实时间戳；null = 未知 */
  at: string | null
}

export type MessagesStatus = 'empty' | 'loading' | 'error' | 'ready'

export interface StateEvidenceProps {
  state: ConnectionStateKind
  /** 实际原因（动态错误/拒绝原文；呈现在 details 之外） */
  reason?: string | null
  /** 工具条紧凑摘要（一行，无明细区） */
  dense?: boolean
  /** 最近来源（recent source，不声明为全部来源） */
  source?: SourceTimes | null
  sourceFreshness?: SourceFreshness
  messages?: GovernanceMessage[]
  messagesStatus?: MessagesStatus
  /** 重试回调；unconfigured/loading 下禁用 */
  onRetry?: () => void
  /** 静态声明角标（如「仅最近来源，非全部来源」），收束于卡底小字 */
  footnote?: ReactNode
  /** 明细展开标题（非模态 details/summary） */
  detailSummary?: string
}

const STATE_LABEL: Record<ConnectionStateKind, string> = {
  unconfigured: '未配置',
  loading: '读取中',
  error: '错误',
  offline: '离线',
  ready: '已加载',
}

/** retry 禁用合同：未配置/读取中不可重试 */
export function retryDisabledFor(state: ConnectionStateKind): boolean {
  return state === 'unconfigured' || state === 'loading'
}

function StateIcon({ state }: { state: ConnectionStateKind }) {
  const cls = `u-sev__icon u-sev__icon--${state}`
  if (state === 'unconfigured') {
    return (
      <svg className={cls} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 3" />
      </svg>
    )
  }
  if (state === 'loading') {
    return (
      <svg className={cls} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="30 18" strokeLinecap="round" />
      </svg>
    )
  }
  if (state === 'error') {
    return (
      <svg className={cls} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M10 2.6 18 17H2Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M10 8v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="10" cy="14.6" r="0.9" fill="currentColor" />
      </svg>
    )
  }
  if (state === 'offline') {
    return (
      <svg className={cls} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M4.8 15.2 15.2 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg className={cls} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="m6.4 10.4 2.4 2.4 4.8-5.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TimeRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="u-sev__time-row">
      <dt>{label}</dt>
      <dd className={value === null ? 'u-sev__time-unknown' : 'u-sev__time-value'}>
        {value === null ? '未知' : <span className="u-sev__mono">{value}</span>}
      </dd>
    </div>
  )
}

function FreshnessMark({ freshness }: { freshness: SourceFreshness }) {
  if (freshness === 'stale') {
    return <span className="u-sev__fresh u-sev__fresh--stale">陈旧观测</span>
  }
  if (freshness === 'unknown') {
    return <span className="u-sev__fresh u-sev__fresh--unknown">时效未知</span>
  }
  return null // fresh：不标注（无徽标即当前）
}

export default function StateEvidence(props: StateEvidenceProps) {
  const {
    state,
    reason = null,
    dense = false,
    source = null,
    sourceFreshness,
    messages,
    messagesStatus = 'empty',
    onRetry,
    footnote,
    detailSummary = '来源与明细',
  } = props

  const disabled = retryDisabledFor(state)
  const messagesError = messagesStatus === 'error'

  // 动态错误/拒绝（连接错误 reason、消息错误）一律在 details 之外呈现。
  // r02：消息读取失败在 dense 密度同样可见（不静默隐藏动态错误）；
  // inline 重试与主 retry 同合同：unconfigured/loading 禁用（retryDisabledFor）。
  const urgent = (
    <>
      {reason ? <p className={`u-sev__reason u-sev__reason--${state}`}>{reason}</p> : null}
      {messagesError ? (
        <div className="u-sev__msg-error" role="status">
          <span>治理事件读取失败</span>
          {onRetry ? (
            <button
              type="button"
              className="u-sev__retry u-sev__retry--inline"
              onClick={onRetry}
              disabled={disabled}
              aria-disabled={disabled || undefined}
            >
              重试读取
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  )

  if (dense) {
    return (
      <div className={`u-sev u-sev--dense u-sev--${state}`}>
        <p className="u-sev__line" role="status" aria-live="polite">
          <StateIcon state={state} />
          <span className="u-sev__label">{STATE_LABEL[state]}</span>
          {state === 'ready' ? <span className="u-sev__batch">最近批次</span> : null}
          {onRetry ? (
            <button type="button" className="u-sev__retry" onClick={onRetry} disabled={disabled} aria-disabled={disabled || undefined}>
              重试
            </button>
          ) : null}
        </p>
        {/* r02：dense 的 reason 独立成第二行，完整可见（桌面不再截断） */}
        {reason ? <p className="u-sev__reason-inline">{reason}</p> : null}
        {messagesError ? (
          <div className="u-sev__msg-error" role="status">
            <span>治理事件读取失败</span>
            {onRetry ? (
              <button
                type="button"
                className="u-sev__retry u-sev__retry--inline"
                onClick={onRetry}
                disabled={disabled}
                aria-disabled={disabled || undefined}
              >
                重试读取
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <section className={`u-sev u-sev--${state}`} aria-label="数据与服务状态">
      <header className="u-sev__head">
        <p className="u-sev__line" role="status" aria-live="polite">
          <StateIcon state={state} />
          <span className="u-sev__label">{STATE_LABEL[state]}</span>
          {state === 'ready' ? <span className="u-sev__batch">最近批次</span> : null}
        </p>
        {onRetry ? (
          <button type="button" className="u-sev__retry" onClick={onRetry} disabled={disabled} aria-disabled={disabled || undefined}>
            重试
          </button>
        ) : null}
      </header>
      {urgent}
      <details className="u-sev__detail">
        <summary className="u-sev__summary">{detailSummary}</summary>
        <div className="u-sev__detail-body">
          {source ? (
            <div className="u-sev__source">
              <div className="u-sev__source-id">
                <dt>来源</dt>
                <dd>
                  <span className="u-sev__mono u-sev__mono--break">{source.sourceId}</span>
                  <FreshnessMark freshness={sourceFreshness ?? 'unknown'} />
                </dd>
              </div>
              <TimeRow label="来源观测" value={source.sourceObservedAt} />
              <TimeRow label="接收时间" value={source.receivedAt} />
              <TimeRow label="心跳时间" value={source.heartbeatAt} />
            </div>
          ) : null}
          <div className="u-sev__messages">
            <h3 className="u-sev__messages-h">治理事件</h3>
            {messagesStatus === 'empty' ? <p className="u-sev__msg-empty">暂无治理事件——该层只接入真实事件流。</p> : null}
            {messagesStatus === 'loading' ? <p className="u-sev__msg-loading">治理事件读取中。</p> : null}
            {messagesStatus === 'ready' && (messages?.length ?? 0) === 0 ? (
              <p className="u-sev__msg-empty">暂无治理事件——该层只接入真实事件流。</p>
            ) : null}
            {messagesStatus === 'ready' && messages && messages.length > 0 ? (
              <ul className="u-sev__msg-list">
                {messages.map((m) => (
                  <li key={m.id} className={`u-sev__msg u-sev__msg--${m.severity}`}>
                    <span className="u-sev__msg-text">{m.text}</span>
                    <span className="u-sev__msg-at u-sev__mono">{m.at ?? '未知'}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </details>
      {footnote ? <p className="u-sev__footnote">{footnote}</p> : null}
    </section>
  )
}
