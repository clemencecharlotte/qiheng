// @vitest-environment jsdom
/**
 * r45 ③ · 全表面登记与分类（模板+实例ID），真实路由遍历；portal/按需表面单独列未遍历或交互打开。
 * 输出：tools/surfaces-r45.json + 30-deliveries/outgoing/20261015-r45-surface-motion-chat/SURFACES-TABLE.md
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import App from './App'

declare const __dirname: string
const FS = fs as unknown as { mkdirSync(p: string, o?: unknown): void; writeFileSync(p: string, s: string): void }
const join = (...parts: string[]) => parts.join('/')
const resolve = (base: string, rel: string) => `${base}/${rel}`.replace(/\\/g, '/')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function stub() {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(window as unknown as { ResizeObserver?: unknown }).ResizeObserver = RO
  ;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = RO
  ;(HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView = function () {}
  ;(Element.prototype as unknown as { getClientRects?: () => unknown }).getClientRects = function () {
    return Object.assign([{ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, x: 0, y: 0 }], { item: () => null })
  }
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 0) as unknown as number
  window.cancelAnimationFrame = (id) => window.clearTimeout(id)
}

const ROUTES = [
  '#/welcome',
  '#/schedule/overview?mode=legacy&scenario=normal',
  '#/schedule/compare?mode=legacy&scenario=normal',
  '#/schedule/review?mode=legacy&scenario=normal',
  '#/device/units',
  '#/map/topology',
  '#/agent',
  '#/events/governance',
  '#/data/batches',
  '#/history/trend',
  '#/records/audit',
]

type Cat = 'layout-only' | 'glass-surface' | 'read-surface' | 'control' | 'overlay' | 'remove'
const RULES: Array<{ id: string; sel: string; cat: Cat; component: string; decision: string }> = [
  { id: 'SUR-SHL-001', sel: '.ws-head', cat: 'glass-surface', component: 'App.tsx', decision: 'keep（单壳页头）' },
  { id: 'SUR-SHL-002', sel: '.app-rail', cat: 'glass-surface', component: 'App.tsx', decision: 'keep' },
  { id: 'SUR-SHL-003', sel: '.rail-tools', cat: 'layout-only', component: 'App.tsx', decision: 'keep（环境+指引工具行）' },
  { id: 'SUR-SHL-004', sel: '[data-testid="rail-guide-btn"]', cat: 'control', component: 'App.tsx', decision: 'keep（单入口）' },
  { id: 'SUR-SHL-005', sel: '.appearance-scene-trigger', cat: 'control', component: 'AppearanceDock.tsx', decision: 'keep' },
  { id: 'SUR-WEL-001', sel: '.qh-hero', cat: 'layout-only', component: 'WelcomePage.tsx', decision: 'keep（无卡幕布段）' },
  { id: 'SUR-WEL-002', sel: '.qh-w1-showcase', cat: 'layout-only', component: 'WelcomePage.tsx', decision: 'decard（r44）' },
  { id: 'SUR-WEL-003', sel: '.qh-flowval-top', cat: 'layout-only', component: 'WelcomePage.tsx', decision: 'remove-card（r45 A2）' },
  { id: 'SUR-WEL-004', sel: '.qh-bounds', cat: 'remove', component: 'WelcomePage.tsx', decision: 'remove（r45 A4，内容入 notes bounds）' },
  { id: 'SUR-WEL-005', sel: '.qh-cta-sec', cat: 'remove', component: 'WelcomePage.tsx', decision: 'remove（r45 A5，入口仅 Hero）' },
  { id: 'SUR-WEL-006', sel: '.qh-ftr-in', cat: 'layout-only', component: 'WelcomePage.tsx', decision: 'decard（r45 A6）' },
  { id: 'SUR-WEL-007', sel: '.qh-wheel-card', cat: 'glass-surface', component: 'previewWheel/PreviewWheel.tsx', decision: 'keep（A1 同族）' },
  { id: 'SUR-WEL-008', sel: '.qh-wheel-controls > button', cat: 'control', component: 'previewWheel/PreviewWheel.tsx', decision: 'keep（44px 同族箭头）' },
  { id: 'SUR-WEL-009', sel: '.qh-wheel-tabs > button', cat: 'control', component: 'previewWheel/PreviewWheel.tsx', decision: 'keep' },
  { id: 'SUR-WEL-010', sel: '.qh-device-orbit-wrap', cat: 'glass-surface', component: 'DeviceSystemExperience.tsx', decision: 'keep' },
  { id: 'SUR-WEL-011', sel: '.qh-demo-machine', cat: 'glass-surface', component: 'DemoFleet.tsx', decision: 'keep（r44 设备优先卡）' },
  { id: 'SUR-WEL-012', sel: '.qh-passport', cat: 'glass-surface', component: 'WelcomePage.tsx', decision: 'keep（r44 真实摘要）' },
  { id: 'SUR-WEL-013', sel: '.qh-judge', cat: 'glass-surface', component: 'WelcomePage.tsx', decision: 'keep' },
  { id: 'SUR-WEL-014', sel: '.qh-machine-rig', cat: 'layout-only', component: 'machineRig.tsx', decision: 'keep（2.5D 机构层）' },
  { id: 'SUR-CON-001', sel: '.panel', cat: 'glass-surface', component: 'workspaces/*', decision: 'keep（读区内层另记 read）' },
  { id: 'SUR-CON-002', sel: '.console-decision-brief', cat: 'glass-surface', component: 'SchedulingWorkspace.tsx', decision: 'keep' },
  { id: 'SUR-CON-003', sel: '.table-wrap, .period-table', cat: 'read-surface', component: '多', decision: 'keep（局部读底）' },
  { id: 'SUR-CON-004', sel: '.trend', cat: 'read-surface', component: 'HistoryTrend/SupplyDemandTrend', decision: 'keep（r44 曲线+低alpha柱）' },
  { id: 'SUR-CON-005', sel: '.source-bar-controls', cat: 'control', component: 'SchedulingWorkspace.tsx', decision: 'keep（r44 去双边框）' },
  { id: 'SUR-CON-006', sel: '.transport-bar', cat: 'control', component: 'ObservationTransport.tsx', decision: 'keep' },
  { id: 'SUR-EVT-001', sel: '.qel', cat: 'glass-surface', component: 'EventsWorkspace.tsx', decision: 'keep（r44 一级列表）' },
  { id: 'SUR-EVT-002', sel: '.qel-row', cat: 'control', component: 'EventsWorkspace.tsx', decision: 'keep（扫读行）' },
  { id: 'SUR-EVT-003', sel: '.qel-drawer', cat: 'overlay', component: 'EventsWorkspace.tsx', decision: 'keep（二级详情）' },
  { id: 'SUR-AGT-001', sel: '.chat-console', cat: 'layout-only', component: 'ChatConsole.tsx', decision: 'keep（无大卡）' },
  { id: 'SUR-AGT-002', sel: '.chat-bubble', cat: 'glass-surface', component: 'ChatConsole.tsx', decision: 'keep（消息气泡同族）' },
  { id: 'SUR-AGT-003', sel: '.chat-composer', cat: 'glass-surface', component: 'ChatConsole.tsx', decision: 'keep（中心输入）' },
  { id: 'SUR-AGT-004', sel: '.chat-sug', cat: 'control', component: 'ChatConsole.tsx', decision: 'keep（≤3 短建议）' },
  { id: 'SUR-AGT-005', sel: '.chat-drawer', cat: 'overlay', component: 'ChatConsole.tsx', decision: 'keep（工具/资料按需）' },
  { id: 'SUR-OVL-001', sel: '.disc-pop, .disc-tip', cat: 'overlay', component: 'ui/Disclosure.tsx', decision: 'keep' },
  { id: 'SUR-OVL-002', sel: '.u-dialog, .topbar-modal, .appearance-scene-pop', cat: 'overlay', component: 'unified/*', decision: 'keep' },
  { id: 'SUR-OVL-003', sel: '.tour-invite, .driver-popover', cat: 'overlay', component: 'ConsoleTour.tsx', decision: 'keep（可关/不遮输入）' },
  { id: 'SUR-OVL-004', sel: '.device-details-drawer', cat: 'overlay', component: 'DeviceDetailsDrawer.tsx', decision: 'keep' },
  { id: 'SUR-CTL-001', sel: '.btn, button:not([class])', cat: 'control', component: '全局', decision: 'keep（同族 44px）' },
  { id: 'SUR-CTL-002', sel: 'input, select, textarea', cat: 'control', component: '全局', decision: 'keep' },
  { id: 'SUR-CTL-003', sel: '.tag, .chip-btn, .qel-lv, .qel-family', cat: 'control', component: '全局', decision: 'keep（胶囊语义）' },
  { id: 'SUR-CTL-004', sel: '.qh-note-details, details', cat: 'control', component: '全局', decision: 'keep（按需说明）' },
]

const UNTRAVERSED = [
  { id: 'SUR-OVL-005', what: '应用发布表单（平台侧，非本仓 DOM）', reason: '平台 UI' },
  { id: 'SUR-OVL-006', what: 'CommandPalette 打开态', reason: '需 Ctrl+K 交互；本轮未遍历' },
  { id: 'SUR-OVL-007', what: 'AuthDialog 打开态', reason: '需点击注册/登录；本轮未遍历' },
  { id: 'SUR-OVL-008', what: 'NotesBar 展开态', reason: '需点击说明；本轮未遍历（结构同 overlay 族）' },
]

interface Row { route: string; templateId: string; instanceId: string; count: number }

const rows: Row[] = []
const templateSeen = new Set<string>()

describe('r45 surface registry', () => {
  it('traverses real routes and registers surfaces', async () => {
    stub()
    for (const route of ROUTES) {
      window.history.replaceState(null, '', route)
      window.localStorage.clear()
      document.body.innerHTML = '<div id="t"></div>'
      const root: Root = createRoot(document.getElementById('t')!)
      await act(async () => { root.render(<App />); await new Promise((r) => setTimeout(r, 25)) })
      for (const rule of RULES) {
        const els = document.querySelectorAll(rule.sel)
        if (els.length) {
          templateSeen.add(rule.id)
          els.forEach((_, i) => rows.push({ route, templateId: rule.id, instanceId: `${rule.id}:${route.split('?')[0]}#${i}`, count: els.length }))
        }
      }
      await act(async () => { root.unmount() })
    }
    const byTemplate = new Map<string, { routes: string[]; instances: number }>()
    for (const r of rows) {
      const e = byTemplate.get(r.templateId) ?? { routes: [], instances: 0 }
      if (!e.routes.includes(r.route)) e.routes.push(r.route)
      e.instances = Math.max(e.instances, r.count)
      byTemplate.set(r.templateId, e)
    }
    const out = {
      generatedAt: new Date().toISOString(),
      rules: RULES.map((r) => ({ ...r, instantiated: templateSeen.has(r.id), routes: byTemplate.get(r.id)?.routes ?? [] })),
      stats: {
        templates: RULES.length,
        instantiated: templateSeen.size,
        notInstantiated: RULES.filter((r) => !templateSeen.has(r.id)).map((r) => r.id),
        untraversed: UNTRAVERSED,
        instanceRows: rows.length,
      },
    }
    const toolsDir = resolve(__dirname, '../../../../00-control/20261014-dsh-full-handoff/tools')
    FS.mkdirSync(toolsDir, { recursive: true })
    FS.writeFileSync(join(toolsDir, 'surfaces-r45.json'), JSON.stringify(out, null, 2))
    const md = ['# R45 表面登记（模板/实例/分类/决定）', '',
      `模板 ${RULES.length} · 已实例化 ${templateSeen.size} · 实例行 ${rows.length} · 未遍历 ${UNTRAVERSED.length}`, '',
      '| ID | 分类 | 组件 | selector | 决定 | 实例路由数 |', '|---|---|---|---|---|---|',
      ...RULES.map((r) => `| ${r.id} | ${r.cat} | ${r.component} | \`${r.sel}\` | ${r.decision} | ${byTemplate.get(r.id)?.routes.length ?? 0} |`),
      '', '## 未遍历（如实）', ...UNTRAVERSED.map((u) => `- ${u.id} ${u.what}：${u.reason}`), ''].join('\n')
    const deliv = resolve(__dirname, '../../../../30-deliveries/outgoing/20261015-r45-surface-motion-chat')
    FS.mkdirSync(deliv, { recursive: true })
    FS.writeFileSync(join(deliv, 'SURFACES-TABLE.md'), md)
    expect(templateSeen.size).toBeGreaterThan(20)
  }, 120000)
})
