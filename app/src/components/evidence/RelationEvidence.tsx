import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { consoleDataBus } from '../../integration/consoleDataBus'
import {
  buildRelations,
  layoutRelations,
  neighborsOf,
  subgraphFor,
  DOMAIN_KIND_COVERAGE,
  RELATION_KIND_COVERAGE,
  GRAPH_NODE_W,
  GRAPH_NODE_H,
  type DomainSnapshot,
  type RelationKind,
  type RelationNode,
} from '../../integration/relations'
import NoteRef from '../console/NoteRef'
import { Popover } from '../ui/Disclosure'
import { fitGraphLayout } from './mapFitLayout'
import './relationEvidence.css'
// A-10 · MAP fit 画布 / 来源与范围弹层 / 未选节点可读下限。仅本组件 import，不改共享 css。
import '../../styles/map-fit.css'

/**
 * M19 · R6 关联证据（首落 schedule/evidence）。
 * 只读：真实来源/批次/治理事件（只读 API）+ 域内合成证据（设备资格/候选/独立复验/安全审查，
 * 由宿主 run 显式只读派生）。确定性关系图（节点真实稳定 ID、边仅来自已存 ID 引用，不造推测边）；
 * 列表保为手机/键盘等价；分类/选中/邻域 1–2 层/恢复视图/详情与真实证据跳转返回上下文。
 * 无证据不连、不造在线事件/第三层 URL。
 */
const KIND_LABEL: Record<RelationKind, string> = {
  source: '来源', batch: '批次', event: '事件', device: '机组',
  pipeline: '母管/支路（示意）', candidate: '候选', verifier: '复验', passport: '护照', safety: '安全审查',
}
const SEMANTIC_LABEL: Record<string, string> = { dependency: '依赖', verification: '验证', authorization: '授权', impact: '影响' }
const FILTER_KINDS: Array<'all' | RelationKind> = ['all', 'source', 'batch', 'event', 'device', 'pipeline', 'candidate', 'verifier', 'passport', 'safety']

export default function RelationEvidence({
  onOpenBatch,
  onOpenEvent,
  onOpenSource,
  onOpenDevice,
  onOpenPassport,
  filter: filterProp,
  kinds,
  selected: selectedProp,
  onFilterChange,
  onSelect,
  domain,
  depth: depthProp,
  onDepthChange,
  fitViewport,
}: {
  onOpenBatch?: (batchId: string) => void
  onOpenEvent?: (eventId: string) => void
  onOpenSource?: (sourceId: string) => void
  /** M29 · MAP：打开设备真实约束/证据目的地（复用宿主 unit:<id> 定位）。 */
  onOpenDevice?: (unitId: string) => void
  /** M29 r25 · 打开本地已封存护照（真实 passportId）。 */
  onOpenPassport?: (passportId: string, originId?: string) => void
  /** 受控上下文（宿主持有，路由中立）：返回 evidence 时恢复筛选/选中。 */
  filter?: 'all' | RelationKind
  /** M29 r20 · MAP 多类视角：仅显示这些 kind（与 filter 二选一，优先 kinds）。 */
  kinds?: RelationKind[]
  selected?: string | null
  onFilterChange?: (f: 'all' | RelationKind) => void
  onSelect?: (id: string | null) => void
  /** 域内合成证据快照（只读；缺省则仅只读 API 对象）。 */
  domain?: DomainSnapshot
  /** M25 r05 ② · 受控邻域深度（宿主管理，供返回快照捕获/恢复）。 */
  depth?: 1 | 2
  onDepthChange?: (d: 1 | 2) => void
  /**
   * A-10 · MAP 视图 fit（默认关；未开启的宿主表现逐像素不变）。
   * 把只读布局的列/行序归一到实测画布宽度（首列贴左边距、末列右沿贴右边距），消除
   * 「节点堆在左侧、右侧大片空白」；同时启用未选节点文字可读下限（不再整块 opacity 0.3）。
   */
  fitViewport?: boolean
}) {
  const snap = useSyncExternalStore(consoleDataBus.subscribe, consoleDataBus.get, () => null)
  const [filterLocal, setFilterLocal] = useState<'all' | RelationKind>('all')
  const [selectedLocal, setSelectedLocal] = useState<string | null>(null)
  const [view, setView] = useState<'graph' | 'list'>('list')
  const [depthLocal, setDepthLocal] = useState<1 | 2>(depthProp ?? 1)
  const depth = depthProp ?? depthLocal
  const setDepth = (d: 1 | 2) => { setDepthLocal(d); onDepthChange?.(d) }
  const filter = filterProp ?? filterLocal
  const selected = selectedProp !== undefined ? selectedProp : selectedLocal
  const setFilter = (f: 'all' | RelationKind) => { setFilterLocal(f); onFilterChange?.(f) }
  const setSelected = (id: string | null) => { setSelectedLocal(id); onSelect?.(id) }

  // 宽容器默认展示图（无 window 时保持列表，SSR/测试安全）。
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    if (window.matchMedia('(min-width: 900px)').matches) setView('graph')
  }, [])

  // A-10 · 实测图容器宽度（fit 归一化输入）。仅在图视图下挂载 ref，故依赖 view；
  // 无 ResizeObserver 时退回一次性 clientWidth；宽为 0（SSR/jsdom 未布局）→ fit 原样返回基础布局。
  const graphWrapRef = useRef<HTMLDivElement | null>(null)
  const [canvasW, setCanvasW] = useState(0)
  useEffect(() => {
    if (!fitViewport) return
    const el = graphWrapRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      setCanvasW((prev) => (prev === w ? prev : w))
    }
    if (typeof ResizeObserver === 'undefined') { measure(); return }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [fitViewport, view])

  const graph = useMemo(() => {
    if (!snap) return { nodes: [], edges: [], total: 0, truncated: false }
    const sourceStates = snap.sourceState ? [snap.sourceState] : []
    return buildRelations({ sourceStates, batches: snap.batches, events: snap.events, domain })
  }, [snap, domain])

  if (!snap) {
    return (
      <section className="qh-relations" data-testid="relations-loading" aria-label="关联证据">
        <p className="qrel-muted">关联证据读取中…</p>
      </section>
    )
  }

  const status = snap.status
  if (status === 'error' || status === 'offline') {
    return (
      <section className="qh-relations" data-testid="relations-error" aria-label="关联证据">
        <p className="qrel-error" role="alert">{snap.error ?? '只读数据服务错误。'}</p>
        <button type="button" className="qrel-retry" onClick={() => consoleDataBus.requestRefresh()} data-testid="relations-retry">重试</button>
      </section>
    )
  }

  // 筛选同源：图/列表/边/布局/渲染都用**同一可见子集**（否则过滤后节点无坐标 → 白屏）。
  const visibleGraph = kinds && kinds.length ? (() => {
    const kn = graph.nodes.filter((n) => kinds.includes(n.kind))
    const ids = new Set(kn.map((n) => n.id))
    return { nodes: kn, edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)), total: graph.total, truncated: graph.truncated }
  })() : subgraphFor(graph, filter)
  const nodes = visibleGraph.nodes
  const visibleEdges = visibleGraph.edges
  const sel = selected ? graph.nodes.find((n) => n.id === selected) ?? null : null
  const neigh = sel ? neighborsOf(graph, sel.id, depth) : null
  const selEdges = sel ? visibleEdges.filter((e) => e.from === sel.id || e.to === sel.id) : []
  // A-10 · fit：先取只读确定性布局（列=类型序，行=同类内真实序），再按实测画布宽归一化列间距。
  // fitViewport 未开启或宽度未测量时 fitGraphLayout 原样返回基础布局 → 既有宿主/SSR/jsdom 行为不变。
  const baseLayout = layoutRelations(visibleGraph)
  const layout = fitViewport ? fitGraphLayout(baseLayout, { viewportWidth: canvasW }) : baseLayout
  const labelOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id
  const dimNode = (id: string) => !!neigh && !neigh.has(id)
  const dimEdge = (from: string, to: string) => !!neigh && !(neigh.has(from) && neigh.has(to))
  const openNode = (n: RelationNode, originId?: string) => {
    const raw = n.id.slice(n.id.indexOf(':') + 1)
    if (n.kind === 'batch') onOpenBatch?.(raw)
    else if (n.kind === 'event') onOpenEvent?.(raw)
    else if (n.kind === 'source') onOpenSource?.(raw)
    else if (n.kind === 'device') onOpenDevice?.(raw)
    else if (n.kind === 'passport') onOpenPassport?.(raw, originId)
  }
  const openable = (n: RelationNode) => n.kind === 'batch' || n.kind === 'event' || n.kind === 'source' || n.kind === 'device' || n.kind === 'passport'
  const resetView = () => { setSelected(null); setDepth(1) }

  const empty = status === 'ready' && graph.nodes.length === 0
  const apiAvail = RELATION_KIND_COVERAGE.filter((c) => c.available).map((c) => c.label).join(' / ')
  const domainAvail = DOMAIN_KIND_COVERAGE.filter((c) => c.available).map((c) => c.label).join(' / ')

  return (
    <section className={`qh-relations${fitViewport ? ' qrel-mapfit' : ''}`} aria-label="关联证据">
      <header className="qrel-hd">
        <h3>关联证据（只读）</h3>
        <span className="qrel-count" data-testid="relations-count">
          当前 {nodes.length} / 共 {graph.total} 个有据对象{graph.truncated ? `（上限截断）` : ''} · 当前 {visibleEdges.length} 条关系
        </span>
      </header>

      {/* A-10 · 长串来源说明收进「来源与范围」按钮：复用统一解释浮层原语 Popover（真实 button →
          Enter/Space 可开、Esc 关闭并回焦触发器、点击/触屏固定、外点关闭、flip/clamp 不出屏）。
          原文案一字不丢（map-src-lead），另展开为结构化分源清单，并保留「示意管网未核实」等
          未核实事实说明——诚实口径不因收纳而消失。 */}
      <div className="qrel-sourcerow">
        <Popover
          label="来源与范围"
          ariaLabel="来源与范围：只读 API 与域内合成分源、覆盖口径与未核实示意说明"
          triggerId="relations-source-scope"
        >
          <div className="map-src-pop" data-testid="relations-coverage">
            <p className="map-src-lead">只读 API：{apiAvail}｜域内合成：{domainAvail}</p>
            <section className="map-src-sec">
              <h5>只读 API（真实来源，非合成）</h5>
              <ul>
                {RELATION_KIND_COVERAGE.map((c) => (
                  <li key={`api-${c.kind}`}>
                    <span className={`map-src-flag${c.available ? ' on' : ' off'}`}>{c.available ? '已接入' : '未生成'}</span>
                    <span className="map-src-body">
                      <span className="map-src-label">{c.label}</span>
                      <span className="map-src-note">{c.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="map-src-sec">
              <h5>域内合成（宿主 run 只读派生，非只读 API）</h5>
              <ul>
                {DOMAIN_KIND_COVERAGE.map((c) => (
                  <li key={`dom-${c.kind}`}>
                    <span className={`map-src-flag${c.available ? ' on' : ' off'}`}>{c.available ? '已生成' : '未生成'}</span>
                    <span className="map-src-body">
                      <span className="map-src-label">{c.label}</span>
                      <span className="map-src-note">{c.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="map-src-sec map-src-unverified">
              <h5>未核实（示意，不作现场结论）</h5>
              <ul>
                <li>母管/支路与设备间管网连接为示意（未核实），非现场地理或工艺拓扑。</li>
                <li>边仅来自已存 ID 引用（sourceId / batchId / eventId / unitId / passportId）；无证据不连、不造推测边、不造在线事件、不造第三层 URL。</li>
                <li>域内合成对象（设备资格 / 候选 / 独立复验 / 安全审查）是只读派生结论，不等于只读 API 事实；安全审查可进入人工批准，非已批准。</li>
              </ul>
            </section>
          </div>
        </Popover>
      </div>

      <div className="qrel-filters" role="group" aria-label="对象类型筛选">
        {FILTER_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`qrel-chip${filter === k ? ' on' : ''}`}
            aria-pressed={filter === k}
            onClick={() => { setFilter(k); setSelected(null) }}
            data-testid={`relations-filter-${k}`}
          >
            {k === 'all' ? '全部' : KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {empty ? (
        <p className="qrel-muted" data-testid="relations-empty">暂无有据对象——导入真实离线批次后显示来源/批次/事件关系。</p>
      ) : nodes.length === 0 ? (
        <p className="qrel-muted" data-testid="relations-filter-empty">该类型暂无有据对象。</p>
      ) : (
        <>
          <div className="qrel-viewbar" role="group" aria-label="视图">
            <button type="button" className={`qrel-chip${view === 'graph' ? ' on' : ''}`} aria-pressed={view === 'graph'} onClick={() => setView('graph')} data-testid="relations-view-graph">关系图</button>
            <button type="button" className={`qrel-chip${view === 'list' ? ' on' : ''}`} aria-pressed={view === 'list'} onClick={() => setView('list')} data-testid="relations-view-list">列表</button>
            <span className="qrel-spacer" />
            <span className="qrel-depth-label">邻域</span>
            <button type="button" className={`qrel-chip${depth === 1 ? ' on' : ''}`} aria-pressed={depth === 1} onClick={() => setDepth(1)} data-testid="relations-depth-1">1 层</button>
            <button type="button" className={`qrel-chip${depth === 2 ? ' on' : ''}`} aria-pressed={depth === 2} onClick={() => setDepth(2)} data-testid="relations-depth-2">2 层</button>
            <button type="button" className="qrel-chip" onClick={resetView} disabled={!sel && depth === 1} data-testid="relations-reset">恢复视图</button>
          </div>

          {view === 'graph' ? (
            <div className="qrel-graphwrap" data-testid="relations-graphwrap" ref={graphWrapRef}>
              <div className="qrel-graph" data-testid="relations-graph">
                <div className="qrel-canvas" style={{ width: layout.width, height: layout.height }}>
                  {/* A-10 · viewBox 与像素尺寸同源（1:1，非 CSS transform 补丁）：边线跟随 fit 后的节点坐标。 */}
                  <svg
                    className="qrel-gsvg"
                    width={layout.width}
                    height={layout.height}
                    viewBox={`0 0 ${Math.max(1, layout.width)} ${Math.max(1, layout.height)}`}
                    preserveAspectRatio="xMinYMin meet"
                    aria-hidden="true"
                  >
                    {visibleEdges.map((e) => {
                      const a = layout.positions[e.from]
                      const b = layout.positions[e.to]
                      if (!a || !b) return null
                      return (
                        <line
                          key={e.id}
                          className={`qrel-gline qrel-sem-${e.semantic} qrel-edge-${e.kind}${dimEdge(e.from, e.to) ? ' dim' : ''}`}
                          x1={a.x + GRAPH_NODE_W / 2}
                          y1={a.y + GRAPH_NODE_H / 2}
                          x2={b.x + GRAPH_NODE_W / 2}
                          y2={b.y + GRAPH_NODE_H / 2}
                        />
                      )
                    })}
                  </svg>
                  {nodes.map((n) => {
                    const p = layout.positions[n.id]
                    if (!p) return null
                    return (
                      <button
                        key={n.id}
                        type="button"
                        className={`qrel-gnode qrel-kind-${n.kind}${selected === n.id ? ' on' : ''}${dimNode(n.id) ? ' dim' : ''}`}
                        style={{ left: p.x, top: p.y, width: GRAPH_NODE_W, height: GRAPH_NODE_H }}
                        aria-pressed={selected === n.id}
                        onClick={() => setSelected(selected === n.id ? null : n.id)}
                        data-testid={`relations-gnode-${n.id}`}
                      >
                        <span className="qrel-gnode-kind">{KIND_LABEL[n.kind]}</span>
                        <span className="qrel-gnode-label">{n.label}</span>
                        {n.tag ? <span className="qrel-gnode-tag">{n.tag}</span> : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="qrel-grid">
              <ul className="qrel-nodes" data-testid="relations-nodes">
                {nodes.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`qrel-node${selected === n.id ? ' on' : ''}`}
                      aria-pressed={selected === n.id}
                      onClick={() => setSelected(selected === n.id ? null : n.id)}
                    >
                      <span className={`qrel-kind qrel-kind-${n.kind}`}>{KIND_LABEL[n.kind]}</span>
                      <span className="qrel-label">{n.label}</span>
                      {n.tag ? <span className="qrel-tag">{n.tag}</span> : null}
                      <span className="qrel-at">{n.at ?? '时间未知'}</span>
                      {neigh && neigh.has(n.id) && selected !== n.id ? <span className="qrel-neigh">邻域</span> : null}
                    </button>
                  </li>
                ))}
              </ul>

              <div className="qrel-detail" data-testid="relations-detail">
                {!sel ? (
                  <p className="qrel-muted">选择左侧对象，查看其真实关系与证据入口。</p>
                ) : (
                  <>
                    <h4>{KIND_LABEL[sel.kind]} · <code>{sel.label}</code></h4>
                    {sel.tag ? <p className="qrel-tag-line">{sel.tag}</p> : null}
                    <p className="qrel-muted">时间：{sel.at ?? '未知'}</p>
                    {sel.detail ? <p className="qrel-muted qrel-detail-note">{sel.detail}</p> : null}
                    <ul className="qrel-edges" data-testid="relations-edges">
                      {selEdges.length === 0 ? <li className="qrel-muted">无直接关系（不补造）。</li> : selEdges.map((e) => (
                        <li key={e.id}>{e.label}（{SEMANTIC_LABEL[e.semantic]}）：{labelOf(e.from === sel.id ? e.to : e.from)}</li>
                      ))}
                    </ul>
                    {openable(sel) ? (
                      <button type="button" id={`relations-open-${sel.id}`} className="qrel-open" onClick={(e) => openNode(sel, e.currentTarget.id)} data-testid="relations-open">
                        查看该对象证据 →
                      </button>
                    ) : (
                      <p className="qrel-muted" data-testid="relations-detail-domain">域内合成对象：只读展示，无只读 API 详情入口。</p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* 图视图下的详情（选中对象关系与入口；窄容器自然堆叠） */}
          {view === 'graph' ? (
            <div className="qrel-detail qrel-detail-graph" data-testid="relations-detail-graph">
              {!sel ? (
                <p className="qrel-muted">点选图中对象，查看其真实关系与证据入口。</p>
              ) : (
                <>
                  <h4>{KIND_LABEL[sel.kind]} · <code>{sel.label}</code></h4>
                  {sel.tag ? <p className="qrel-tag-line">{sel.tag}</p> : null}
                  {sel.detail ? <p className="qrel-muted qrel-detail-note">{sel.detail}</p> : null}
                  <ul className="qrel-edges" data-testid="relations-edges-graph">
                    {selEdges.length === 0 ? <li className="qrel-muted">无直接关系（不补造）。</li> : selEdges.map((e) => (
                      <li key={e.id}>{e.label}（{SEMANTIC_LABEL[e.semantic]}）：{labelOf(e.from === sel.id ? e.to : e.from)}</li>
                    ))}
                  </ul>
                  {openable(sel) ? (
                    <button type="button" id={`relations-open-graph-${sel.id}`} className="qrel-open" onClick={(e) => openNode(sel, e.currentTarget.id)} data-testid="relations-open-graph">
                      查看该对象证据 →
                    </button>
                  ) : (
                    <p className="qrel-muted">域内合成对象：只读展示，无只读 API 详情入口。</p>
                  )}
                </>
              )}
            </div>
          ) : null}
        </>
      )}

      <p className="qrel-note">只读关系<NoteRef note="relations" /></p>
    </section>
  )
}
