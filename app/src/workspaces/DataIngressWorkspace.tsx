import DataIngressPanel from '../components/DataIngressPanel'
import { type EventSeverityParam, type EventTypeParam } from '../domain/router'

/** 受限返回来源：仅从治理事件页跳来时的上下文（不是自由 returnURL）。 */
export interface GovernanceOrigin {
  sourceId: string | null
  eventId: string | null
  type: EventTypeParam | null
  severity: EventSeverityParam | null
  offset: number | null
}

/**
 * M10 r05 · 回放证据 →「数据接入」子页。
 * 离线批次导入与记录级治理；不借回放钟/播放器，不触发调度/批准。
 * 受控对象定位：URL batchId（bounded）恢复选择；选择变化回写 URL。
 * 受限来源：真实、已校验的治理 origin 存在时，标题右侧提供“返回治理事件”。
 */
export default function DataIngressWorkspace({
  initialBatchId = null,
  governanceOrigin = null,
  onLocate,
  onImported,
  onOpenEvents,
  onReturnToGovernance,
}: {
  initialBatchId?: string | null
  governanceOrigin?: GovernanceOrigin | null
  onLocate?: (batchId: string | null) => void
  onImported?: () => void
  onOpenEvents?: (sourceId: string) => void
  onReturnToGovernance?: () => void
}) {
  return (
    <div className="workspace">
      <section className="panel">
        <div className="panel-head">
          <h2>数据接入</h2>
          {governanceOrigin && onReturnToGovernance ? (
            <button
              type="button"
              className="qh-history-jump"
              data-testid="qdi-return-governance"
              onClick={onReturnToGovernance}
            >
              返回治理事件
            </button>
          ) : null}
        </div>
        <DataIngressPanel
          initialBatchId={initialBatchId}
          onLocate={onLocate}
          onImported={onImported}
          onOpenEvents={onOpenEvents}
        />
      </section>
    </div>
  )
}
