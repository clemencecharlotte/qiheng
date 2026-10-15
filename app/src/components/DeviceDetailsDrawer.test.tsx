import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import type { OverviewSnapshot } from '../domain/overview'

type CapturedElement = { type: unknown; props: Record<string, unknown> }
const captured = vi.hoisted(() => [] as CapturedElement[])
const hooks = vi.hoisted(() => ({
  enabled: false,
  state: null as { unitId: string; runIdentity: string } | null,
  setState: vi.fn(),
  effects: [] as Array<() => void | (() => void)>,
  refs: [] as Array<{ current: unknown }>,
  refIndex: 0,
}))

// 无额外 DOM 测试依赖：SSR 核文案，输出元素合同核事件接线，
// 合成 dialog 夹具核 effect 生命周期；不冒充浏览器原生焦点陷阱验收。
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: (initial: unknown) => hooks.enabled
      ? [hooks.state, hooks.setState]
      : actual.useState(initial),
    useEffect: (effect: () => void | (() => void), dependencies: unknown[]) => {
      if (hooks.enabled) hooks.effects.push(effect)
      else actual.useEffect(effect, dependencies)
    },
    useRef: (initial: unknown) => hooks.enabled
      ? hooks.refs[hooks.refIndex++] ?? { current: initial }
      : actual.useRef(initial),
    useId: () => hooks.enabled ? 'device-drawer-test' : actual.useId(),
  }
})

vi.mock('./usePointerGlow', () => ({
  usePointerGlow: () => ({ ref: { current: null }, onPointerMove: vi.fn(), onPointerLeave: vi.fn() }),
}))

vi.mock('react/jsx-runtime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>()
  const wrap = (fn: (...args: unknown[]) => unknown) =>
    (type: unknown, props: Record<string, unknown>, key?: unknown) => {
      captured.push({ type, props: props ?? {} })
      return fn(type, props, key)
    }
  return { ...actual, jsx: wrap(actual.jsx), jsxs: wrap(actual.jsxs) }
})

vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...args: unknown[]) => unknown>>()
  return {
    ...actual,
    jsxDEV: (type: unknown, props: Record<string, unknown>, ...rest: unknown[]) => {
      captured.push({ type, props: props ?? {} })
      return actual.jsxDEV(type, props, ...rest)
    },
  }
})

import DeviceStage from './DeviceStage'
import DeviceDetailsDrawer from './DeviceDetailsDrawer'
import { runScenario } from '../domain/engine'
import { buildOverviewSnapshot, selectStagePlan } from '../domain/overview'
import { FIXED_SEED, UNITS } from '../domain/units'

const run = runScenario('normal', UNITS, FIXED_SEED)
const selected = selectStagePlan(run)
const snapshot = buildOverviewSnapshot(run, selected.plan, selected.planType)

function stageProps(nextSnapshot: OverviewSnapshot = snapshot) {
  return {
    snapshot: nextSnapshot,
    runIdentity: 'run-a',
    linkedUnitId: 'AC-01',
    hoverUnitId: null,
    onHover: vi.fn(),
    onToggleLock: vi.fn(),
    onClearLock: vi.fn(),
  }
}

function element(className: string) {
  const result = captured.find((candidate) => candidate.props.className === className)
  expect(result, `missing element ${className}`).toBeTruthy()
  return result!.props
}

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn(), stopPropagation: vi.fn() }
}

beforeEach(() => {
  captured.length = 0
  hooks.enabled = false
  hooks.state = null
  hooks.effects.length = 0
  hooks.refs.length = 0
  hooks.refIndex = 0
  hooks.setState.mockReset()
})

describe('设备独立只读详情入口', () => {
  it('详情按钮在 article role=button 之外，原证据标记不变', () => {
    const html = renderToString(<DeviceStage {...stageProps()} />)
    const articles = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)].map((match) => match[0])
    expect(articles).toHaveLength(snapshot.units.length)
    for (const article of articles) {
      expect(article).toContain('role="button"')
      expect(article).toContain('data-evidence="unit:')
      expect(article).not.toContain('<button')
    }
    expect(html).toContain('</article><button type="button" class="device-details-trigger"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('<dialog')
  })

  it('卡片点击 / Enter / Space / hover / focus 与舞台 Esc 保持原业务接线', () => {
    const props = stageProps()
    renderToString(<DeviceStage {...props} />)
    const card = captured.find((candidate) => candidate.props['data-evidence'] === 'unit:AC-01')!.props
    ;(card.onClick as () => void)()
    for (const key of ['Enter', ' ']) {
      const event = keyEvent(key)
      ;(card.onKeyDown as (event: ReturnType<typeof keyEvent>) => void)(event)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
    expect(props.onToggleLock.mock.calls).toEqual([['AC-01'], ['AC-01'], ['AC-01']])
    ;(card.onMouseEnter as () => void)()
    ;(card.onMouseLeave as () => void)()
    ;(card.onFocus as () => void)()
    ;(card.onBlur as () => void)()
    expect(props.onHover.mock.calls).toEqual([['AC-01'], [null], ['AC-01'], [null]])
    ;(element('stage-canvas').onKeyDown as (event: ReturnType<typeof keyEvent>) => void)(keyEvent('Escape'))
    expect(props.onClearLock).toHaveBeenCalledOnce()
  })

  it('查看详情只更新本地选择，不调用业务回调', () => {
    hooks.enabled = true
    const props = stageProps()
    DeviceStage(props)
    const trigger = {} as HTMLButtonElement
    ;(element('device-details-trigger').onClick as (event: { currentTarget: HTMLButtonElement }) => void)({ currentTarget: trigger })
    expect(hooks.setState).toHaveBeenCalledWith({ unitId: 'AC-01', runIdentity: 'run-a' })
    expect(props.onHover).not.toHaveBeenCalled()
    expect(props.onToggleLock).not.toHaveBeenCalled()
    expect(props.onClearLock).not.toHaveBeenCalled()
  })

  it('详情从当前 snapshot 读取，run identity 变化立即隐藏并清选择', () => {
    hooks.enabled = true
    hooks.state = { unitId: 'AC-01', runIdentity: 'run-a' }
    const props = stageProps()
    DeviceStage(props)
    const drawer = captured.find((candidate) => candidate.type === DeviceDetailsDrawer)!
    expect(drawer.props.snapshot).toBe(snapshot)
    expect(drawer.props.view).toBe(snapshot.units[0])
    captured.length = 0
    hooks.effects.length = 0
    DeviceStage({ ...props, runIdentity: 'run-b' })
    expect(captured.some((candidate) => candidate.type === DeviceDetailsDrawer)).toBe(false)
    hooks.effects[0]()
    expect(hooks.setState).toHaveBeenCalledWith(null)
  })

  it('同一身份的新 snapshot 直接更新详情，不缓存旧时刻的数值', () => {
    hooks.enabled = true
    hooks.state = { unitId: 'AC-01', runIdentity: 'run-a' }
    DeviceStage(stageProps())
    captured.length = 0
    hooks.refIndex = 0
    const nextSnapshot = {
      ...snapshot,
      label: '13:00',
      units: snapshot.units.map((view) => view.unit.id === 'AC-01' ? { ...view, load: 17.5 } : view),
    }
    DeviceStage(stageProps(nextSnapshot))
    const drawer = captured.find((candidate) => candidate.type === DeviceDetailsDrawer)!
    expect(drawer.props.snapshot).toBe(nextSnapshot)
    expect(drawer.props.view).toBe(nextSnapshot.units[0])
    expect((drawer.props.view as typeof snapshot.units[number]).load).toBe(17.5)
    expect(hooks.setState).not.toHaveBeenCalled()
  })

  it('对象从 view 消失立即隐藏，不保留或重现旧快照', () => {
    hooks.enabled = true
    hooks.state = { unitId: 'AC-01', runIdentity: 'run-a' }
    DeviceStage(stageProps({ ...snapshot, units: snapshot.units.filter((view) => view.unit.id !== 'AC-01') }))
    expect(captured.some((candidate) => candidate.type === DeviceDetailsDrawer)).toBe(false)
    hooks.effects[0]()
    expect(hooks.setState).toHaveBeenCalledWith(null)
  })
})

describe('只读详情内容与 dialog 生命周期', () => {
  it('显示当前单位 / 估算 / 来源与边界，缺值不补零', () => {
    const view = snapshot.units.find((unit) => unit.unit.id === 'AC-03')!
    const html = renderToString(
      <DeviceDetailsDrawer id="drawer" snapshot={snapshot} view={view} returnFocus={null} onClose={() => {}} />,
    ).replace(/<!-- -->/g, '')
    expect(html).toContain('<dialog')
    expect(html).toContain('设备详情 · 只读')
    expect(html).toContain('不代表实时设备状态')
    expect(html).toContain('额定供气')
    expect(html).toContain('40 m³/min')
    expect(html).toContain('250 kW')
    expect(html).toContain('功率（估算）')
    expect(html).toContain('未监测')
    expect(html).toContain('未知')
    expect(html).toContain('未核实')
    expect(html).toContain('不生成支路数据或启停建议')
    expect(html).toContain(snapshot.planNote)
    expect(html).not.toContain('<dd>0 kW</dd>')
    expect(html).not.toContain('批准')
  })

  it('showModal 建立原生模态，卸载关闭并将焦点归还仍存在的触发按钮', () => {
    hooks.enabled = true
    const dialog = { open: true, showModal: vi.fn(), close: vi.fn() }
    const heading = { focus: vi.fn() }
    const trigger = { isConnected: true, focus: vi.fn() }
    hooks.refs.push({ current: dialog }, { current: heading })
    DeviceDetailsDrawer({ id: 'drawer', snapshot, view: snapshot.units[0], returnFocus: trigger as unknown as HTMLButtonElement, onClose: vi.fn() })
    const cleanup = hooks.effects[0]() as () => void
    expect(dialog.showModal).toHaveBeenCalledOnce()
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true })
    cleanup()
    expect(dialog.close).toHaveBeenCalledOnce()
    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('StrictMode 重开后的过时 close 事件不误关新 dialog，真正关闭仍通知选择层', () => {
    hooks.enabled = true
    const dialog = {
      open: false,
      showModal: vi.fn(() => { dialog.open = true }),
      close: vi.fn(() => { dialog.open = false }),
    }
    const onClose = vi.fn()
    hooks.refs.push({ current: dialog }, { current: { focus: vi.fn() } })
    DeviceDetailsDrawer({ id: 'drawer', snapshot, view: snapshot.units[0], returnFocus: null, onClose })
    const setup = hooks.effects[0]
    const cleanup = setup() as () => void
    cleanup()
    setup()
    const closed = element('device-details-drawer').onClose as (event: { currentTarget: typeof dialog }) => void
    closed({ currentTarget: dialog })
    expect(onClose).not.toHaveBeenCalled()
    dialog.close()
    closed({ currentTarget: dialog })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('已移除的触发按钮不再尝试恢复焦点', () => {
    hooks.enabled = true
    const trigger = { isConnected: false, focus: vi.fn() }
    hooks.refs.push({ current: { open: false, showModal: vi.fn(), close: vi.fn() } })
    DeviceDetailsDrawer({ id: 'drawer', snapshot, view: snapshot.units[0], returnFocus: trigger as unknown as HTMLButtonElement, onClose: vi.fn() })
    const cleanup = hooks.effects[0]() as () => void
    cleanup()
    expect(trigger.focus).not.toHaveBeenCalled()
  })

  it('Esc / cancel 都阻止冒泡，仅关闭详情；关闭按钮可直接操作', () => {
    hooks.enabled = true
    const onClose = vi.fn()
    DeviceDetailsDrawer({ id: 'drawer', snapshot, view: snapshot.units[0], returnFocus: null, onClose })
    const dialog = element('device-details-drawer')
    const escape = keyEvent('Escape')
    ;(dialog.onKeyDownCapture as (event: ReturnType<typeof keyEvent>) => void)(escape)
    expect(escape.preventDefault).toHaveBeenCalledOnce()
    expect(escape.stopPropagation).toHaveBeenCalledOnce()
    const cancel = keyEvent('cancel')
    ;(dialog.onCancel as (event: ReturnType<typeof keyEvent>) => void)(cancel)
    expect(cancel.preventDefault).toHaveBeenCalledOnce()
    expect(cancel.stopPropagation).toHaveBeenCalledOnce()
    ;(element('device-details-drawer__close').onClick as () => void)()
    expect(onClose).toHaveBeenCalledTimes(3)
    ;(dialog.onKeyDownCapture as (event: ReturnType<typeof keyEvent>) => void)(keyEvent('Enter'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
