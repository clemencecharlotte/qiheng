/**
 * M25 B · 统一状态语义徽标：color + icon + 短文字 三者等价（色盲/低对比可辨）。
 * 运行/待机/停止、正常/注意/严重、未知/陈旧/断链/禁用 分别语义；**unknown 不绿、selected 不作 running**。
 * 消费既有 role token（--success/--warning/--danger/--muted/--brand），不套第三层玻璃；light/dark/六环境可读。
 */
import './statusBadge.css'

export type StatusTone = 'running' | 'idle' | 'stopped' | 'normal' | 'warn' | 'severe' | 'unknown' | 'stale' | 'disconnected' | 'disabled'

const SHORT: Record<StatusTone, string> = {
  running: '运行', idle: '待机', stopped: '停止',
  normal: '正常', warn: '注意', severe: '严重',
  unknown: '未知', stale: '陈旧', disconnected: '断链', disabled: '未启用',
}

function Icon({ tone }: { tone: StatusTone }) {
  if (tone === 'running') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>
  if (tone === 'idle') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14" /></svg>
  if (tone === 'stopped') return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
  if (tone === 'normal') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4 10-10" /></svg>
  if (tone === 'warn' || tone === 'severe') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z" /><path d="M12 10v5M12 17.5v.5" /></svg>
  if (tone === 'disconnected') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M12 4v9M6 8a8 8 0 0 0 12 0" /></svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4M12 15.5v.5" /></svg>
}

/** 由真实状态文本推导 tone（不按类别；安全审查也可能通过、调度也可能拒绝）。 */
export function statusTone(status: string): StatusTone {
  const t = status || ''
  if (/无效|拒绝|无解|错误|失败|超界|不通/.test(t)) return 'severe'
  if (/待复核|需关注|隔离|陈旧|离线|告警/.test(t)) return 'warn'
  if (/通过|可行|提示|正常|完成/.test(t)) return 'normal'
  return 'unknown'
}

export default function StatusBadge({ tone, label, className = '' }: { tone: StatusTone; label?: string; className?: string }) {
  return (
    <span className={`u-status u-status--${tone} ${className}`} data-status={tone}>
      <span className="u-status__icon"><Icon tone={tone} /></span>
      <span className="u-status__text">{label ?? SHORT[tone]}</span>
    </span>
  )
}
