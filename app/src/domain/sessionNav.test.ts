import { describe, expect, it } from 'vitest'
import {
  addEntry,
  backTargetId,
  createStore,
  getEntry,
  hasEntry,
  hasRestorableFocus,
  navKey,
  parentRoute,
  recordCurrentEntry,
  selectTriggerId,
  shouldApplyRestore,
  updateEntry,
  withEntryId,
  type EntryRecord,
} from './sessionNav'

function rec(entryId: string, canonicalHash: string, parentEntryId: string | null): EntryRecord {
  return { entryId, canonicalHash, parentEntryId, scrollY: 0, triggerId: null }
}

describe('会话 history-entry（entryId 模型）', () => {
  it('连续两次 back：每次回到各自直接父条目，不被 parent replace 破坏', () => {
    const store = createStore()
    addEntry(store, rec('e1', '#/schedule/overview', null))
    addEntry(store, rec('e2', '#/schedule/compare', 'e1'))
    addEntry(store, rec('e3', '#/schedule/review', 'e2'))
    addEntry(store, rec('e4', '#/schedule/evidence', 'e3'))
    // evidence → back 到 review
    expect(backTargetId(store, 'e4')).toBe('e3')
    // review → back 到 compare
    expect(backTargetId(store, 'e3')).toBe('e2')
    // compare → back 到 overview
    expect(backTargetId(store, 'e2')).toBe('e1')
    expect(backTargetId(store, 'e1')).toBeNull()
  })

  it('forward 后再次 back：条目仍在，可继续回退', () => {
    const store = createStore()
    addEntry(store, rec('e1', '#/schedule/overview', null))
    addEntry(store, rec('e2', '#/schedule/compare', 'e1'))
    // forward 到 e2 后（条目仍在 store），再次 back 仍能回 e1
    expect(getEntry(store, 'e2')).not.toBeNull()
    expect(backTargetId(store, 'e2')).toBe('e1')
  })

  it('同子页不同 scenario：entryId 不同、各自独立，不因同 navKey 串位置', () => {
    const store = createStore()
    addEntry(store, rec('e1', '#/schedule/compare?mode=legacy&scenario=normal', null))
    addEntry(store, rec('e2', '#/schedule/compare?mode=legacy&scenario=surge', 'e1'))
    updateEntry(store, 'e1', { scrollY: 100 })
    updateEntry(store, 'e2', { scrollY: 500 })
    expect(getEntry(store, 'e1')?.scrollY).toBe(100)
    expect(getEntry(store, 'e2')?.scrollY).toBe(500)
    expect(backTargetId(store, 'e2')).toBe('e1')
  })

  it('直接深链 / 刷新无会话来源：无父条目，走 parentRoute fallback', () => {
    const store = createStore()
    addEntry(store, rec('e1', '#/schedule/evidence', null))
    expect(backTargetId(store, 'e1')).toBeNull()
    expect(parentRoute('schedule', 'evidence')).toEqual({ top: 'schedule', sub: 'compare' })
  })

  it('陈旧 state（entryId 不在本会话）不继承：hasEntry=false', () => {
    const store = createStore()
    expect(hasEntry(store, 'stale-from-prev-session')).toBe(false)
  })

  it('被动 scroll/focus 记录：非恢复态记录当前条目，恢复态跳过', () => {
    const store = createStore()
    addEntry(store, rec('e2', '#/schedule/evidence', 'e1'))
    expect(recordCurrentEntry(store, 'e2', 300, 'subnav-compare', false)).toBe(true)
    expect(getEntry(store, 'e2')?.scrollY).toBe(300)
    // 恢复态不应覆盖旧条目位置
    expect(recordCurrentEntry(store, 'e2', 0, null, true)).toBe(false)
    expect(getEntry(store, 'e2')?.scrollY).toBe(300)
  })

  it('selectTriggerId：无稳定 ID 时保留已有来源 trigger', () => {
    expect(selectTriggerId('', 'review-next-evidence')).toBe('review-next-evidence')
    expect(selectTriggerId('btn-x', 'old')).toBe('btn-x')
    expect(selectTriggerId('', null)).toBeNull()
    expect(selectTriggerId('', undefined)).toBeNull()
  })

  it('重复 popstate/hashchange 通知只恢复一次', () => {
    expect(shouldApplyRestore('e2', null)).toBe(true)
    expect(shouldApplyRestore('e2', 'e2')).toBe(false)
    expect(shouldApplyRestore('e3', 'e2')).toBe(true)
    expect(shouldApplyRestore(null, null)).toBe(false)
  })

  it('navKey / parentRoute / withEntryId / 焦点', () => {
    expect(navKey('schedule', 'evidence')).toBe('schedule/evidence')
    expect(parentRoute('schedule', 'overview')).toBeNull()
    expect(parentRoute('records', 'export')).toEqual({ top: 'records', sub: 'audit' })
    const state = withEntryId({ foo: 1, qihengEntryId: 'old' }, 'new')
    expect(state).toEqual({ foo: 1, qihengEntryId: 'new' })
    expect(hasRestorableFocus(rec('e', 'h', null))).toBe(false)
    expect(hasRestorableFocus({ ...rec('e', 'h', null), triggerId: 'btn' })).toBe(true)
  })
})
