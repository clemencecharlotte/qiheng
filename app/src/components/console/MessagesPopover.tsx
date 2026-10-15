import { useSyncExternalStore } from 'react'
import { consoleDataBus } from '../../integration/consoleDataBus'

/**
 * M10 · 消息入口：只读“当前已加载”的真实治理事件；无数据不造未读数/在线消息；
 * 不把合成 timeline 当服务事件。点击跳转真实治理事件子页。
 */
const TYPE_LABEL: Record<string, string> = {
  import_completed: '导入完成',
  rows_isolated: '隔离',
  rows_rejected: '拒绝',
  service_error: '服务错误',
}

export default function MessagesPopover({ onGovernance }: { onGovernance: (eventId: string) => void }) {
  const snap = useSyncExternalStore(consoleDataBus.subscribe, consoleDataBus.get, consoleDataBus.get)

  if (!snap || snap.status === 'loading') return <p className="topbar-pop-empty">读取中…</p>
  if (snap.status === 'unconfigured') {
    return <p className="topbar-pop-empty">只读数据服务未配置；不造未读数或在线消息。</p>
  }
  if (snap.status === 'error' || snap.status === 'offline') {
    return (
      <>
        <p className="topbar-pop-empty">{snap.status === 'offline' ? '只读数据服务离线。' : '治理事件读取错误。'}</p>
        <p className="topbar-pop-note">未接入实时推送；不造未读数或在线消息。</p>
      </>
    )
  }
  const events = snap.events.slice(0, 8)
  if (events.length === 0) {
    return (
      <>
        <p className="topbar-pop-empty">暂无真实治理事件。</p>
        <p className="topbar-pop-note">只读事件；离线批次，非实时。</p>
      </>
    )
  }
  return (
    <>
      <ul className="topbar-msg-list">
        {events.map((e) => (
          <li key={e.eventId}>
            <button type="button" className="topbar-msg-item" onClick={() => onGovernance(e.eventId)}>
              <span className={`qge-sev qge-sev-${e.severity}`}>{e.severity}</span>
              <span>{TYPE_LABEL[e.type] ?? e.type}</span>
              <span className="topbar-msg-src">{e.sourceId ?? '—'}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="topbar-pop-note">当前已加载范围（{events.length}/{snap.events.length}）；点击进入治理事件子页。</p>
    </>
  )
}
