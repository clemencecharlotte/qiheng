import { describe, expect, it } from 'vitest'
import { buildRelations, neighborsOf } from './relations'
import type { BatchSummary, GovernanceEvent, SourceState } from './contracts'

const src: SourceState = {
  sourceId: 'synth-air-2', configured: true,
  sourceObservedAt: '2026-10-07T01:00:00.000Z',
  receivedAt: '2026-10-07T23:59:33.464Z', heartbeatAt: null,
  status: 'ready', observationCount: 1, ruleVersion: 'v1',
}
const batch = (id: string, sourceId: string): BatchSummary => ({
  id, sourceId, entity: 'e', format: 'json', filename: '', ruleVersion: 'v1', receivedAt: 't',
  totalRows: 1, validRows: 1, isolatedRows: 0, rejectedRows: 0, status: 'ok', unordered: false, note: '',
})
const event = (id: string, batchId: string | null, sourceId: string | null): GovernanceEvent => ({
  eventId: id, sourceId, batchId, type: 'import_completed', severity: 'info', occurredAt: 't',
  receivedAt: 't', ruleVersion: 'v1', reasons: null, detail: 'd',
})

describe('M12 R6 只读关系 adapter', () => {
  it('只连接真实有据关系：source→batch→event，source→event', () => {
    const g = buildRelations({
      sourceStates: [src],
      batches: [batch('b1', 'synth-air-2'), batch('b2', 'other')],
      events: [event('e1', 'b1', 'synth-air-2'), event('e2', null, null)],
    })
    // 有据节点：1 source + 2 batch + 2 event = 5
    expect(g.total).toBe(5)
    const has = (from: string, to: string) => g.edges.some((e) => e.from === from && e.to === to)
    expect(has('source:synth-air-2', 'batch:b1')).toBe(true)
    expect(has('batch:b1', 'event:e1')).toBe(true)
    expect(has('source:synth-air-2', 'event:e1')).toBe(true)
    // 无证据不连：e2 无 batch/source
    expect(g.edges.some((e) => e.to === 'event:e2')).toBe(false)
    // other 批次与无该 source 节点：source:other 未被创建，边不出现
    expect(g.edges.some((e) => e.from === 'source:other')).toBe(false)
  })

  it('确定性截断不随机；neighborsOf 邻域', () => {
    const batches = Array.from({ length: 30 }, (_, i) => batch(`b${i}`, 'synth-air-2'))
    const g = buildRelations({ sourceStates: [src], batches, events: [], maxNodes: 5 })
    expect(g.truncated).toBe(true)
    expect(g.nodes.length).toBe(5)
    // 确定性：同输入同输出
    const g2 = buildRelations({ sourceStates: [src], batches, events: [], maxNodes: 5 })
    expect(g2.nodes.map((n) => n.id)).toEqual(g.nodes.map((n) => n.id))
    const neigh = neighborsOf(g, 'source:synth-air-2', 1)
    expect(neigh.has('source:synth-air-2')).toBe(true)
    expect(neigh.size).toBeGreaterThan(1)
  })

  it('空输入 → 空图（不造节点）', () => {
    const g = buildRelations({ sourceStates: [], batches: [], events: [] })
    expect(g.nodes).toEqual([])
    expect(g.edges).toEqual([])
    expect(g.total).toBe(0)
  })
})

import { RELATION_KIND_COVERAGE } from './relations'

describe('M15 r01 对象覆盖与边语义', () => {
  it('已生成仅 source/batch/event；其余标未生成（不造节点）', () => {
    const avail = RELATION_KIND_COVERAGE.filter((c) => c.available).map((c) => c.kind)
    expect(avail).toEqual(['source', 'batch', 'event'])
    expect(RELATION_KIND_COVERAGE.find((c) => c.kind === 'observation')?.available).toBe(false)
    expect(RELATION_KIND_COVERAGE.find((c) => c.kind === 'verifier')?.available).toBe(false)
  })
  it('每条边带真实语义（dependency 等）', () => {
    const g = buildRelations({
      sourceStates: [{ sourceId: 's', configured: true, sourceObservedAt: null, receivedAt: null, heartbeatAt: null, status: 'ready', observationCount: 0, ruleVersion: 'v1' }],
      batches: [{ id: 'b', sourceId: 's', entity: 'e', format: 'json', filename: '', ruleVersion: 'v1', receivedAt: 't', totalRows: 1, validRows: 1, isolatedRows: 0, rejectedRows: 0, status: 'ok', unordered: false, note: '' }],
      events: [],
    })
    expect(g.edges.every((e) => e.semantic === 'dependency')).toBe(true)
  })
})

import { layoutRelations, DOMAIN_KIND_COVERAGE, GRAPH_NODE_W } from './relations'
import type { DomainSnapshot } from './relations'

const domain: DomainSnapshot = {
  units: [
    { id: 'AC-01', name: 'AC-01 在役', eligible: true, reason: null },
    { id: 'AC-03', name: 'AC-03 监测', eligible: false, reason: '边界未知' },
  ],
  plans: [
    { id: 'baseline', label: '基线（规则）', passed: false, violationCount: 17, unitIds: ['AC-01'] },
    { id: 'recommendation', label: '建议（优化）', passed: true, violationCount: 0, unitIds: ['AC-01'] },
  ],
  safety: { verdict: 'allow', reasons: [] },
}

describe('M19 R6 域内合成证据与确定性布局', () => {
  it('域内节点/边来自真实引用，语义分明（dependency 之外）', () => {
    const g = buildRelations({ sourceStates: [], batches: [], events: [], domain })
    const ids = g.nodes.map((n) => n.id)
    expect(ids).toContain('device:AC-01'); expect(ids).toContain('candidate:baseline')
    expect(ids).toContain('verifier:recommendation'); expect(ids).toContain('safety:safety')
    const edge = (from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to)
    expect(edge('candidate:baseline', 'verifier:baseline')?.semantic).toBe('verification')
    expect(edge('candidate:baseline', 'device:AC-01')?.semantic).toBe('impact')
    // safety 是安全审查门（verification），非批准/授权；只绑实际审查的建议 plan
    expect(edge('candidate:recommendation', 'safety:safety')?.kind).toBe('safety-gate')
    expect(edge('candidate:recommendation', 'safety:safety')?.semantic).toBe('verification')
    // 失败基线不得连到同一 allow 安全门
    expect(g.edges.some((e) => e.from === 'candidate:baseline' && e.to === 'safety:safety')).toBe(false)
  })

  it('有 safety 也不冒批准/授权：只画安全审查门，不造 approval 节点或 authorization 边', () => {
    const g = buildRelations({ sourceStates: [], batches: [], events: [], domain })
    expect(g.nodes.some((n) => (n.kind as string) === 'approval')).toBe(false)
    expect(g.edges.some((e) => e.semantic === 'authorization')).toBe(false)
    const safety = g.nodes.find((n) => n.id === 'safety:safety')
    expect(safety?.kind).toBe('safety')
    expect(safety?.tag).toBe('可进入人工批准')
    expect(safety?.detail ?? '').toContain('非已批准')
  })

  it('不提供 domain → 不造域内节点', () => {
    const g = buildRelations({ sourceStates: [], batches: [], events: [] })
    expect(g.nodes).toEqual([])
  })

  it('无 safety 对象 → 不造安全审查节点/审查边（无证据不连）', () => {
    const g = buildRelations({ sourceStates: [], batches: [], events: [], domain: { units: domain.units, plans: domain.plans } })
    expect(g.nodes.some((n) => n.kind === 'safety')).toBe(false)
    expect(g.edges.some((e) => e.kind === 'safety-gate')).toBe(false)
  })

  it('确定性布局：同输入恒定像素；覆盖全部 kept 节点；空图 0×0', () => {
    const g = buildRelations({ sourceStates: [], batches: [], events: [], domain })
    const a = layoutRelations(g); const b = layoutRelations(g)
    expect(a).toEqual(b)
    for (const n of g.nodes) expect(a.positions[n.id]).toBeTruthy()
    expect(a.width).toBeGreaterThanOrEqual(GRAPH_NODE_W)
    expect(layoutRelations({ nodes: [], edges: [], total: 0, truncated: false })).toEqual({ width: 0, height: 0, positions: {} })
  })

  it('邻域深度 2 层 ⊇ 1 层；确定性截断含域内且不随机', () => {
    const g = buildRelations({ sourceStates: [], batches: [], events: [], domain })
    const n1 = neighborsOf(g, 'candidate:baseline', 1)
    const n2 = neighborsOf(g, 'candidate:baseline', 2)
    for (const id of n1) expect(n2.has(id)).toBe(true)
    const many: DomainSnapshot = { units: Array.from({ length: 30 }, (_, i) => ({ id: `U${i}`, name: `U${i}`, eligible: true, reason: null })), plans: [] }
    // M29 r26 · 截断只作用于 API 大基数；域内对象全保留。
    const g2 = buildRelations({ sourceStates: [], batches: [], events: [], domain: many, maxNodes: 6 })
    expect(g2.truncated).toBe(false); expect(g2.nodes.filter((n) => n.kind === 'device').length).toBe(30)
    const g3 = buildRelations({ sourceStates: [], batches: [], events: [], domain: many, maxNodes: 6 })
    expect(g3.nodes.map((n) => n.id)).toEqual(g2.nodes.map((n) => n.id))
  })

  it('域内合成覆盖与只读 API 分源标明', () => {
    expect(DOMAIN_KIND_COVERAGE.every((c) => c.available)).toBe(true)
    expect(DOMAIN_KIND_COVERAGE.map((c) => c.kind)).toEqual(['device', 'candidate', 'verifier', 'safety', 'network', 'pipeline', 'passport'])
  })
})

import { subgraphFor } from './relations'

describe('M21 · 筛选同源子图（图/列表/边/布局同源）', () => {
  it('device 筛选：节点仅为 device，跨类边按两端子集过滤被移除', () => {
    const g = buildRelations({ sourceStates: [], batches: [], events: [], domain })
    const dev = subgraphFor(g, 'device')
    expect(dev.nodes.length).toBe(2)
    expect(dev.nodes.every((n) => n.kind === 'device')).toBe(true)
    // candidate→device 边因 candidate 不在子集而移除；MAP 示意管网边两端均为 device，保留 1 条。
    // pipeline/护照边两端不在 device 子集 → device 视角无跨类边（示意网络为 device→pipeline）。
    expect(dev.edges.length).toBe(0)
    const all = subgraphFor(g, 'all')
    expect(all.nodes.length).toBe(g.nodes.length)
    expect(all.edges.length).toBe(g.edges.length)
  })
})

describe('M29 r26 · 上限截断不丢域内护照/安全（回归）', () => {
  it('API 大基数超 maxNodes 时，域内 passport/safety/device 全保留且选择可打开', () => {
    const batches = Array.from({ length: 30 }, (_, i) => ({
      id: `b${i}`, sourceId: 'synth-air-2', entity: 'air', format: 'csv', filename: `b${i}.csv`,
      ruleVersion: 'r1', receivedAt: '2026-10-14T00:00:00Z', totalRows: 10, validRows: 10, isolatedRows: 0, rejectedRows: 0, status: 'loaded',
    })) as never
    const src = { sourceId: 'synth-air-2', sourceObservedAt: '2026-10-14T00:00:00Z', receivedAt: '2026-10-14T00:00:00Z', heartbeatAt: null } as never
    const domain = {
      units: [{ id: 'AC-01', name: '1#', eligible: true, reason: null }],
      plans: [{ id: 'baseline', label: '基线', passed: false, violationCount: 1, unitIds: ['AC-01'] }, { id: 'recommendation', label: '建议', passed: true, violationCount: 0, unitIds: ['AC-01'] }],
      safety: { verdict: 'allow', reasons: [] }, reviewedPlanId: 'recommendation',
      passports: [{ passportId: 'qp-mv3zkdwy-d4bce5b3', status: 'canceled', inputSource: 'synthetic_schedule', candidates: ['recommendation'] }],
    } as never
    const g = buildRelations({ sourceStates: [src], batches, events: [], domain, maxNodes: 18 })
    const kinds = g.nodes.map((n) => n.kind)
    expect(kinds).toContain('passport')
    expect(kinds).toContain('safety')
    expect(kinds).toContain('device')
    expect(g.nodes.some((n) => n.id === 'passport:qp-mv3zkdwy-d4bce5b3')).toBe(true)
  })
})

describe('M29 r29 · 护照封存候选另建节点（不与当前建议混）', () => {
  it('封存 candidateId 非 baseline/recommendation 时仍建节点且与护照相连', () => {
    const domain = {
      units: [{ id: 'AC-01', name: '1#', eligible: true, reason: null }],
      plans: [{ id: 'baseline', label: '基线', passed: false, violationCount: 1, unitIds: ['AC-01'] }, { id: 'recommendation', label: '建议', passed: true, violationCount: 0, unitIds: ['AC-01'] }],
      safety: { verdict: 'allow', reasons: [] }, reviewedPlanId: 'recommendation',
      passports: [{ passportId: 'qp-x', status: 'canceled', inputSource: 'synthetic_schedule', candidates: ['sealed-cand-7'] }],
    } as never
    const g = buildRelations({ sourceStates: [], batches: [], events: [], domain })
    expect(g.nodes.some((n) => n.id === 'candidate:sealed-cand-7')).toBe(true)
    expect(g.edges.some((e) => e.from === 'passport:qp-x' && e.to === 'candidate:sealed-cand-7')).toBe(true)
  })
})

describe('M29 r32 · 设备节点随同钟 index 负载更新，资格未知仍未知', () => {
  it('同设备不同桶负载标签变化；资格/原因不变', () => {
    const mk = (load: number | null) => ({ units: [{ id: 'AC-03', name: '3# 离心', eligible: false, reason: '喘振边界未核实', load, at: '12:00' }], plans: [], safety: undefined } as never)
    const g1 = buildRelations({ sourceStates: [], batches: [], events: [], domain: mk(0.72) })
    const g2 = buildRelations({ sourceStates: [], batches: [], events: [], domain: mk(null) })
    const n1 = g1.nodes.find((n) => n.id === 'device:AC-03')!
    const n2 = g2.nodes.find((n) => n.id === 'device:AC-03')!
    expect(n1.tag).toContain('负载 72%')
    expect(n1.tag).toContain('资格排除')
    expect(n2.tag).toContain('负载未知')
    expect(n2.tag).toContain('喘振边界未核实') // 未知不画成可用
  })
})
