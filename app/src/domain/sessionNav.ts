import type { EvidenceReturnSnapshot } from '../integration/evidenceReturn'
/**
 * 仅会话的 history-entry 适配（纯逻辑）。
 * 每个浏览器历史条目赋唯一 entryId；Map 按 entryId 保存 canonicalHash、
 * 直接父条目 parentEntryId、scrollY 与稳定触发器 ID。
 * App 侧负责 window.history.pushState/back 与 DOM scroll/focus 恢复。
 */

export interface EntryRecord {
  entryId: string
  canonicalHash: string
  /** 我方直接父条目；直接深链 / 刷新 / 新会话为 null。 */
  parentEntryId: string | null
  scrollY: number
  triggerId: string | null
  context?: EvidenceReturnSnapshot
}

export type SessionStore = Map<string, EntryRecord>

export function createStore(): SessionStore {
  return new Map()
}

export function addEntry(store: SessionStore, record: EntryRecord): void {
  store.set(record.entryId, record)
}

export function getEntry(
  store: SessionStore,
  entryId: string | null | undefined,
): EntryRecord | null {
  if (!entryId) return null
  return store.get(entryId) ?? null
}

export function hasEntry(store: SessionStore, entryId: string | null | undefined): boolean {
  return Boolean(entryId && store.has(entryId))
}

export function updateEntry(
  store: SessionStore,
  entryId: string,
  patch: Partial<Omit<EntryRecord, 'entryId'>>,
): void {
  const current = store.get(entryId)
  if (!current) return
  store.set(entryId, { ...current, ...patch })
}

/**
 * 真实返回目标：仅当当前条目确有“我方直接父条目”且仍在会话 Map 中才返回其 entryId，
 * 供 App 调用 history.back()。直接深链 / 刷新 / 新会话返回 null，走父页 fallback。
 */
export function backTargetId(
  store: SessionStore,
  currentEntryId: string | null | undefined,
): string | null {
  const current = getEntry(store, currentEntryId)
  if (!current || !current.parentEntryId) return null
  return store.has(current.parentEntryId) ? current.parentEntryId : null
}

export function navKey(top: string, sub: string): string {
  return `${top}/${sub}`
}

interface RoutePoint {
  top: string
  sub: string
}

const PARENT: Record<string, RoutePoint> = {
  'schedule/overview': { top: 'schedule', sub: 'overview' },
  'schedule/compare': { top: 'schedule', sub: 'overview' },
  'schedule/review': { top: 'schedule', sub: 'compare' },
  'schedule/evidence': { top: 'schedule', sub: 'compare' },
  'events/list': { top: 'schedule', sub: 'overview' },
  'history/trend': { top: 'schedule', sub: 'overview' },
  'records/audit': { top: 'schedule', sub: 'overview' },
  'records/export': { top: 'records', sub: 'audit' },
}

/** 无 in-app 来源（直接深链）时的父页 fallback；overview 返回 null。 */
export function parentRoute(top: string, sub: string): RoutePoint | null {
  const parent = PARENT[navKey(top, sub)]
  if (!parent) return null
  if (parent.top === top && parent.sub === sub) return null
  return parent
}

export function hasRestorableFocus(snapshot: EntryRecord | null): boolean {
  return Boolean(snapshot && snapshot.triggerId)
}

/**
 * 被动记录当前条目的 scroll/focus。程序性恢复期间（restoring=true）跳过，
 * 避免把恢复写入的位置当成用户新位置覆盖旧条目。
 */
export function recordCurrentEntry(
  store: SessionStore,
  entryId: string | null | undefined,
  scrollY: number,
  triggerId: string | null,
  restoring: boolean,
): boolean {
  if (restoring || !entryId || !store.has(entryId)) return false
  updateEntry(store, entryId, { scrollY, triggerId })
  return true
}

/**
 * 是否应执行恢复：同一 entry 的 popstate/hashchange 重复通知只恢复一次，
 * 避免第二次通知用旧记录再次滚动覆盖已恢复位置。
 */
/**
 * 选择要保存的触发器 ID：只有当前有稳定 ID 才覆盖；否则保留已有来源 trigger。
 * 无 ID / 标题等程序性 focus 不得把已有来源 trigger 清成 null。
 */
export function selectTriggerId(
  activeId: string,
  existing: string | null | undefined,
): string | null {
  return activeId || existing || null
}

export function shouldApplyRestore(
  targetEntryId: string | null | undefined,
  lastRestoredEntryId: string | null | undefined,
): boolean {
  return Boolean(targetEntryId) && targetEntryId !== lastRestoredEntryId
}

export interface HistoryStateLike {
  qihengEntryId?: string
  [key: string]: unknown
}

/** 合并 entryId 到现有 history.state，保留其他字段（不写 null）。 */
export function withEntryId(
  state: HistoryStateLike | null | undefined,
  entryId: string,
): HistoryStateLike {
  return { ...(state ?? {}), qihengEntryId: entryId }
}
