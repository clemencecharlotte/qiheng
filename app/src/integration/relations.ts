/**
 * M12 · R6 只读关系 adapter（真实对象/ID，非随机图）。
 * 只从已加载的只读数据（来源/批次/治理事件）构建确定性的对象与关系边：
 *   source --(batch.sourceId)--> batch --(event.batchId)--> event
 *   source --(event.sourceId)--> event
 * 无证据不连；不造第三层 URL、不假 trace、不造在线事件。
 */
import type { BatchSummary, GovernanceEvent, SourceState } from './contracts'

export type RelationKind = 'source' | 'batch' | 'event' | 'device' | 'pipeline' | 'candidate' | 'verifier' | 'passport' | 'safety'

export interface RelationNode {
  id: string
  kind: RelationKind
  label: string
  /** 动态限定/未知等（如事件类型/严重度/陈旧），空则不显示 */
  tag?: string
  /** 真实时间戳（来源观测/接收），未知为 null */
  at?: string | null
  /** 只读详情（如安全审查理由）；空则不显示 */
  detail?: string
}

export type RelationEdgeKind = 'source-of' | 'has-batch' | 'emits' | 'includes' | 'verified-by' | 'safety-gate' | 'network'
export type RelationSemantic = 'dependency' | 'verification' | 'authorization' | 'impact'

export interface RelationEdge {
  id: string
  from: string
  to: string
  kind: RelationEdgeKind
  label: string
  semantic: RelationSemantic
}

/**
 * 对象覆盖清单（本片诚实口径）：只列**当前只读存储确有**的对象类；
 * 其余标未生成（未接入只读 API），不造节点/边。
 */
export interface KindCoverage { kind: string; label: string; available: boolean; note: string }
export const RELATION_KIND_COVERAGE: KindCoverage[] = [
  { kind: 'source', label: '来源', available: true, note: 'sources/{id}/state.sourceId' },
  { kind: 'batch', label: '离线批次', available: true, note: 'batches[].id / sourceId' },
  { kind: 'event', label: '质量/治理事件', available: true, note: 'events[].eventId / batchId / sourceId' },
  { kind: 'observation', label: '观测记录', available: false, note: '需按批次拉取，未接入本图' },
  { kind: 'device', label: '设备机组', available: false, note: '域内对象，未由只读 API 暴露' },
  { kind: 'decision', label: '人审决定', available: false, note: '未接入只读 API' },
  { kind: 'verifier', label: '独立复验', available: false, note: '未接入只读 API' },
  { kind: 'approval', label: '批准状态', available: false, note: '未接入只读 API' },
  { kind: 'execution', label: '合成执行', available: false, note: '未接入只读 API' },
  { kind: 'anomaly', label: '故障/异常', available: false, note: '未接入只读 API' },
  { kind: 'replay', label: '复盘', available: false, note: '未接入只读 API' },
]

/**
 * 域内合成证据覆盖（与只读 API 分源标明）：由宿主 run 确定性派生，非只读 API。
 * 仅当宿主实际提供对应 snapshot 时才生成节点/边；不提供则整类不出现。
 */
export const DOMAIN_KIND_COVERAGE: KindCoverage[] = [
  { kind: 'device', label: '设备机组', available: true, note: 'run.allUnits + evaluation.eligibility（域内合成）' },
  { kind: 'candidate', label: '候选方案', available: true, note: 'run.baseline / run.recommendation（域内合成）' },
  { kind: 'verifier', label: '独立复验', available: true, note: 'verifyPlanConstraints 结果（域内独立复验）' },
  { kind: 'safety', label: '安全审查', available: true, note: 'runScheduleChain.safety 安全审查（可进入人工批准，非已批准）' },
  { kind: 'network', label: '示意管网', available: true, note: '设备间管网连接为**示意（未核实）**，非现场拓扑' },
  { kind: 'pipeline', label: '母管/支路（示意）', available: true, note: '示意母管/支路节点，**未核实**，非现场地理图' },
  { kind: 'passport', label: '已封存护照', available: true, note: '当前浏览器本地封存护照及其封存候选（非当前 recommendation）' },
]

export interface RelationGraph {
  nodes: RelationNode[]
  edges: RelationEdge[]
  /** 有据节点总数（未截断前），供宿主如实说明上限 */
  total: number
  truncated: boolean
}

/** 域内合成证据快照（显式只读；由宿主从 run 确定性派生，不发起后端/DB 写入）。 */
export interface DomainUnit { id: string; name: string; eligible: boolean; reason: string | null; /** M29 r32 · 同钟桶状态：当前负载比(%)/绝对与观察时刻（可为 null 未知）。 */ load?: number | null; at?: string | null }
export interface DomainPlan { id: string; label: string; passed: boolean; violationCount: number; unitIds: string[] }
export interface DomainSafety { verdict: 'allow' | 'reject'; reasons: string[] }
export interface DomainSnapshot {
  units: DomainUnit[]
  plans: DomainPlan[]
  /** 安全审查对象（允许进入人工批准的安全门，非已签批准）仅当真实对象存在时提供；缺省则不生成该节点/审查边。 */
  safety?: DomainSafety
  /** 安全审查实际对应的方案 id（安全门只绑该 plan；缺省视为 'recommendation'）。失败基线不得连同一 allow 安全门。 */
  reviewedPlanId?: string
  /** M29 r23 · 当前本地已封存护照（真实 ID + 其封存候选 ID）；无则不生成护照节点。 */
  passports?: Array<{ passportId: string; status: string; inputSource: string; candidates: string[] }>
}

export interface RelationInput {
  sourceStates: SourceState[]
  batches: BatchSummary[]
  events: GovernanceEvent[]
  /** 域内合成证据（可选；缺省则仅 API 对象，不造域内节点）。 */
  domain?: DomainSnapshot
  /** 邻域上限（默认 18；有据对象不足则实际更少） */
  maxNodes?: number
}

const KIND_ORDER: RelationKind[] = ['source', 'batch', 'event', 'device', 'pipeline', 'candidate', 'verifier', 'passport', 'safety']

export function buildRelations(input: RelationInput): RelationGraph {
  const maxNodes = input.maxNodes ?? 18
  const nodes: RelationNode[] = []
  const seen = new Set<string>()

  const push = (n: RelationNode) => {
    if (seen.has(n.id)) return
    seen.add(n.id)
    nodes.push(n)
  }

  for (const s of input.sourceStates) {
    push({ id: `source:${s.sourceId}`, kind: 'source', label: s.sourceId, at: s.sourceObservedAt ?? null })
  }
  for (const b of input.batches) {
    push({ id: `batch:${b.id}`, kind: 'batch', label: b.id, tag: `${b.format.toUpperCase()} · 有效 ${b.validRows}/隔离 ${b.isolatedRows}/拒绝 ${b.rejectedRows}`, at: b.receivedAt ?? null })
  }
  for (const e of input.events) {
    push({ id: `event:${e.eventId}`, kind: 'event', label: e.eventId, tag: `${e.type} · ${e.severity}`, at: e.receivedAt ?? null })
  }

  // 域内合成证据（仅当宿主提供 snapshot；不提供不造节点）
  const domain = input.domain
  if (domain) {
    for (const u of domain.units) {
      const loadTag = u.load == null ? '负载未知' : `负载 ${(u.load * 100).toFixed(0)}%`
      push({ id: `device:${u.id}`, kind: 'device', label: u.name || u.id, tag: `${u.eligible ? '资格通过' : `资格排除${u.reason ? ` · ${u.reason}` : ''}`} · ${loadTag}${u.at ? ` · ${u.at}` : ''}`, at: u.at ?? null })
    }
    for (const p of domain.plans) {
      push({ id: `candidate:${p.id}`, kind: 'candidate', label: p.label, tag: p.passed ? '独立复验通过' : `独立复验未通过 · ${p.violationCount} 项`, at: null })
      push({ id: `verifier:${p.id}`, kind: 'verifier', label: `${p.label} · 独立复验`, tag: p.passed ? '通过' : '未通过', at: null })
    }
    // M29 r23 · 示意母管/支路（明确未核示意，非现场地理图）
    if (domain.units.length >= 1) {
      push({ id: 'pipeline:main', kind: 'pipeline', label: '供气母管（演示示意）', tag: '未核示意', at: null, detail: '示意母管：非现场物理拓扑，未核实，不作为安全依据。' })
      for (const u of domain.units) {
        push({ id: `pipeline:${u.id}`, kind: 'pipeline', label: `支路 ${u.id}（示意）`, tag: '未核示意', at: null })
      }
    }
    // M29 r23 · 本地封存护照（真实 ID 与其封存候选，不得当当前 recommendation）
    for (const pp of domain.passports ?? []) {
      push({ id: `passport:${pp.passportId}`, kind: 'passport', label: pp.passportId, tag: `${pp.status} · ${pp.inputSource}`, at: null, detail: '本地已封存护照只读摘要；不代表当前授权。' })
      // 封存候选可能不是当前 baseline/recommendation：以其真实封存 candidateId 另建节点，不连当前建议。
      for (const cid of pp.candidates) {
        const exists = seen.has(`candidate:${cid}`)
        if (!exists) push({ id: `candidate:${cid}`, kind: 'candidate', label: `封存候选 ${cid}`, tag: '封存记录（非当前建议）', at: null })
      }
    }
    if (domain.safety) {
      const reason = domain.safety.reasons.length ? domain.safety.reasons.join('；') : '无阻断理由'
      push({
        id: 'safety:safety',
        kind: 'safety',
        label: '安全审查',
        tag: domain.safety.verdict === 'allow' ? '可进入人工批准' : '审查阻断',
        at: null,
        detail: `安全审查（域内合成）：${reason}；仅表示是否可进入人工批准，非已批准、非授权。`,
      })
    }
  }

  const total = nodes.length
  // M29 r26 · 截断只作用于只读 API 大基数（source/batch/event）；域内对象（设备/示意管网/候选/复验/护照/安全）**全保留**，
  // 避免按 KIND_ORDER 先截断把 decision 视角的 passport/safety 排掉（此前 20 上限截断根因）。
  const API_KINDS: RelationKind[] = ['source', 'batch', 'event']
  const apiNodes = nodes.filter((n) => API_KINDS.includes(n.kind))
  const domainNodes = nodes.filter((n) => !API_KINDS.includes(n.kind))
  const apiKept = apiNodes.slice(0, Math.max(0, maxNodes - domainNodes.length))
  const kept = [...apiKept, ...domainNodes]
  const truncated = total > kept.length
  const keptIds = new Set(kept.map((n) => n.id))

  const edges: RelationEdge[] = []
  const addEdge = (from: string, to: string, kind: RelationEdgeKind, label: string, semantic: RelationSemantic) => {
    if (!keptIds.has(from) || !keptIds.has(to)) return
    edges.push({ id: `${from}->${to}:${kind}`, from, to, kind, label, semantic })
  }
  for (const b of input.batches) {
    addEdge(`source:${b.sourceId}`, `batch:${b.id}`, 'source-of', '来源', 'dependency')
  }
  for (const e of input.events) {
    if (e.batchId) addEdge(`batch:${e.batchId}`, `event:${e.eventId}`, 'has-batch', '批次', 'dependency')
    if (e.sourceId) addEdge(`source:${e.sourceId}`, `event:${e.eventId}`, 'emits', '来源事件', 'dependency')
  }
  // 域内边：仅用真实引用（plan.unitIds / 复验结果 / 安全审查对象），语义分明，无证据不连。
  if (domain) {
    const unitIds = new Set(domain.units.map((u) => `device:${u.id}`))
    const reviewedPlanId = domain.reviewedPlanId ?? 'recommendation'
    for (const p of domain.plans) {
      for (const uid of p.unitIds) {
        const dev = `device:${uid}`
        if (unitIds.has(dev)) addEdge(`candidate:${p.id}`, dev, 'includes', '纳入机组', 'impact')
      }
      addEdge(`candidate:${p.id}`, `verifier:${p.id}`, 'verified-by', '独立复验', 'verification')
      // 安全门仅绑「实际审查对应的方案」——失败基线不得连到同一 allow 安全门。
      if (domain.safety && p.id === reviewedPlanId) {
        addEdge(`candidate:${p.id}`, 'safety:safety', 'safety-gate', '安全审查门', 'verification')
      }
    }
    // MAP · 示意母管/支路：设备→支路→母管（明确未核示意，非现场拓扑）。
    if (domain.units.length >= 1) {
      for (const u of domain.units) {
        addEdge(`device:${u.id}`, `pipeline:${u.id}`, 'network', '示意支路（未核）', 'dependency')
        addEdge(`pipeline:${u.id}`, 'pipeline:main', 'network', '汇流示意（未核）', 'dependency')
      }
    }
    // 护照→封存候选（真实封存内部 ID，非当前 recommendation）
    for (const pp of domain.passports ?? []) {
      for (const cid of pp.candidates) addEdge(`passport:${pp.passportId}`, `candidate:${cid}`, 'includes', '封存候选', 'verification')
    }
  }

  return { nodes: kept, edges, total, truncated }
}

export function neighborsOf(graph: RelationGraph, id: string, depth = 1): Set<string> {
  const out = new Set<string>([id])
  let frontier = new Set<string>([id])
  for (let d = 0; d < depth; d += 1) {
    const next = new Set<string>()
    for (const e of graph.edges) {
      if (frontier.has(e.from) && !out.has(e.to)) { out.add(e.to); next.add(e.to) }
      if (frontier.has(e.to) && !out.has(e.from)) { out.add(e.from); next.add(e.from) }
    }
    frontier = next
  }
  return out
}

/** 筛选同源子图：列表/图/边/布局共用同一可见子集（保证 device 等筛选同时作用于图）。 */
export function subgraphFor(graph: RelationGraph, filter: 'all' | RelationKind): RelationGraph {
  const nodes = graph.nodes.filter((n) => filter === 'all' || n.kind === filter)
  const ids = new Set(nodes.map((n) => n.id))
  const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
  return { nodes, edges, total: graph.total, truncated: graph.truncated }
}

/** 确定性布局常量（无物理引擎/无随机；同输入恒定像素）。 */export const GRAPH_NODE_W = 176
export const GRAPH_NODE_H = 56
export const GRAPH_COL_GAP = 44
export const GRAPH_ROW_GAP = 18

export interface GraphLayout {
  width: number
  height: number
  /** 节点左上角坐标（px），按真实节点确定性分配。 */
  positions: Record<string, { x: number; y: number }>
}

/**
 * 确定性分层布局：列=类型顺序，行=同类型内真实顺序；无随机、无物理迭代。
 * 空图返回 0×0；节点数与 kept 一致，不凑数。
 */
export function layoutRelations(graph: RelationGraph): GraphLayout {
  const byKind = new Map<RelationKind, RelationNode[]>()
  for (const k of KIND_ORDER) byKind.set(k, [])
  for (const n of graph.nodes) {
    const list = byKind.get(n.kind)
    if (list) list.push(n)
  }
  const positions: Record<string, { x: number; y: number }> = {}
  let width = 0
  let height = 0
  // M29 r23 · 布局只取**实际可见列**（避免中间空列导致前面空 600px）。
  const presentKinds = KIND_ORDER.filter((k) => (byKind.get(k) ?? []).length > 0)
  presentKinds.forEach((k, ci) => {
    const list = byKind.get(k) ?? []
    list.forEach((n, ri) => {
      const x = ci * (GRAPH_NODE_W + GRAPH_COL_GAP)
      const y = ri * (GRAPH_NODE_H + GRAPH_ROW_GAP)
      positions[n.id] = { x, y }
      width = Math.max(width, x + GRAPH_NODE_W)
      height = Math.max(height, y + GRAPH_NODE_H)
    })
  })
  return { width, height, positions }
}
