import { describe, expect, it } from 'vitest'
import {
  bucketRangeValid,
  DEFAULT_HASH,
  mapGovernanceQuery,
  mergeObjectContext,
  reduceRouteNotice,
  parseHash,
  resolveNav,
  routeHash,
  routesEqual,
  SUB_LABEL,
  timeIndexValid,
  TOP_LABEL,
  workspaceForTop,
} from './router'

describe('hash 路由白名单', () => {
  it('空 hash 默认调度总览', () => {
    const r = parseHash('')
    expect(r.valid).toBe(true)
    expect(r.top).toBe('schedule')
    expect(r.sub).toBe('overview')
    expect(r.normalizedHash).toBe(DEFAULT_HASH)
    expect(parseHash(null).normalizedHash).toBe(DEFAULT_HASH)
  })

  it('合法深链解析 mode/scenario/lab/pref/source/t/a/b', () => {
    const legacy = parseHash('#/schedule/overview?mode=legacy&scenario=surge')
    expect(legacy.valid).toBe(true)
    expect(legacy.mode).toBe('legacy')
    expect(legacy.scenario).toBe('surge')

    const lab = parseHash(
      '#/schedule/compare?mode=lab&lab=standby_takeover&pref=switch_first',
    )
    expect(lab.valid).toBe(true)
    expect(lab.mode).toBe('lab')
    expect(lab.lab).toBe('standby_takeover')
    expect(lab.pref).toBe('switch_first')

    const located = parseHash(
      '#/schedule/evidence?mode=lab&lab=capacity_rise&pref=energy_first&source=schedule&t=40&a=38&b=44',
    )
    expect(located.valid).toBe(true)
    expect(located.source).toBe('schedule')
    expect(located.t).toBe(40)
    expect(located.a).toBe(38)
    expect(located.b).toBe(44)
  })

  it('未知顶层路径明确回退', () => {
    const r = parseHash('#/nope/whatever')
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('未知导航路径')
    expect(r.top).toBe('schedule')
  })

  it('顶层不支持子页回退到首子页', () => {
    const r = parseHash('#/schedule/nope')
    expect(r.valid).toBe(false)
    expect(r.sub).toBe('overview')
    expect(r.normalizedHash).toContain('#/schedule/overview')
  })

  it('层级过多视为非法', () => {
    expect(parseHash('#/schedule/overview/extra').valid).toBe(false)
  })

  it('未知参数 / 非法取值被拒绝并规范化', () => {
    const unknown = parseHash('#/schedule/overview?mode=legacy&evil=1')
    expect(unknown.valid).toBe(false)
    expect(unknown.reason).toContain('未知参数')
    expect(unknown.normalizedHash).not.toContain('evil')

    const badMode = parseHash('#/schedule/overview?mode=hack')
    expect(badMode.valid).toBe(false)
    expect(badMode.mode).toBe('legacy')
  })

  it('定位参数需 source 且合法整数，a≤b', () => {
    expect(parseHash('#/schedule/overview?t=5').valid).toBe(false)
    expect(parseHash('#/schedule/overview?source=schedule&t=x').valid).toBe(false)
    expect(
      parseHash('#/schedule/overview?source=schedule&a=5&b=3').valid,
    ).toBe(false)
    expect(
      parseHash('#/events/list?source=history&a=2&b=4').valid,
    ).toBe(true)
  })

  it('原型键 / 未知顶层不抛错且回退（own-property 白名单）', () => {
    for (const hash of ['#/__proto__/list', '#/constructor/list', '#/toString/list']) {
      const r = parseHash(hash)
      expect(r.valid).toBe(false)
      expect(r.top).toBe('schedule')
      expect(r.reason).toContain('未知导航路径')
    }
  })

  it('重复参数明确 invalid（不接受第一值当 valid）', () => {
    const r = parseHash('#/schedule/overview?mode=lab&mode=legacy')
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('重复参数')
    const dupT = parseHash('#/schedule/overview?source=schedule&t=1&t=2')
    expect(dupT.valid).toBe(false)
    expect(dupT.reason).toContain('重复参数')
  })

  it('错误百分号 / 非法 UTF-8 编码被拒绝', () => {
    expect(parseHash('#/schedule/overview?x=%ZZ').valid).toBe(false)
    expect(parseHash('#/schedule/overview?x=%E0%A4%A').valid).toBe(false)
  })

  it('t/a/b 须安全整数，a/b 成对且闭桶 a≤b（a=b 单桶合法）', () => {
    expect(
      parseHash('#/schedule/overview?source=schedule&t=99999999999999999999').valid,
    ).toBe(false)
    expect(parseHash('#/schedule/overview?source=schedule&a=3').valid).toBe(false)
    // a=b 为合法单桶
    expect(parseHash('#/schedule/overview?source=schedule&a=3&b=3').valid).toBe(true)
    expect(parseHash('#/schedule/overview?source=schedule&a=4&b=3').valid).toBe(false)
    // 解析层不校验 count；count 上界在接入时轴时用 bucketRangeValid
    expect(parseHash('#/schedule/overview?source=schedule&a=0&b=96').valid).toBe(true)
  })

  it('lab 深链携带 scenario，unit_failure 刷新不静默 normal', () => {
    const r = parseHash(
      '#/schedule/compare?mode=lab&scenario=unit_failure&lab=standby_takeover&pref=energy_first',
    )
    expect(r.valid).toBe(true)
    expect(r.scenario).toBe('unit_failure')
    expect(r.normalizedHash).toContain('scenario=unit_failure')
    expect(routeHash(r)).toBe(r.normalizedHash)
  })

  it('routesEqual 依据规范化 hash 去重', () => {
    const a = parseHash('#/schedule/overview?mode=legacy&scenario=normal')
    const b = parseHash('#/schedule/overview')
    expect(routesEqual(a, b)).toBe(true)
    const c = parseHash('#/schedule/compare?mode=legacy&scenario=normal')
    expect(routesEqual(a, c)).toBe(false)
  })

  it('合法路由 roundtrip 稳定', () => {
    for (const hash of [
      DEFAULT_HASH,
      '#/schedule/compare?mode=lab&lab=capacity_oscillate&pref=switch_first',
      '#/events/list?mode=legacy&scenario=normal',
      '#/history/trend?mode=legacy&scenario=normal',
      '#/records/export?mode=lab&lab=standby_takeover&pref=energy_first',
    ]) {
      const r = parseHash(hash)
      expect(r.valid).toBe(true)
      expect(routeHash(r)).toBe(r.normalizedHash)
    }
  })
})

describe('闭桶区间与单点边界（与 explore [lo,hi] 一致）', () => {
  it('bucketRangeValid：首/末/单桶合法，b=count 与逆序非法', () => {
    const count = 96
    expect(bucketRangeValid(24, 44, count)).toBe(true) // 21 桶，06:00–11:15
    expect(bucketRangeValid(0, 0, count)).toBe(true) // 首桶单桶
    expect(bucketRangeValid(95, 95, count)).toBe(true) // 末桶单桶
    expect(bucketRangeValid(0, 95, count)).toBe(true) // 全窗口
    expect(bucketRangeValid(0, 96, count)).toBe(false) // b=count 非法
    expect(bucketRangeValid(96, 96, count)).toBe(false)
    expect(bucketRangeValid(44, 24, count)).toBe(false) // 逆序
    expect(bucketRangeValid(-1, 3, count)).toBe(false)
  })

  it('timeIndexValid：0..count-1 合法，count 与负值非法', () => {
    expect(timeIndexValid(0, 96)).toBe(true)
    expect(timeIndexValid(95, 96)).toBe(true)
    expect(timeIndexValid(96, 96)).toBe(false)
    expect(timeIndexValid(-1, 96)).toBe(false)
    expect(timeIndexValid(3, 16)).toBe(true)
    expect(timeIndexValid(16, 16)).toBe(false)
  })
})

describe('顶层与工作区映射', () => {
  it('顶层标签与工作区映射', () => {
    expect(TOP_LABEL).toEqual({
      schedule: '调度',
      device: '设备',
      map: '关系MAP',
      agent: '智能体',
      data: '数据治理',
      events: '事件',
      history: '回放证据',
      records: '记录',
    })
    expect(workspaceForTop('records')).toBe('assistant')
    expect(workspaceForTop('history')).toBe('history')
    expect(SUB_LABEL.schedule.evidence).toBe('关联证据')
  })
})

describe('M10 离线子页', () => {
  it('新增 history/data 与 events/governance 子页并标中文', () => {
    expect(SUB_LABEL.history.data).toBe('数据接入')
    expect(SUB_LABEL.events.governance).toBe('治理事件')
  })
  it('离线子页清除合成定位查询 source/t/a/b', () => {
    const r = parseHash('#/history/data?source=history&t=3&a=1&b=2')
    expect(r.valid).toBe(true)
    expect(r.source).toBeNull()
    expect(r.t).toBeNull()
    expect(r.a).toBeNull()
    expect(r.b).toBeNull()
    expect(r.normalizedHash).not.toMatch(/[?&](source|t|a|b)=/)
    const g = parseHash('#/events/governance?source=schedule&t=5')
    expect(g.valid).toBe(true)
    expect(g.source).toBeNull()
    expect(g.t).toBeNull()
    expect(g.normalizedHash).not.toMatch(/[?&](source|t|a|b)=/)
  })
  it('保留原 history/trend 入口', () => {
    expect(parseHash('#/history/trend').valid).toBe(true)
    expect(parseHash('#/history/trend').normalizedHash.startsWith('#/history/trend')).toBe(true)
  })
})

describe('M10 r02 离线子页与受控定位', () => {
  it('未知参数/非法 mode/重复 scenario 仍 invalid（离线子页不跳过 reason）', () => {
    expect(parseHash('#/history/data?bogus=1').valid).toBe(false)
    expect(parseHash('#/events/governance?mode=evil').valid).toBe(false)
    expect(parseHash('#/history/data?scenario=normal&scenario=surge').valid).toBe(false)
  })
  it('离线子页清除合成 source/t/a/b 且保持合法', () => {
    const r = parseHash('#/history/data?source=history&t=3&a=1&b=2')
    expect(r.valid).toBe(true)
    expect(r.source).toBeNull()
    expect(r.normalizedHash).not.toMatch(/[?&](source|t|a|b)=/)
  })
  it('受控对象定位 batchId/eventId/sourceId bounded', () => {
    const r = parseHash('#/events/governance?eventId=e1_ab-2')
    expect(r.valid).toBe(true)
    expect(r.eventId).toBe('e1_ab-2')
    expect(parseHash(`#/events/governance?eventId=${'x'.repeat(65)}`).valid).toBe(false)
    expect(parseHash('#/history/data?batchId=' + encodeURIComponent('a/b')).valid).toBe(false)
  })
})

describe('M10 r03 离线子页校验（清理前先校验）', () => {
  it('非法 source/t 与重复 source 仍 invalid', () => {
    expect(parseHash('#/history/data?source=bad&t=bad').valid).toBe(false)
    expect(parseHash('#/history/data?source=history&source=history').valid).toBe(false)
    expect(parseHash('#/events/governance?source=history&t=1&a=1').valid).toBe(false)
  })
  it('合法 source/t 在离线子页被清理且仍 valid', () => {
    const r = parseHash('#/history/data?source=history&t=3&a=1&b=2')
    expect(r.valid).toBe(true)
    expect(r.normalizedHash).not.toMatch(/[?&](source|t|a|b)=/)
  })
})

describe('M10 r04 治理查询受控参数（bounded）', () => {
  it('合法 type/severity/offset 解析并规范化回原 hash', () => {
    const h = '#/events/governance?mode=legacy&scenario=normal&sourceId=synth-air-2&eventId=e1&type=rows_rejected&severity=warn&offset=20'
    const r = parseHash(h)
    expect(r.valid).toBe(true)
    expect(r.eventType).toBe('rows_rejected')
    expect(r.eventSeverity).toBe('warn')
    expect(r.eventOffset).toBe(20)
    expect(r.sourceId).toBe('synth-air-2')
    expect(parseHash(r.normalizedHash).normalizedHash).toBe(r.normalizedHash)
  })
  it('非法枚举 / 重复 / 过大 offset / 非数字均 invalid', () => {
    expect(parseHash('#/events/governance?type=bogus').valid).toBe(false)
    expect(parseHash('#/events/governance?severity=fatal').valid).toBe(false)
    expect(parseHash('#/events/governance?offset=-1').valid).toBe(false)
    expect(parseHash('#/events/governance?offset=1000001').valid).toBe(false)
    expect(parseHash('#/events/governance?offset=1.5').valid).toBe(false)
    expect(parseHash('#/events/governance?type=import_completed&type=rows_rejected').valid).toBe(false)
  })
  it('非 governance 子页规范化清除治理查询（不污染导航）', () => {
    const r = parseHash('#/history/trend?mode=legacy&scenario=normal&type=rows_rejected&offset=5')
    expect(r.valid).toBe(true)
    expect(r.eventType).toBeNull()
    expect(r.eventOffset).toBeNull()
    expect(r.normalizedHash).not.toContain('type=')
    expect(r.normalizedHash).not.toContain('offset=')
  })
})

describe('M10 r04 对象上下文合并', () => {
  const govBase = parseHash('#/events/governance?sourceId=synth-air-2&eventId=e1&type=rows_rejected&severity=warn&offset=20')
  const dataBase = parseHash('#/history/data?batchId=b1')
  it('事件选择（同页，仅显式 eventId）保留已应用来源/type/severity/offset', () => {
    const ctx = mergeObjectContext({ eventId: 'e2' }, govBase, 'events', 'governance')
    expect(ctx).toMatchObject({ eventId: 'e2', sourceId: 'synth-air-2', eventType: 'rows_rejected', eventSeverity: 'warn', eventOffset: 20 })
  })
  it('分页（仅 offset）保留来源并保留事件选择', () => {
    const ctx = mergeObjectContext({ eventOffset: 30 }, govBase, 'events', 'governance')
    expect(ctx).toMatchObject({ eventOffset: 30, sourceId: 'synth-air-2', eventId: 'e1' })
  })
  it('查询应用显式 eventId:null 清除选择，其余查询保留', () => {
    const ctx = mergeObjectContext({ sourceId: 'synth-air-1', eventId: null }, govBase, 'events', 'governance')
    expect(ctx.eventId).toBeNull()
    expect(ctx.sourceId).toBe('synth-air-1')
  })
  it('查询重置（显式 null）真实清空', () => {
    const ctx = mergeObjectContext({ sourceId: null, eventType: null, eventSeverity: null, eventOffset: null }, govBase, 'events', 'governance')
    expect(ctx).toMatchObject({ sourceId: null, eventType: null, eventSeverity: null, eventOffset: null })
  })
  it('跨页（event→batch）只带显式对象，目标页默认为空', () => {
    const ctx = mergeObjectContext({ batchId: 'b9' }, govBase, 'history', 'data')
    expect(ctx).toMatchObject({ batchId: 'b9', eventId: null, sourceId: null, eventType: null })
  })
  it('同页 data 选择批次保留 batchId', () => {
    const ctx = mergeObjectContext({}, dataBase, 'history', 'data')
    expect(ctx.batchId).toBe('b1')
  })
})

describe('M10 r05 受限来源（返回治理事件）', () => {
  const withOrigin = '#/history/data?mode=legacy&scenario=normal&batchId=b1&from=governance&fromSourceId=synth-air-2&fromEventId=e1&fromType=rows_rejected&fromSeverity=warn&fromOffset=20'
  it('data 页解析受限来源并规范化往返', () => {
    const r = parseHash(withOrigin)
    expect(r.valid).toBe(true)
    expect(r.from).toBe('governance')
    expect(r.fromSourceId).toBe('synth-air-2')
    expect(r.fromEventId).toBe('e1')
    expect(r.fromType).toBe('rows_rejected')
    expect(r.fromSeverity).toBe('warn')
    expect(r.fromOffset).toBe(20)
    expect(parseHash(r.normalizedHash).normalizedHash).toBe(r.normalizedHash)
  })
  it('非 data 页清除受限来源；非法 from/枚举/offset 拒绝', () => {
    const r = parseHash('#/events/governance?mode=legacy&scenario=normal&from=governance&fromEventId=e1')
    expect(r.valid).toBe(true)
    expect(r.from).toBeNull()
    expect(r.normalizedHash).not.toContain('from=')
    expect(parseHash('#/history/data?from=evil').valid).toBe(false)
    expect(parseHash('#/history/data?from=governance&fromType=bogus').valid).toBe(false)
    expect(parseHash('#/history/data?from=governance&fromOffset=1000001').valid).toBe(false)
  })
  it('event→batch 合并保留显式来源，data 同页沿用，跨页清空', () => {
    const govBase = parseHash('#/events/governance?sourceId=synth-air-2&eventId=e1&type=rows_rejected&severity=warn&offset=20')
    const toBatch = mergeObjectContext(
      { batchId: 'b1', from: 'governance', fromSourceId: 'synth-air-2', fromEventId: 'e1', fromType: 'rows_rejected', fromSeverity: 'warn', fromOffset: 20 },
      govBase, 'history', 'data',
    )
    expect(toBatch).toMatchObject({ batchId: 'b1', from: 'governance', fromEventId: 'e1', fromType: 'rows_rejected' })
    const dataBase = parseHash(withOrigin)
    const stay = mergeObjectContext({ batchId: 'b2' }, dataBase, 'history', 'data')
    expect(stay.from).toBe('governance')
    expect(stay.fromEventId).toBe('e1')
    const cross = mergeObjectContext({ top: 'events' } as never, dataBase, 'events', 'governance')
    expect(cross.from).toBeNull()
    expect(cross.fromEventId).toBeNull()
  })
  it('mapGovernanceQuery 显式映射 type/severity/offset → eventType/EventSeverity/EventOffset（含 null/0）', () => {
    expect(mapGovernanceQuery({ sourceId: 's', type: 'rows_rejected', severity: 'warn', offset: null }))
      .toEqual({ sourceId: 's', eventType: 'rows_rejected', eventSeverity: 'warn', eventOffset: null })
    expect(mapGovernanceQuery({ offset: 0 })).toEqual({ eventOffset: 0 })
    expect(mapGovernanceQuery({})).toEqual({})
    expect(mapGovernanceQuery({ sourceId: null, type: null, severity: null, offset: null }))
      .toEqual({ sourceId: null, eventType: null, eventSeverity: null, eventOffset: null })
  })
})

describe('M10 r05 拒绝状态解析 resolveNav', () => {
  it('首次非法 → 新 reason；规范化回响 → echo 且保留；后续不同非法 → 新 reason；合法新意图 → 清；同 canonical 合法 → 清', () => {
    const invalid1 = '#/events/governance?mode=legacy&scenario=normal&type=bogus'
    const r1 = resolveNav(invalid1, null)
    expect(r1.valid).toBe(false)
    expect(r1.echo).toBe(false)
    expect(r1.reason).toContain('type')
    // 规范化回写后的合法 canonical = 上次处理 hash：回响不清 notice
    const normalized = r1.normalizedHash
    const echo = resolveNav(normalized, normalized)
    expect(echo.valid).toBe(true)
    expect(echo.echo).toBe(true)
    // 新的非法（不同 hash）→ 覆盖为新 reason
    const invalid2 = normalized + '&severity=fatal'
    const r2 = resolveNav(invalid2, normalized)
    expect(r2.valid).toBe(false)
    expect(r2.echo).toBe(false)
    expect(r2.reason).toContain('severity')
    // 合法新意图 → 非 echo（调用方清 notice）
    const valid = '#/events/governance?mode=legacy&scenario=normal&sourceId=synth-air-2'
    const rv = resolveNav(valid, normalized)
    expect(rv.valid).toBe(true)
    expect(rv.echo).toBe(false)
  })
  it('编码错误 reason 明确', () => {
    const r = resolveNav('#/history/data?source=%ZZ', null)
    expect(r.valid).toBe(false)
    expect(r.reason).toBeTruthy()
  })
})

describe('M10 r05 残留 · reduceRouteNotice 统一拒绝状态', () => {
  it('非法→合法同 canonical UI reset 清 notice；echo 保留；合法新意图清；后续非法覆盖新 reason', () => {
    // 1) 非法 severity=bad（浏览器导航）
    const bad = '#/events/governance?mode=legacy&scenario=normal&severity=bad'
    const nav = resolveNav(bad, null)
    expect(nav.valid).toBe(false)
    let notice: string | null = null
    notice = reduceRouteNotice(notice, { type: 'browser-nav', raw: bad, lastHandled: null })
    expect(notice).toContain('severity')
    // 2) 规范化回响（合法 canonical）不清
    const echoLast = nav.normalizedHash
    notice = reduceRouteNotice(notice, { type: 'browser-nav', raw: echoLast, lastHandled: echoLast })
    expect(notice).toContain('severity')
    // 3) 明确合法 UI 导航（同 canonical 的 Reset/Apply）→ 清本次 notice（修复残留）
    notice = reduceRouteNotice(notice, { type: 'ui-navigate' })
    expect(notice).toBeNull()
    // 4) 后续非法新意图 → 覆盖新 reason
    const bad2 = echoLast + '&type=bogus'
    notice = reduceRouteNotice(notice, { type: 'browser-nav', raw: bad2, lastHandled: echoLast })
    expect(notice).toContain('type')
    // 5) 合法不同 hash 的新浏览器意图 → 清
    const ok = '#/events/governance?mode=legacy&scenario=normal&sourceId=synth-air-2'
    notice = reduceRouteNotice(notice, { type: 'browser-nav', raw: ok, lastHandled: bad2 })
    expect(notice).toBeNull()
  })
})
