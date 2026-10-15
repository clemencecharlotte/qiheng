import GovernanceEventsPanel, { type GovernanceQuery } from '../components/GovernanceEventsPanel'

/**
 * M10 r04 · 事件 →「治理事件」子页。
 * 只读真实存储事件；受控查询/对象定位经 canonical route（唯一写入方在 App），
 * 支持 Back/Forward/refresh 与同页参数移除；选择回写 URL eventId。
 */
export default function GovernanceWorkspace({
  query,
  initialEventId = null,
  onQueryChange,
  onLocate,
  onOpenBatch,
}: {
  query?: Partial<GovernanceQuery>
  initialEventId?: string | null
  onQueryChange?: (patch: Partial<GovernanceQuery>) => void
  onLocate?: (eventId: string | null) => void
  onOpenBatch?: (batchId: string) => void
}) {
  return (
    <div className="workspace">
      <section className="panel">
        <div className="panel-head">
          <h2>治理事件</h2>
          <span className="hint">真实存储的导入/隔离/拒绝/服务错误</span>
        </div>
        <GovernanceEventsPanel
          query={query}
          initialEventId={initialEventId}
          onQueryChange={onQueryChange}
          onLocate={onLocate}
          onOpenBatch={onOpenBatch}
        />
      </section>
    </div>
  )
}
