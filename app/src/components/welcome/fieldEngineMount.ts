/**
 * 欢迎页背景引擎的挂载生命周期（M2）。
 *
 * 从 `WelcomeField.tsx` 抽出、保持无 React 依赖，便于用合成 DOM 夹具做回归：
 *   · 脚本单例加载：整个应用只 append 一个 <script src="/field-engine.js">，
 *     不随欢迎页往返增长；加载失败复位以便重试。
 *   · 每次挂载创建一个引擎实例（`window.__qhFieldEngine.create({ root })`），
 *     绑定当前 DOM；卸载时调用 `destroy()` 真正释放监听/observer/RAF/计时器。
 *   · 卸载同步生效：destroyed 标记让「加载尚未完成」的迟到回调直接返回，
 *     不会在已卸载后新建实例；destroy 幂等。
 *   · 组件级 observer（主题 MutationObserver、Hero IntersectionObserver）在
 *     卸载时 disconnect；Hero 离场只写 backdrop（气流全程保留）。
 */

const ENGINE_SRC = '/field-engine.js'

export type EngineHandle = {
  sync?: () => void
  resize?: () => void
  running?: () => boolean
  destroy?: () => void
}
export type FieldEngineFactory = {
  create: (opts: { root: HTMLElement }) => EngineHandle | null
}
type WinWithEngine = Window & {
  __qhFieldEngine?: FieldEngineFactory
  __qhEngine?: EngineHandle
}

/* 单例脚本加载：跨挂载复用同一个 Promise。 */
let engineScriptPromise: Promise<void> | null = null

export function loadEngineScript(): Promise<void> {
  if (engineScriptPromise) return engineScriptPromise
  engineScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = ENGINE_SRC
    script.async = true
    script.dataset.engine = 'field-engine'
    const onLoad = () => {
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      resolve()
    }
    const onError = () => {
      // 失败：撤本 script 的加载监听并把它从 DOM 移除，再复位以便重试。
      // 成功脚本保持单例（不移除），因此 DOM 里存活的引擎脚本有界。
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
      script.remove()
      engineScriptPromise = null
      reject(new Error('field-engine load failed'))
    }
    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    document.body.appendChild(script)
  })
  return engineScriptPromise
}

/** 仅测试用：重置单例加载状态。 */
export function __resetEngineScriptForTest(): void {
  engineScriptPromise = null
}

/**
 * 挂载背景引擎，返回卸载函数（幂等、同步生效）。
 */
export function mountFieldEngine(backdrop: HTMLElement): () => void {
  let destroyed = false
  let handle: EngineHandle | null = null

  loadEngineScript()
    .then(() => {
      if (destroyed) return
      const factory = (window as WinWithEngine).__qhFieldEngine
      if (!factory || typeof factory.create !== 'function') return
      handle = factory.create({ root: backdrop })
    })
    .catch(() => {
      // 引擎脚本加载失败：背景保持静态兜底，不注册任何全局副作用
    })

  // 主题切换 → 引擎重读 token（引擎监听 document 上的 qiheng:theme）。
  let themeObserver: MutationObserver | null = null
  if (typeof MutationObserver !== 'undefined') {
    themeObserver = new MutationObserver(() => {
      document.dispatchEvent(new CustomEvent('qiheng:theme'))
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
  }

  // Hero 离场：只打在 .qh-backdrop 上（CSS 据此只淡出 Core/拓扑，气流全程保留）。
  let io: IntersectionObserver | null = null
  const welcomeRoot = typeof backdrop.closest === 'function' ? backdrop.closest('.qh-welcome') : null
  const hero = welcomeRoot?.querySelector('.qh-hero') || document.querySelector('.qh-hero')
  if (hero && typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) backdrop.setAttribute('data-hero', 'away')
          else backdrop.removeAttribute('data-hero')
        }
      },
      { threshold: 0 },
    )
    io.observe(hero)
  }

  return () => {
    destroyed = true
    themeObserver?.disconnect()
    io?.disconnect()
    handle?.destroy?.()
    handle = null
  }
}
