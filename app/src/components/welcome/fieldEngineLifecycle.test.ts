/// <reference types="vite/client" />
import { beforeEach, describe, expect, it } from 'vitest'
import ENGINE_CODE from '../../../public/field-engine.js?raw'
import { mountFieldEngine, __resetEngineScriptForTest } from './fieldEngineMount'

/**
 * 生命周期回归（M2）。
 *
 * ⚠ 这是**合成 DOM 夹具**测试，不是真实浏览器测试：在自建的
 * window/document/observer 上执行真实的 public/field-engine.js，并按
 * fieldEngineMount.ts 的真实挂载/卸载路径驱动。覆盖：
 *   · StrictMode setup→cleanup→setup（含"加载未完成即离开"）
 *   · 快速返回：脚本单例、实例不叠加
 *   · 脚本 load 失败：不抛错、可重试
 *   · 卸载后主题/resize/pointer 不再操作旧 canvas
 *   · 新实例绑定当前 DOM；canvas 不残留 data-hero
 *   · 至少 10 次往返，live 资源有界
 */

type Listener = (...args: unknown[]) => void

type WinStub = {
  addEventListener: (t: string, fn: Listener) => void
  removeEventListener: (t: string, fn: Listener) => void
  dispatchEvent: (e: { type: string }) => void
  matchMedia: (q: string) => unknown
  requestAnimationFrame: (fn: Listener) => number
  cancelAnimationFrame: (id: number) => void
  setTimeout: (fn: Listener, ms?: number) => number
  clearTimeout: (id?: number) => void
  setInterval: (fn: Listener, ms?: number) => number
  clearInterval: (id?: number) => void
  ResizeObserver: unknown
  location: { search: string }
  PointerEvent: unknown
  __qhEngine?: unknown
  __qhFieldEngine?: { create: (o: { root: unknown }) => unknown }
  window?: unknown
}

type CanvasStub = {
  id: string
  width: number
  height: number
  style: Record<string, string>
  dataset: Record<string, string>
  draw: { n: number }
  getContext: () => unknown
  setAttribute: (k: string, v: string) => void
  removeAttribute: (k: string) => void
  getAttribute: (k: string) => string | null
}

type BackdropStub = {
  querySelector: (sel: string) => unknown
  querySelectorAll: () => unknown[]
  closest: (sel?: string) => unknown
  setAttribute: () => void
  removeAttribute: () => void
}

type RailItemStub = {
  node: string
  getAttribute: (k: string) => string | null
  addEventListener: (t: string, fn: Listener) => void
  removeEventListener: (t: string, fn: Listener) => void
  fire: (t: string) => void
  total: () => number
}

type WelcomeStub = {
  railItems: RailItemStub[]
  querySelector: (sel: string) => unknown
  querySelectorAll: (sel: string) => unknown[]
}

function createWorld() {
  const appendedScripts: Array<{ _fire: (t: string) => void }> = []
  const liveChildren: unknown[] = []
  const winListeners = new Map<string, Listener[]>()
  const docListeners = new Map<string, Listener[]>()
  const mqlListeners = new Map<string, Listener[]>()
  const roInstances: Array<{ disconnected: boolean }> = []
  const moInstances: Array<{ disconnected: boolean }> = []
  const ioInstances: Array<{ disconnected: boolean }> = []
  const rafScheduled: number[] = []
  const rafCancelled: number[] = []
  const timersSet: number[] = []
  const timersCleared: number[] = []
  let rafId = 0
  let timerId = 0
  let createdCount = 0

  const add = (map: Map<string, Listener[]>, type: string, fn: Listener) => {
    const arr = map.get(type) || []
    arr.push(fn)
    map.set(type, arr)
  }
  const remove = (map: Map<string, Listener[]>, type: string, fn: Listener) => {
    const arr = map.get(type) || []
    map.set(
      type,
      arr.filter((x) => x !== fn),
    )
  }

  const recSetTimeout = (_fn: Listener, _ms?: number) => {
    timersSet.push(++timerId)
    return timerId
  }
  const recClearTimeout = (id?: number) => {
    if (typeof id === 'number') timersCleared.push(id)
  }
  const recSetInterval = (_fn: Listener, _ms?: number) => {
    return ++timerId
  }
  const recClearInterval = (_id?: number) => {}

  const makeCtx = (canvasDraw: { n: number }) => ({
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    shadowBlur: 0,
    shadowColor: '',
    clearRect() {
      canvasDraw.n += 1
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    arc() {},
    setTransform() {},
    createRadialGradient() {
      return { addColorStop() {} }
    },
    createLinearGradient() {
      return { addColorStop() {} }
    },
  })

  function makeCanvas(id: string): CanvasStub {
    const draw = { n: 0 }
    const ctx = makeCtx(draw)
    const canvas: CanvasStub = {
      id,
      width: 0,
      height: 0,
      style: {},
      dataset: {},
      draw,
      getContext: () => ctx,
      setAttribute(k, v) {
        void k
        void v
      },
      removeAttribute(k) {
        if (k.startsWith('data-')) delete canvas.dataset[k.slice(5)]
      },
      getAttribute() {
        return null
      },
    }
    return canvas
  }

  function makeBackdrop(welcomeRoot?: WelcomeStub | null) {
    const field = makeCanvas('bg-airflow')
    const topo = makeCanvas('bg-topology')
    const core = { getBoundingClientRect: () => ({ left: 100, top: 100, width: 100, height: 100 }) }
    const tiltV: Record<string, string> = {}
    const coreTilt = {
      style: {
        setProperty: (k: string, v: string) => {
          tiltV[k] = v
        },
        getPropertyValue: (k: string) => tiltV[k] || '',
      },
    }
    const labelBox = {
      innerHTML: '',
      appends: 0,
      appendChild() {
        labelBox.appends += 1
      },
    }
    const backdrop: BackdropStub = {
      querySelector(sel) {
        if (sel === '#bg-airflow') return field
        if (sel === '#bg-topology') return topo
        if (sel === '#qiheng-core') return core
        if (sel === '#core-tilt') return coreTilt
        if (sel === '#visual-labels') return labelBox
        return null
      },
      querySelectorAll: () => [],
      // rail 与 backdrop 是 .qh-welcome 下的兄弟区域：closest 返回欢迎页根
      closest: (sel?: string) => (sel === '.qh-welcome' ? welcomeRoot || null : null),
      setAttribute: () => {},
      removeAttribute: () => {},
    }
    return { backdrop, field, topo, labelBox }
  }

  function makeRailItem(node: string): RailItemStub {
    const handlers = new Map<string, Listener[]>()
    return {
      node,
      getAttribute(k: string) {
        return k === 'data-node' ? node : null
      },
      addEventListener(type: string, fn: Listener) {
        add(handlers, type, fn)
      },
      removeEventListener(type: string, fn: Listener) {
        remove(handlers, type, fn)
      },
      fire(type: string) {
        ;(handlers.get(type) || []).slice().forEach((fn) => fn({ type }))
      },
      total() {
        let n = 0
        handlers.forEach((a) => (n += a.length))
        return n
      },
    }
  }

  function makeWelcome() {
    const welcomeRoot: WelcomeStub = {
      railItems: [],
      querySelector: () => null,
      querySelectorAll(sel: string) {
        return sel.indexOf('rail-item') >= 0 ? welcomeRoot.railItems : []
      },
    }
    welcomeRoot.railItems = [makeRailItem('INPUT'), makeRailItem('SOLVER')]
    return { welcomeRoot, ...makeBackdrop(welcomeRoot) }
  }

  const makeScript = () => {
    const handlers = new Map<string, Listener[]>()
    const script = {
      src: '',
      async: false,
      dataset: {} as Record<string, string>,
      addEventListener(type: string, fn: Listener) {
        add(handlers, type, fn)
      },
      removeEventListener(type: string, fn: Listener) {
        remove(handlers, type, fn)
      },
      _fire(type: string) {
        ;(handlers.get(type) || []).slice().forEach((fn) => fn({ type }))
      },
      // 模拟 HTMLScriptElement.remove()：从 body 存活子节点里摘掉
      remove() {
        const i = liveChildren.indexOf(script)
        if (i >= 0) liveChildren.splice(i, 1)
      },
    }
    return script
  }

  class FakeResizeObserver {
    disconnected = false
    constructor() {
      roInstances.push(this)
    }
    observe() {}
    disconnect() {
      this.disconnected = true
    }
  }
  class FakeMutationObserver {
    disconnected = false
    constructor() {
      moInstances.push(this)
    }
    observe() {}
    disconnect() {
      this.disconnected = true
    }
  }
  class FakeIntersectionObserver {
    disconnected = false
    cb: (e: unknown[]) => void
    constructor(cb: (e: unknown[]) => void) {
      this.cb = cb
      ioInstances.push(this)
    }
    observe() {}
    disconnect() {
      this.disconnected = true
    }
  }

  const root = {
    attrs: {} as Record<string, string>,
    getAttribute(k: string) {
      return root.attrs[k] ?? null
    },
    setAttribute(k: string, v: string) {
      root.attrs[k] = String(v)
    },
  }
  const hero = { nodeType: 1 }

  const documentStub = {
    documentElement: root,
    body: {
      appendChild(s: unknown) {
        appendedScripts.push(s as { _fire: (t: string) => void })
        liveChildren.push(s)
      },
      removeChild(s: unknown) {
        const i = liveChildren.indexOf(s)
        if (i >= 0) liveChildren.splice(i, 1)
      },
    },
    hidden: false,
    addEventListener(type: string, fn: Listener) {
      add(docListeners, type, fn)
    },
    removeEventListener(type: string, fn: Listener) {
      remove(docListeners, type, fn)
    },
    dispatchEvent(ev: { type: string }) {
      ;(docListeners.get(ev.type) || []).slice().forEach((fn) => fn(ev))
    },
    createElement(tag: string) {
      if (tag === 'script') return makeScript()
      return { className: '', textContent: '', style: {}, setAttribute: () => {}, appendChild: () => {} }
    },
    querySelector(sel: string) {
      if (sel === '.qh-hero') return hero
      return null
    },
    querySelectorAll: () => [],
  }

  const win = {
    addEventListener(type: string, fn: Listener) {
      add(winListeners, type, fn)
    },
    removeEventListener(type: string, fn: Listener) {
      remove(winListeners, type, fn)
    },
    dispatchEvent(ev: { type: string }) {
      ;(winListeners.get(ev.type) || []).slice().forEach((fn) => fn(ev))
    },
    matchMedia(query: string) {
      return {
        media: query,
        matches: query.includes('pointer: fine'),
        addEventListener(_type: string, fn: Listener) {
          add(mqlListeners, query, fn)
        },
        removeEventListener(_type: string, fn: Listener) {
          remove(mqlListeners, query, fn)
        },
      }
    },
    requestAnimationFrame(_fn: Listener) {
      rafScheduled.push(++rafId)
      return rafId
    },
    cancelAnimationFrame(id: number) {
      rafCancelled.push(id)
    },
    setTimeout: recSetTimeout,
    clearTimeout: recClearTimeout,
    setInterval: recSetInterval,
    clearInterval: recClearInterval,
    ResizeObserver: FakeResizeObserver,
    location: { search: '' },
    PointerEvent: function PointerEvent() {},
  } as WinStub & { window?: unknown }
  win.window = win

  // 用 new Function 在隔离作用域里执行引擎（避免依赖 node:vm 类型）
  const runEngine = new Function(
    'window',
    'document',
    'location',
    'performance',
    'getComputedStyle',
    'ResizeObserver',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    ENGINE_CODE,
  ) as (...args: unknown[]) => void
  runEngine(
    win,
    documentStub,
    { search: '' },
    { now: () => 1000 },
    () => ({ getPropertyValue: () => '' }),
    FakeResizeObserver,
    recSetTimeout,
    recClearTimeout,
    recSetInterval,
    recClearInterval,
  )

  // 计数实例创建（包装真实工厂 create）
  const factory = win.__qhFieldEngine as { create: (o: { root: unknown }) => unknown }
  const origCreate = factory.create.bind(factory)
  factory.create = (o: { root: unknown }) => {
    createdCount += 1
    return origCreate(o)
  }

  const liveResources = () => {
    let n = 0
    winListeners.forEach((a) => (n += a.length))
    docListeners.forEach((a) => (n += a.length))
    mqlListeners.forEach((a) => (n += a.length))
    n += roInstances.filter((r) => !r.disconnected).length
    n += moInstances.filter((m) => !m.disconnected).length
    n += ioInstances.filter((o) => !o.disconnected).length
    return n
  }

  return {
    win,
    documentStub,
    appendedScripts,
    makeBackdrop,
    makeWelcome,
    liveScripts: () => liveChildren.length,
    rafScheduled,
    rafCancelled,
    timersCleared,
    liveResources,
    createdCount: () => createdCount,
    MutationObserver: FakeMutationObserver,
    IntersectionObserver: FakeIntersectionObserver,
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

function installGlobals(world: ReturnType<typeof createWorld>) {
  const g = globalThis as Record<string, unknown>
  g.window = world.win
  g.document = world.documentStub
  g.MutationObserver = world.MutationObserver
  g.IntersectionObserver = world.IntersectionObserver
  g.CustomEvent = class {
    type: string
    constructor(type: string) {
      this.type = type
    }
  }
}

const fire = (script: { _fire: (t: string) => void }, type: string) => script._fire(type)

describe('背景引擎生命周期（合成 DOM 夹具）', () => {
  beforeEach(() => {
    __resetEngineScriptForTest()
  })

  it('StrictMode setup→cleanup→setup 且加载未完成即离开：只创建一个实例、只 append 一个脚本', async () => {
    const world = createWorld()
    installGlobals(world)
    const { backdrop } = world.makeBackdrop()

    const off1 = mountFieldEngine(backdrop as unknown as HTMLElement)
    off1() // 加载尚未完成就 cleanup
    const off2 = mountFieldEngine(backdrop as unknown as HTMLElement)
    expect(world.appendedScripts.length).toBe(1)

    fire(world.appendedScripts[0], 'load')
    await flush()

    expect(world.createdCount()).toBe(1)
    expect(world.win.__qhEngine).toBeTruthy()
    off2()
    expect(world.win.__qhEngine).toBeUndefined()
    expect(world.liveResources()).toBe(0)
  })

  it('卸载真正释放监听/observer/RAF/计时器，且 destroy 幂等', async () => {
    const world = createWorld()
    installGlobals(world)
    const { backdrop } = world.makeBackdrop()

    const off = mountFieldEngine(backdrop as unknown as HTMLElement)
    fire(world.appendedScripts[0], 'load')
    await flush()

    expect(world.createdCount()).toBe(1)
    expect(world.liveResources()).toBeGreaterThan(0)
    expect(world.rafScheduled.length).toBeGreaterThan(0)

    const handle = world.win.__qhEngine as { destroy: () => void }
    off()
    expect(world.liveResources()).toBe(0)
    expect(world.rafCancelled.length).toBeGreaterThan(0)
    expect(world.timersCleared.length).toBeGreaterThan(0)
    expect(world.win.__qhEngine).toBeUndefined()
    expect(() => handle.destroy()).not.toThrow()
    expect(world.liveResources()).toBe(0)
  })

  it('卸载后主题/resize/pointer 不再操作旧 canvas', async () => {
    const world = createWorld()
    installGlobals(world)
    const made = world.makeBackdrop()

    const off = mountFieldEngine(made.backdrop as unknown as HTMLElement)
    fire(world.appendedScripts[0], 'load')
    await flush()
    const handle = world.win.__qhEngine as { sync: () => void; resize: () => void }

    off()
    const before = made.field.draw.n

    handle.sync()
    handle.resize()
    world.win.dispatchEvent({ type: 'resize' })
    world.win.dispatchEvent({ type: 'pointermove' })
    world.documentStub.dispatchEvent({ type: 'visibilitychange' })
    world.documentStub.dispatchEvent({ type: 'qiheng:theme' })

    expect(made.field.draw.n).toBe(before)
  })

  it('新实例绑定当前 DOM，且不残留 data-hero="away"', async () => {
    const world = createWorld()
    installGlobals(world)
    const a = world.makeBackdrop()
    const b = world.makeBackdrop()
    a.field.dataset.hero = 'away'
    b.field.dataset.hero = 'away'

    const offA = mountFieldEngine(a.backdrop as unknown as HTMLElement)
    fire(world.appendedScripts[0], 'load')
    await flush()
    expect(a.field.dataset.hero).toBeUndefined()
    expect((world.win.__qhEngine as { running: () => boolean }).running()).toBe(true)

    const aDrawBefore = a.field.draw.n
    offA()

    const offB = mountFieldEngine(b.backdrop as unknown as HTMLElement)
    await flush()
    const handleB = world.win.__qhEngine as { resize: () => void; running: () => boolean }
    handleB.resize()

    expect(a.field.draw.n).toBe(aDrawBefore)
    expect(b.field.draw.n).toBeGreaterThan(0)
    expect(b.field.dataset.hero).toBeUndefined()
    expect(handleB.running()).toBe(true)
    offB()
  })

  it('rail 绑定当前欢迎页根（与 backdrop 兄弟）；不误绑另一实例；destroy 清理', async () => {
    const world = createWorld()
    installGlobals(world)
    const w = world.makeWelcome()
    const other = world.makeWelcome()

    const off = mountFieldEngine(w.backdrop as unknown as HTMLElement)
    fire(world.appendedScripts[0], 'load')
    await flush()
    expect(world.createdCount()).toBe(1)

    // 当前欢迎页的 rail 被绑定（pointerenter/leave/focusin/focusout）
    expect(w.welcomeRoot.railItems[0].total()).toBe(4)
    expect(w.welcomeRoot.railItems[1].total()).toBe(4)
    // 另一个欢迎页的 rail 不得误绑
    expect(other.welcomeRoot.railItems[0].total()).toBe(0)

    // hover/focus 触发标签重建（可观察副作用）
    const base = w.labelBox.appends
    w.welcomeRoot.railItems[0].fire('pointerenter')
    expect(w.labelBox.appends).toBeGreaterThan(base)
    const afterEnter = w.labelBox.appends
    w.welcomeRoot.railItems[0].fire('focusout')
    expect(w.labelBox.appends).toBeGreaterThan(afterEnter)

    // destroy 后 rail 监听全部清理，事件不再触发
    off()
    expect(w.welcomeRoot.railItems[0].total()).toBe(0)
    expect(w.welcomeRoot.railItems[1].total()).toBe(0)
    const afterDestroy = w.labelBox.appends
    w.welcomeRoot.railItems[0].fire('pointerenter')
    expect(w.labelBox.appends).toBe(afterDestroy)
  })

  it('脚本 load 失败：移除失败 script、不抛错、不创建实例、可重试', async () => {
    const world = createWorld()
    installGlobals(world)
    const { backdrop } = world.makeBackdrop()

    const off = mountFieldEngine(backdrop as unknown as HTMLElement)
    fire(world.appendedScripts[0], 'error')
    await flush()

    expect(world.createdCount()).toBe(0)
    expect(world.win.__qhEngine).toBeUndefined()
    // 失败 script 已从 DOM 移除（存活数为 0）
    expect(world.liveScripts()).toBe(0)
    expect(() => off()).not.toThrow()

    const off2 = mountFieldEngine(backdrop as unknown as HTMLElement)
    expect(world.appendedScripts.length).toBe(2)
    expect(world.liveScripts()).toBe(1)
    fire(world.appendedScripts[1], 'load')
    await flush()
    expect(world.createdCount()).toBe(1)
    expect(world.win.__qhEngine).toBeTruthy()
    off2()
  })

  it('重复 error→retry：存活脚本有界；迟到回调不创建已卸载实例', async () => {
    const world = createWorld()
    installGlobals(world)
    const { backdrop } = world.makeBackdrop()

    for (let i = 0; i < 3; i += 1) {
      const off = mountFieldEngine(backdrop as unknown as HTMLElement)
      fire(world.appendedScripts[world.appendedScripts.length - 1], 'error')
      await flush()
      expect(world.createdCount()).toBe(0)
      expect(world.liveScripts()).toBe(0)
      off()
      expect(world.liveResources()).toBe(0)
    }
    // 历史 append 3 次，但存活 0 —— 有界（不把历史 append 数当存活节点数）
    expect(world.appendedScripts.length).toBe(3)
    expect(world.liveScripts()).toBe(0)

    // 成功后单例：脚存在，实例 1
    const offOk = mountFieldEngine(backdrop as unknown as HTMLElement)
    fire(world.appendedScripts[world.appendedScripts.length - 1], 'load')
    await flush()
    expect(world.createdCount()).toBe(1)
    expect(world.liveScripts()).toBe(1)
    offOk()

    // 迟到回调：卸载后才 load，不得创建实例
    __resetEngineScriptForTest()
    const late = mountFieldEngine(backdrop as unknown as HTMLElement)
    const pending = world.appendedScripts[world.appendedScripts.length - 1]
    late() // 卸载发生在 load 之前
    fire(pending, 'load')
    await flush()
    expect(world.win.__qhEngine).toBeUndefined()
    expect(world.createdCount()).toBe(1)
  })

  it('至少 10 次往返：live 资源有界、脚本不增长', async () => {
    const world = createWorld()
    installGlobals(world)
    const { backdrop } = world.makeBackdrop()

    let first = true
    for (let i = 0; i < 10; i += 1) {
      const off = mountFieldEngine(backdrop as unknown as HTMLElement)
      if (first) {
        fire(world.appendedScripts[0], 'load')
        first = false
      }
      await flush()
      expect(world.win.__qhEngine).toBeTruthy()
      off()
      expect(world.win.__qhEngine).toBeUndefined()
      expect(world.liveResources()).toBe(0)
    }
    expect(world.appendedScripts.length).toBe(1)
    expect(world.createdCount()).toBe(10)
  })
})
