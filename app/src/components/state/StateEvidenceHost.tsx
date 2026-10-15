import { useSyncExternalStore } from 'react'
import { consoleDataBus } from '../../integration/consoleDataBus'
import StateEvidence, {
  type ConnectionStateKind,
  type GovernanceMessage,
  type SourceTimes,
} from './StateEvidence'
import { deriveSourceFreshness } from './freshness'

/**
 * M12 · StateEvidence 真实数据宿主（D07r02 presenter 迁移后的真实接线）。
 * 只从 consoleDataBus 的已加载只读快照映射：state/三时间/reason/治理消息/retry。
 * 观测时效必须基于 sourceObservedAt（心跳只列服务状态，不冒充观测新鲜）。
 * null 未知不造值；不造 online 消息；不复制 lab 固定合成数据进真实服务。
 */
const STALE_MS = 15 * 60 * 1000

export default function StateEvidenceHost({ now = Date.now }: { now?: () => number }) {
  const snap = useSyncExternalStore(consoleDataBus.subscribe, consoleDataBus.get, () => null)
  if (!snap) return null

  const state = snap.status as ConnectionStateKind
  const ss = snap.sourceState
  const source: SourceTimes | null = ss
    ? {
        sourceId: ss.sourceId,
        sourceObservedAt: ss.sourceObservedAt ?? null,
        receivedAt: ss.receivedAt ?? null,
        heartbeatAt: ss.heartbeatAt ?? null,
      }
    : null

  // 观测时效：只用 sourceObservedAt；heartbeatAt 不在时效里消费（另列于三时间）。
  const freshness = deriveSourceFreshness(ss?.sourceObservedAt ?? null, now(), STALE_MS)

  const messages: GovernanceMessage[] = (snap.events ?? []).slice(0, 8).map((e) => ({
    id: e.eventId,
    severity: e.severity,
    text: `${e.type}${e.detail ? ` · ${e.detail}` : ''}`,
    at: e.receivedAt ?? null,
  }))
  const messagesStatus =
    snap.status === 'loading' ? 'loading'
      : snap.status === 'error' || snap.status === 'offline' ? 'error'
        : messages.length > 0 ? 'ready' : 'empty'

  return (
    <StateEvidence
      state={state}
      reason={snap.reason}
      source={source}
      sourceFreshness={freshness}
      messages={messages}
      messagesStatus={messagesStatus}
      onRetry={() => consoleDataBus.requestRefresh()}
      detailSummary="最近来源与治理事件"
      footnote={<>最近来源 {source?.sourceId ?? '未知'}，非全部来源</>}
    />
  )
}
