import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DeviceState, OverviewSnapshot } from '../domain/overview'
import { UNITS } from '../domain/units'
import ContextRail from './ContextRail'

type RailProps = ComponentProps<typeof ContextRail>
type OutputElement = ReactElement<Record<string, unknown>>

// 本组件没有 hooks：SSR 核只读内容，直接遍历输出元素核回调接线。
// 不使用额外 DOM 依赖，也不将这些检查称为真实浏览器/布局/键盘验收。
function outputElements(node: ReactNode): OutputElement[] {
  if (Array.isArray(node)) return node.flatMap(outputElements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node as OutputElement, ...outputElements(node.props.children)]
}

function snapshotFixture(): OverviewSnapshot {
  return {
    minuteOfDay: 720,
    label: '12:00',
    demand: 22.5,
    supply: 24.5,
    margin: 2,
    plannedRunningUnitIds: ['AC-01', 'AC-02'],
    planType: 'recommendation',
    planFeasible: true,
    planLabel: '建议（优化）',
    planNote: '同源方案说明：组合、负载与供气总量来自同一建议快照。',
    units: UNITS.map((unit, index) => ({
      unit: { ...unit },
      state: index === 2 ? 'unknown' : 'running',
      eligible: index !== 2,
      running: index !== 2,
      load: index === 2 ? null : 12.25,
      loadRatio: index === 2 ? null : 0.6125,
      powerKw: index === 2 ? null : 83.7,
      note: index === 2 ? '原资格说明：离心机喘振边界未核实，仅监测。' : null,
      hasBranch: index !== 2,
    })),
  }
}

function railProps(overrides: Partial<RailProps> = {}): RailProps {
  return {
    snapshot: snapshotFixture(),
    scenarioLabel: '合成正常场景',
    linkedUnitId: null,
    hoverUnitId: null,
    onToggleLock: vi.fn(),
    onClearLock: vi.fn(),
    ...overrides,
  }
}

function rendered(props: RailProps): string {
  return renderToString(<ContextRail {...props} />)
}

function fact(html: string, label: string): string {
  const match = html.match(new RegExp(`<dt>${label}</dt><dd[^>]*>([\\s\\S]*?)<\\/dd>`))
  expect(match, `缺少事实字段：${label}`).not.toBeNull()
  return match![1].replace(/<[^>]+>/g, '').trim()
}

function action(props: RailProps): () => void {
  const button = outputElements(ContextRail(props)).find((element) => element.type === 'button')
  expect(button, '缺少锁定/取消锁定按钮').toBeDefined()
  expect(button!.props.type).toBe('button')
  return button!.props.onClick as () => void
}

describe('ContextRail 同源只读证据（SSR / 元素合同窄验）', () => {
  it('未选对象时保留完整站点快照、场景、观察时刻及原始 planNote', () => {
    const props = railProps()
    const html = rendered(props)
    expect(html).toContain('data-context-mode="overview"')
    // r42 收束：来源口径一处（同源快照标签），长说明与交互说明 popover 已删；正文保短可见。
    expect(html).toContain('同源快照')
    expect(fact(html, '观察时刻')).toBe(props.snapshot.label)
    expect(fact(html, '场景')).toBe(props.scenarioLabel)
    expect(fact(html, '需求')).toBe('22.5 m³/min')
    expect(fact(html, '方案供气')).toBe('24.5 m³/min')
    expect(fact(html, '余量')).toBe('+2.0 m³/min')
    expect(fact(html, '方案投运')).toBe('AC-01 / AC-02')
    expect(html).toContain(props.snapshot.planLabel)
    expect(html).toContain(props.snapshot.planNote)
    expect(html).toContain('尚未选定对象')
    expect(html).not.toContain('交互说明')
    // r42：只读宣言归工作区来源徽标/脚注，rail 不再重复；空态一句原因+指向。
    expect(html).not.toContain('context-readonly-note')
    expect(html).not.toContain('disc-pop-trigger')
    expect(props.onToggleLock).not.toHaveBeenCalled()
    expect(props.onClearLock).not.toHaveBeenCalled()
  })

  it('对象详情分为观察快照 / 机组参数 / 资格边界，原字段不丢失', () => {
    const props = railProps({ linkedUnitId: 'AC-01' })
    const html = rendered(props)
    for (const group of ['观察快照', '机组参数', '资格边界']) {
      expect(html).toContain(`<section class="context-section" aria-label="${group}">`)
    }
    expect(html).toContain('1# 螺杆空压机')
    expect(html).toContain('AC-01')
    expect(html).toContain('螺杆机')
    expect(html).toContain('在役')
    expect(fact(html, '供气')).toBe('12.3 m³/min')
    expect(fact(html, '负载率')).toBe('61%')
    expect(fact(html, '功率（估算）')).toBe('84 kW')
    expect(fact(html, '额定供气')).toBe('20 m³/min')
    expect(fact(html, '最小稳定负载')).toBe('40%')
    expect(fact(html, '额定功率')).toBe('132 kW')
    expect(fact(html, '最小启停间隔')).toBe('10 min')
    expect(fact(html, '自动调度资格')).toBe('已纳入候选')
    expect(fact(html, '支路映射')).toBe('有对应支路')
    expect(fact(html, '喘振边界')).toBe('已核实')
    expect(html).toContain('该对象已纳入自动调度候选，支路曲线来自同一方案快照。')
    expect(html).toContain(props.snapshot.planNote)
  })

  it('锁定对象优先于另一个 hover 对象，取消仅调用原 onClearLock', () => {
    const props = railProps({ linkedUnitId: 'AC-01', hoverUnitId: 'AC-03' })
    const html = rendered(props)
    expect(html).toContain('data-context-mode="locked"')
    expect(html).toContain('1# 螺杆空压机')
    expect(html).not.toContain('3# 离心空压机')
    expect(html).toContain('取消锁定（Esc）')
    expect(html).not.toContain('临时预览')
    action(props)()
    expect(props.onClearLock).toHaveBeenCalledOnce()
    expect(props.onClearLock).toHaveBeenCalledWith()
    expect(props.onToggleLock).not.toHaveBeenCalled()
  })

  it('无锁定时 hover 可预览，按钮只将当前对象 ID 交给 onToggleLock', () => {
    const props = railProps({ hoverUnitId: 'AC-02' })
    const html = rendered(props)
    expect(html).toContain('data-context-mode="preview"')
    expect(html).toContain('临时预览（未锁定）')
    expect(html).toContain('2# 螺杆空压机')
    expect(html).toContain('锁定该对象')
    expect(html).not.toContain('取消锁定（Esc）')
    expect(props.onToggleLock).not.toHaveBeenCalled()
    action(props)()
    expect(props.onToggleLock).toHaveBeenCalledOnce()
    expect(props.onToggleLock).toHaveBeenCalledWith('AC-02')
    expect(props.onClearLock).not.toHaveBeenCalled()
  })

  it.each([
    { linkedUnitId: 'removed-unit', hoverUnitId: 'AC-02' },
    { linkedUnitId: null, hoverUnitId: 'removed-unit' },
  ])('缺失对象 ID 不伪造详情或隐式改变锁定：%j', (selection) => {
    const props = railProps(selection)
    const html = rendered(props)
    expect(html).toContain('data-context-mode="overview"')
    expect(html).toContain('站点证据总览')
    expect(html).not.toContain('2# 螺杆空压机')
    expect(props.onToggleLock).not.toHaveBeenCalled()
    expect(props.onClearLock).not.toHaveBeenCalled()
  })

  it('未核实离心机保持原说明与所有缺值，不补零或新增启停建议', () => {
    const props = railProps({ linkedUnitId: 'AC-03' })
    const view = props.snapshot.units[2]
    const html = rendered(props)
    expect(html).toContain('离心机')
    expect(html).toContain('边界未知 · 仅监测')
    expect(fact(html, '供气')).toBe('未知')
    expect(fact(html, '负载率')).toBe('未知')
    expect(fact(html, '功率（估算）')).toBe('未监测')
    expect(fact(html, '自动调度资格')).toBe('未纳入候选')
    expect(fact(html, '支路映射')).toBe('无对应支路 · 仅监测')
    expect(fact(html, '喘振边界')).toBe('未核实')
    expect(html).toContain(view.note!)
    expect(html).toContain(props.snapshot.planNote)
    expect(html).toContain('该对象无对应支路映射，仅监测；不生成支路数据或启停建议。')
    expect(html).not.toContain('<dd>0.0 m³/min</dd>')
    expect(html).not.toContain('<dd>0%</dd>')
    expect(html).not.toContain('<dd>0 kW</dd>')
    expect(html).not.toContain('批准')
    expect(html).not.toContain('<dialog')
    expect(html).not.toContain('aria-modal')
  })

  it.each<[DeviceState, string]>([
    ['running', '在役'],
    ['idle', '待机'],
    ['fault', '单机故障'],
    ['unknown', '边界未知 · 仅监测'],
  ])('直接展示传入状态 %s 与原 note，不自行重判资格', (state, label) => {
    const snapshot = snapshotFixture()
    snapshot.units[0] = { ...snapshot.units[0], state, eligible: false, note: '原始原因，完整保留。' }
    const html = rendered(railProps({ snapshot, linkedUnitId: 'AC-01' }))
    expect(html).toContain(label)
    expect(html).toContain('原始原因，完整保留。')
    expect(fact(html, '自动调度资格')).toBe('未纳入候选')
  })

  it('总览缺值保持未知；合法零值和负余量保留原格式', () => {
    const snapshot = snapshotFixture()
    snapshot.supply = null
    snapshot.margin = null
    snapshot.plannedRunningUnitIds = []
    const missingHtml = rendered(railProps({ snapshot }))
    expect(fact(missingHtml, '方案供气')).toBe('未知')
    expect(fact(missingHtml, '余量')).toBe('未知')
    expect(fact(missingHtml, '方案投运')).toBe('全停')
    snapshot.supply = 0
    snapshot.margin = -2.5
    const suppliedHtml = rendered(railProps({ snapshot }))
    expect(fact(suppliedHtml, '方案供气')).toBe('0.0 m³/min')
    expect(fact(suppliedHtml, '余量')).toBe('-2.5 m³/min')
    expect(suppliedHtml).toContain('class="neg mono"')
    snapshot.units[0] = { ...snapshot.units[0], load: 0, loadRatio: 0, powerKw: 0 }
    const zeroHtml = rendered(railProps({ snapshot, linkedUnitId: 'AC-01' }))
    expect(fact(zeroHtml, '供气')).toBe('0.0 m³/min')
    expect(fact(zeroHtml, '负载率')).toBe('0%')
    expect(fact(zeroHtml, '功率（估算）')).toBe('0 kW')
  })

  it('快照切换读取新数据且保留失败来源，不修改输入快照', () => {
    const snapshot = snapshotFixture()
    const before = JSON.stringify(snapshot)
    const props = railProps({ snapshot, linkedUnitId: 'AC-01' })
    rendered(props)
    action(props)()
    expect(JSON.stringify(snapshot)).toBe(before)
    const next: OverviewSnapshot = {
      ...snapshot,
      label: '13:15',
      planType: 'baseline',
      planFeasible: false,
      planLabel: '基线对照（约束未通过）',
      planNote: '原失败来源说明：基线仅作对照，不得当成通过。',
      units: snapshot.units.map((view) => ({ ...view, load: 9.4 })),
    }
    const html = rendered({ ...props, snapshot: next })
    expect(fact(html, '观察时刻')).toBe('13:15')
    expect(fact(html, '供气')).toBe('9.4 m³/min')
    expect(html).toContain(next.planNote)
    expect(html).toContain(`<span class="tag warn">${next.planLabel}</span>`)
    expect(html).not.toContain(snapshot.planNote)
    expect(html).not.toContain('批准')
    expect(JSON.stringify(snapshot)).toBe(before)
  })
})
