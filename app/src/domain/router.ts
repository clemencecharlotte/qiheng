import type { ScenarioId } from './types'
import type { LabFixtureId, LabPreference } from './lab'

/**
 * 白名单 hash 导航适配器（兼容静态托管）。
 *
 * 只解析固定路径与受控参数；空 hash 默认总览；非法路径 / 定位明确说明并回退。
 * 首次解析与 hashchange / 前后退共用同一解析与去重口径（canonical normalizedHash）。
 * 不解析任意 selector / returnURL，不携带完整身份、理由、问答或自由文本。
 */

export type TopRoute = 'schedule' | 'device' | 'map' | 'agent' | 'data' | 'events' | 'history' | 'records'

export const ROUTE_SPEC: Record<TopRoute, readonly string[]> = {
  schedule: ['overview', 'compare', 'review', 'evidence', 'execution'],
  device: ['units'],
  map: ['topology'],
  agent: ['console'],
  data: ['batches'],
  events: ['list', 'governance'],
  history: ['trend', 'data'],
  records: ['audit', 'export'],
}

export const DEFAULT_HASH = '#/schedule/overview?mode=legacy&scenario=normal'

const SCENARIOS: ScenarioId[] = ['normal', 'surge', 'unit_failure']
const FIXTURES: LabFixtureId[] = [
  'capacity_rise',
  'capacity_oscillate',
  'standby_takeover',
]
const PREFERENCES: LabPreference[] = ['energy_first', 'switch_first']
const SOURCES = ['schedule', 'history'] as const

/**
 * M10 r04 · 治理事件受控查询（bounded）。
 * 与后端 EVENT_TYPES / EVENT_SEVERITIES / _EVENT_OFFSET_MAX 同口径。
 */
export type EventTypeParam = 'import_completed' | 'rows_isolated' | 'rows_rejected' | 'service_error'
export type EventSeverityParam = 'info' | 'warn' | 'error'
export const EVENT_TYPES: readonly EventTypeParam[] = [
  'import_completed',
  'rows_isolated',
  'rows_rejected',
  'service_error',
]
export const EVENT_SEVERITIES: readonly EventSeverityParam[] = ['info', 'warn', 'error']
export const EVENT_OFFSET_MAX = 1_000_000

const ALLOWED_KEYS = new Set([
  'mode',
  'scenario',
  'lab',
  'pref',
  'source',
  't',
  'a',
  'b',
  'batchId',
  'eventId',
  'sourceId',
  'passportId',
  'type',
  'severity',
  'offset',
  // 批次页“返回治理事件”受限来源（bounded，仅在 history/data 有意义）。
  'from',
  'fromSourceId',
  'fromEventId',
  'fromType',
  'fromSeverity',
  'fromOffset',
])

/** 受限来源：仅离线治理事件页，不是自由 returnURL。 */
export type RouteOrigin = 'governance'

export interface RouteState {
  top: TopRoute
  sub: string
  mode: 'legacy' | 'lab'
  scenario: ScenarioId
  lab: LabFixtureId
  pref: LabPreference
  source: 'schedule' | 'history' | null
  t: number | null
  a: number | null
  b: number | null
  /** M10 受控对象定位（bounded token，不是自由 returnURL）。 */
  batchId: string | null
  eventId: string | null
  sourceId: string | null
  /** M29 · 已封存护照定位（真实 passportId；records/audit 子页有意义）。 */
  passportId: string | null
  /** M10 r04 治理事件受控查询（bounded，仅在 governance 子页有意义）。 */
  eventType: EventTypeParam | null
  eventSeverity: EventSeverityParam | null
  eventOffset: number | null
  /** 批次页受限来源（bounded）：从治理事件跳来时的返回上下文；直接深链为空。 */
  from: RouteOrigin | null
  fromSourceId: string | null
  fromEventId: string | null
  fromType: EventTypeParam | null
  fromSeverity: EventSeverityParam | null
  fromOffset: number | null
  valid: boolean
  reason: string | null
  normalizedHash: string
}

function defaultRoute(top: TopRoute = 'schedule', sub?: string): RouteState {
  const normalizedSub = sub ?? ROUTE_SPEC[top][0]
  const route: Omit<RouteState, 'normalizedHash'> = {
    top,
    sub: normalizedSub,
    mode: 'legacy',
    scenario: 'normal',
    lab: 'capacity_rise',
    pref: 'energy_first',
    source: null,
    t: null,
    a: null,
    b: null,
    batchId: null,
    eventId: null,
    sourceId: null,
    passportId: null,
    eventType: null,
    eventSeverity: null,
    eventOffset: null,
    from: null,
    fromSourceId: null,
    fromEventId: null,
    fromType: null,
    fromSeverity: null,
    fromOffset: null,
    valid: true,
    reason: null,
  }
  return { ...route, normalizedHash: routeHash(route) }
}

export function routeHash(route: Omit<RouteState, 'normalizedHash' | 'valid' | 'reason'>): string {
  // scenario 始终携带（审批链需要，lab 模式亦然），unit_failure 刷新不静默成 normal。
  const params: string[] = [`mode=${route.mode}`, `scenario=${route.scenario}`]
  if (route.mode === 'lab') {
    params.push(`lab=${route.lab}`, `pref=${route.pref}`)
  }
  if (route.source) {
    params.push(`source=${route.source}`)
    if (route.t !== null) params.push(`t=${route.t}`)
    if (route.a !== null) params.push(`a=${route.a}`)
    if (route.b !== null) params.push(`b=${route.b}`)
  }
  // 受控对象定位（bounded token）——非自由 returnURL。
  if (route.batchId) params.push(`batchId=${encodeURIComponent(route.batchId)}`)
  if (route.eventId) params.push(`eventId=${encodeURIComponent(route.eventId)}`)
  if (route.sourceId) params.push(`sourceId=${encodeURIComponent(route.sourceId)}`)
  if (route.passportId) params.push(`passportId=${encodeURIComponent(route.passportId)}`)
  // 治理事件受控查询（bounded）：仅在有值时携带；offset=0 视为首页不携带。
  if (route.eventType) params.push(`type=${route.eventType}`)
  if (route.eventSeverity) params.push(`severity=${route.eventSeverity}`)
  if (route.eventOffset !== null && route.eventOffset > 0) params.push(`offset=${route.eventOffset}`)
  // 受限来源（bounded）：仅在批次页携带。
  if (route.from) {
    params.push(`from=${route.from}`)
    if (route.fromSourceId) params.push(`fromSourceId=${encodeURIComponent(route.fromSourceId)}`)
    if (route.fromEventId) params.push(`fromEventId=${encodeURIComponent(route.fromEventId)}`)
    if (route.fromType) params.push(`fromType=${route.fromType}`)
    if (route.fromSeverity) params.push(`fromSeverity=${route.fromSeverity}`)
    if (route.fromOffset !== null && route.fromOffset > 0) params.push(`fromOffset=${route.fromOffset}`)
  }
  return `#/${route.top}/${route.sub}?${params.join('&')}`
}

function isSafeInt(value: string): boolean {
  if (!/^\d+$/.test(value)) return false
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0
}

/** 拒绝错误百分号 / 非法 UTF-8 编码。 */
function hasMalformedEncoding(text: string): boolean {
  if (/%(?![0-9a-fA-F]{2})/.test(text)) return true
  try {
    decodeURIComponent(text)
    return false
  } catch {
    return true
  }
}

export function parseHash(hash: string | null | undefined): RouteState {
  const rawInput = hash ?? ''
  const raw = rawInput.replace(/^#/, '')
  if (raw.trim() === '') return defaultRoute()

  if (hasMalformedEncoding(raw)) {
    const route = defaultRoute()
    return {
      ...route,
      valid: false,
      reason: 'URL 百分号 / UTF-8 编码非法，已回退到调度总览。',
    }
  }

  const [pathPart, queryPart = ''] = raw.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  const topRaw = segments[0]

  // own-property 白名单：constructor / toString / __proto__ 等原型键不得通过。
  if (
    !topRaw ||
    !Object.prototype.hasOwnProperty.call(ROUTE_SPEC, topRaw)
  ) {
    const route = defaultRoute()
    return {
      ...route,
      valid: false,
      reason: `未知导航路径「${pathPart || hash}」，已回退到调度总览。`,
    }
  }
  const top = topRaw as TopRoute
  const allowed = ROUTE_SPEC[top]

  if (segments.length > 2) {
    const route = defaultRoute(top)
    return {
      ...route,
      valid: false,
      reason: `路径层级过多「${pathPart}」，已回退到 ${top} 首个子页。`,
    }
  }
  const sub = segments[1] ?? allowed[0]
  if (!allowed.includes(sub)) {
    const route = defaultRoute(top)
    return {
      ...route,
      valid: false,
      reason: `「${top}」不支持子页「${sub}」，已回退到「${allowed[0]}」。`,
    }
  }

  const reason: string[] = []
  let params: URLSearchParams
  try {
    params = new URLSearchParams(queryPart)
  } catch {
    const route = defaultRoute(top)
    return { ...route, valid: false, reason: '查询串无法解析，已回退。' }
  }
  const seenKeys = new Map<string, number>()
  for (const key of params.keys()) {
    seenKeys.set(key, (seenKeys.get(key) ?? 0) + 1)
    if (!ALLOWED_KEYS.has(key)) reason.push(`未知参数「${key}」`)
  }
  for (const [key, count] of seenKeys) {
    // 重复注册参数（尤其 mode=lab&mode=legacy）明确 invalid，不接受第一值当 valid。
    if (count > 1) reason.push(`重复参数「${key}」`)
  }

  const pick = <T extends string>(
    key: string,
    allowedValues: readonly T[],
    fallback: T,
  ): T => {
    if (!params.has(key)) return fallback
    const value = params.get(key) as T
    if (allowedValues.includes(value)) return value
    reason.push(`参数「${key}」取值非法`)
    return fallback
  }

  const mode = pick('mode', ['legacy', 'lab'] as const, 'legacy')
  const scenario = pick('scenario', SCENARIOS, 'normal')
  const lab = pick('lab', FIXTURES, 'capacity_rise')
  const pref = pick('pref', PREFERENCES, 'energy_first')

  let source: 'schedule' | 'history' | null = null
  if (params.has('source')) {
    const value = params.get('source')
    if ((SOURCES as readonly string[]).includes(value ?? '')) {
      source = value as 'schedule' | 'history'
    } else {
      reason.push('参数「source」取值非法')
    }
  }

  const readIndex = (key: string): number | null => {
    if (!params.has(key)) return null
    const value = params.get(key) ?? ''
    if (!isSafeInt(value)) {
      reason.push(`参数「${key}」必须为安全非负整数`)
      return null
    }
    return Number(value)
  }
  const t = readIndex('t')
  const a = readIndex('a')
  const b = readIndex('b')

  // 受控对象定位：bounded token（字母/数字/_/-，1..64），非法则明确 invalid。
  const readId = (key: string): string | null => {
    if (!params.has(key)) return null
    const value = params.get(key) ?? ''
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
      reason.push(`参数「${key}」格式非法`)
      return null
    }
    return value
  }
  const batchId = readId('batchId')
  const eventId = readId('eventId')
  const sourceId = readId('sourceId')
  const passportId = readId('passportId')

  // 治理事件受控查询：有限枚举与有界 offset（非法/过大明确 invalid）。
  const readEnum = <T extends string>(key: string, allowed: readonly T[]): T | null => {
    if (!params.has(key)) return null
    const value = params.get(key) as T
    if (allowed.includes(value)) return value
    reason.push(`参数「${key}」取值非法`)
    return null
  }
  const eventType = readEnum('type', EVENT_TYPES)
  const eventSeverity = readEnum('severity', EVENT_SEVERITIES)
  let eventOffset: number | null = null
  if (params.has('offset')) {
    const value = params.get('offset') ?? ''
    if (!isSafeInt(value)) {
      reason.push('参数「offset」必须为安全非负整数')
    } else if (Number(value) > EVENT_OFFSET_MAX) {
      reason.push(`参数「offset」超出上限 ${EVENT_OFFSET_MAX}`)
    } else {
      eventOffset = Number(value)
    }
  }

  // 受限来源（bounded）：from=governance + 治理返回上下文；非法一律 invalid。
  const from = readEnum('from', ['governance'] as const)
  const fromSourceId = readId('fromSourceId')
  const fromEventId = readId('fromEventId')
  const fromType = readEnum('fromType', EVENT_TYPES)
  const fromSeverity = readEnum('fromSeverity', EVENT_SEVERITIES)
  let fromOffset: number | null = null
  if (params.has('fromOffset')) {
    const value = params.get('fromOffset') ?? ''
    if (!isSafeInt(value)) {
      reason.push('参数「fromOffset」必须为安全非负整数')
    } else if (Number(value) > EVENT_OFFSET_MAX) {
      reason.push(`参数「fromOffset」超出上限 ${EVENT_OFFSET_MAX}`)
    } else {
      fromOffset = Number(value)
    }
  }

  if ((t !== null || a !== null || b !== null) && !source) {
    reason.push('定位参数缺少必需参数「source」')
  }
  if ((a === null) !== (b === null)) {
    reason.push('区间参数 a / b 必须成对出现')
  }
  // 内部 ExploreState.range 为闭桶索引 [a,b]：a=b 是合法单桶；
  // count 上界在接入各自时轴时用 bucketRangeValid 校验（b<count）。
  if (a !== null && b !== null && a > b) {
    reason.push('区间为闭桶 [a,b]，要求 a ≤ b')
  }

  const base = {
    top,
    sub,
    mode,
    scenario,
    lab,
    pref,
    source,
    t,
    a,
    b,
    batchId,
    eventId,
    sourceId,
    passportId,
    eventType,
    eventSeverity,
    eventOffset,
    from,
    fromSourceId,
    fromEventId,
    fromType,
    fromSeverity,
    fromOffset,
  }
  // 离线功能子页不借回放钟/播放器：在白名单/重复/取值校验之后，规范化清除合成 source/t/a/b。
  const offlineSub =
    (top === 'history' && sub === 'data') || (top === 'events' && sub === 'governance')
  if (offlineSub) {
    base.source = null
    base.t = null
    base.a = null
    base.b = null
  }
  // 治理查询参数只在 governance 子页有意义：其它页规范化清除（不污染导航）。
  if (!(top === 'events' && sub === 'governance')) {
    base.eventType = null
    base.eventSeverity = null
    base.eventOffset = null
  }
  // 受限来源只在 data 子页有意义：其它页规范化清除。
  if (!(top === 'history' && sub === 'data')) {
    base.from = null
    base.fromSourceId = null
    base.fromEventId = null
    base.fromType = null
    base.fromSeverity = null
    base.fromOffset = null
  }
  const normalizedHash = routeHash(base)
  if (reason.length > 0) {
    // 参数非法：保留合法路径与默认值，明确原因并给出规范化回退。
    const clean = {
      top,
      sub,
      mode,
      scenario,
      lab,
      pref,
      source: null,
      t: null,
      a: null,
      b: null,
      batchId: null,
      eventId: null,
      sourceId: null,
      passportId: null,
      eventType: null,
      eventSeverity: null,
      eventOffset: null,
      from: null,
      fromSourceId: null,
      fromEventId: null,
      fromType: null,
      fromSeverity: null,
      fromOffset: null,
    }
    return {
      ...base,
      source: null,
      t: null,
      a: null,
      b: null,
      batchId: null,
      eventId: null,
      sourceId: null,
      passportId: null,
      eventType: null,
      eventSeverity: null,
      eventOffset: null,
      from: null,
      fromSourceId: null,
      fromEventId: null,
      fromType: null,
      fromSeverity: null,
      fromOffset: null,
      valid: false,
      reason: `${reason.join('；')}；已忽略并规范化。`,
      normalizedHash: routeHash(clean),
    }
  }
  return { ...base, valid: true, reason: null, normalizedHash }
}

export function routesEqual(a: RouteState, b: RouteState): boolean {
  return a.normalizedHash === b.normalizedHash
}

/** 受控对象/查询上下文（batchId/eventId/sourceId + 治理查询 + 批次页受限来源）。 */
export interface ObjectContext {
  batchId: string | null
  eventId: string | null
  sourceId: string | null
  passportId: string | null
  eventType: EventTypeParam | null
  eventSeverity: EventSeverityParam | null
  eventOffset: number | null
  from: RouteOrigin | null
  fromSourceId: string | null
  fromEventId: string | null
  fromType: EventTypeParam | null
  fromSeverity: EventSeverityParam | null
  fromOffset: number | null
}

/**
 * 对象定位/查询上下文合并（导航唯一口径）：
 * - 显式提供（含 null）→ 用其值（null 表示清除）；
 * - 未提供且同属一个离线子页 → 沿用 base 当前上下文（事件选择/分页/筛选不丢已应用来源）；
 * - 其余（跨页）→ 清空，避免旧参数污染导航。
 */
export function mergeObjectContext(
  partial: Partial<ObjectContext>,
  base: Pick<RouteState, 'top' | 'sub'> & ObjectContext,
  nextTop: TopRoute,
  nextSub: string,
): ObjectContext {
  const has = (k: keyof ObjectContext) => Object.prototype.hasOwnProperty.call(partial, k)
  const stayData = nextTop === 'history' && nextSub === 'data' && base.top === 'history' && base.sub === 'data'
  const stayGov = nextTop === 'events' && nextSub === 'governance' && base.top === 'events' && base.sub === 'governance'
  return {
    batchId: has('batchId') ? partial.batchId ?? null : stayData ? base.batchId : null,
    eventId: has('eventId') ? partial.eventId ?? null : stayGov ? base.eventId : null,
    sourceId: has('sourceId') ? partial.sourceId ?? null : stayGov ? base.sourceId : null,
    passportId: has('passportId') ? partial.passportId ?? null : null,
    eventType: has('eventType') ? partial.eventType ?? null : stayGov ? base.eventType : null,
    eventSeverity: has('eventSeverity') ? partial.eventSeverity ?? null : stayGov ? base.eventSeverity : null,
    eventOffset: has('eventOffset') ? partial.eventOffset ?? null : stayGov ? base.eventOffset : null,
    from: has('from') ? partial.from ?? null : stayData ? base.from : null,
    fromSourceId: has('fromSourceId') ? partial.fromSourceId ?? null : stayData ? base.fromSourceId : null,
    fromEventId: has('fromEventId') ? partial.fromEventId ?? null : stayData ? base.fromEventId : null,
    fromType: has('fromType') ? partial.fromType ?? null : stayData ? base.fromType : null,
    fromSeverity: has('fromSeverity') ? partial.fromSeverity ?? null : stayData ? base.fromSeverity : null,
    fromOffset: has('fromOffset') ? partial.fromOffset ?? null : stayData ? base.fromOffset : null,
  }
}

/** 治理事件面板 patch（type/severity/offset）→ 导航 query 键（eventType/eventSeverity/eventOffset）typed 适配。 */
export interface GovernanceQueryPatch {
  sourceId?: string | null
  type?: EventTypeParam | null
  severity?: EventSeverityParam | null
  offset?: number | null
}
export function mapGovernanceQuery(q: GovernanceQueryPatch): Partial<ObjectContext> {
  const out: Partial<ObjectContext> = {}
  if (Object.prototype.hasOwnProperty.call(q, 'sourceId')) out.sourceId = q.sourceId ?? null
  if (Object.prototype.hasOwnProperty.call(q, 'type')) out.eventType = q.type ?? null
  if (Object.prototype.hasOwnProperty.call(q, 'severity')) out.eventSeverity = q.severity ?? null
  if (Object.prototype.hasOwnProperty.call(q, 'offset')) out.eventOffset = q.offset ?? null
  return out
}

/** hash 是否治理事件子页（用于 sessionNav 父条目识别）。 */
export function isGovernanceHash(hash: string | null | undefined): boolean {
  const r = parseHash(hash)
  return r.top === 'events' && r.sub === 'governance'
}

/**
 * 每次真实导航意图的拒绝状态解析（纯函数，可测）：
 * - echo：本次 hash 与上次真正处理过的 hash 相同（规范化后的重复 popstate/hashchange 回响）；
 * - valid/reason/normalizedHash：来自 parseHash。
 * 调用方口径：invalid → 用 reason 覆盖 notice；valid 且非 echo → 清 notice；echo → 保持当前 notice。
 */
export function resolveNav(
  rawHash: string,
  lastHandledHash: string | null,
): { valid: boolean; reason: string | null; echo: boolean; normalizedHash: string } {
  const parsed = parseHash(rawHash)
  return {
    valid: parsed.valid,
    reason: parsed.reason,
    echo: rawHash === lastHandledHash,
    normalizedHash: parsed.normalizedHash,
  }
}

/**
 * 统一的拒绝提示状态归约（纯函数，可测）：
 * - ui-navigate：明确合法 UI 导航（同 hash 亦算）→ 清本次 notice；
 * - browser-nav：非法 → 用本次 reason 覆盖；合法 echo（规范化回响）→ 保留；合法新意图 → 清。
 * 保证：合法同 canonical 的 UI 重置/应用能清掉旧拒绝提示，而规范化后的 echo 不会误清。
 */
export type RouteNoticeEvent =
  | { type: 'ui-navigate' }
  | { type: 'browser-nav'; raw: string; lastHandled: string | null }

export function reduceRouteNotice(prev: string | null, evt: RouteNoticeEvent): string | null {
  if (evt.type === 'ui-navigate') return null
  const nav = resolveNav(evt.raw, evt.lastHandled)
  if (!nav.valid) return nav.reason
  if (nav.echo) return prev
  return null
}

/**
 * 闭桶区间 [a,b] 在给定时轴 count 下是否合法：0 ≤ a ≤ b < count。
 * a=b 为合法单桶；b=count 非法（与 explore 的闭桶 [lo,hi] 语义一致）。
 */
export function bucketRangeValid(a: number, b: number, count: number): boolean {
  return (
    Number.isInteger(count) &&
    count > 0 &&
    Number.isSafeInteger(a) &&
    Number.isSafeInteger(b) &&
    a >= 0 &&
    b >= a &&
    b < count
  )
}

/** 单点时刻索引 t 在给定时轴 count 下是否合法：0 ≤ t < count。 */
export function timeIndexValid(t: number, count: number): boolean {
  return Number.isSafeInteger(t) && Number.isInteger(count) && count > 0 && t >= 0 && t < count
}

export function workspaceForTop(top: TopRoute): 'schedule' | 'device' | 'map' | 'agent' | 'data' | 'events' | 'history' | 'assistant' {
  if (top === 'records') return 'assistant'
  return top
}

export const TOP_LABEL: Record<TopRoute, string> = {
  schedule: '调度',
  device: '设备',
  map: '关系MAP',
  agent: '智能体',
  data: '数据治理',
  events: '事件',
  history: '回放证据',
  records: '记录',
}

export const SUB_LABEL: Record<TopRoute, Record<string, string>> = {
  schedule: {
    overview: '总览',
    compare: '方案比较',
    review: '复验人审',
    evidence: '关联证据',
    execution: '合成执行',
  },
  device: { units: '机组与约束' },
  map: { topology: '关系拓扑' },
  agent: { console: '智能体工作区' },
  data: { batches: '离线批次与治理' },
  events: { list: '事件列表', governance: '治理事件' },
  history: { trend: '回放趋势', data: '数据接入' },
  records: { audit: '审计与决策', export: '导出' },
}
