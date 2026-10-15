import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { loadPassportStore } from '../domain/passport'
import WelcomeField from './WelcomeField'
import DeviceSystemExperience from './welcome/DeviceSystemExperience'
import type { HostPlayback } from './welcome/hostPlayback'
import PassportProofRail from './welcome/PassportProofRail'
import ProcessStage from './welcome/ProcessStage'
import NarrativeSpine from './welcome/NarrativeSpine'
import useReveal from './welcome/useReveal'
import NoteRef from './console/NoteRef'
import { Tooltip } from './ui/Disclosure'
import SceneShowcase from './w1/SceneShowcase'
import CapabilityTrack from './w1/CapabilityTrack'
import { PreviewWheel, type PreviewWheelItem } from './previewWheel/PreviewWheel'
import { DEMO_DEVICE_TYPES, DeviceGlyph } from './welcome/DeviceSystemExperience'
import { INFORMATIVE_PHASE } from './welcome/deviceKinematics'
import ReversibleNudge from './w1/ReversibleNudge'
import NativeDemoPlayer from './w1/NativeDemoPlayer'
import { createPlaybackController } from './w1/demoPlaybackController'
import type { CapabilityItem } from './w1/capabilityModel'
import './welcome/welcome.css'
import './welcome/w1-slot.css'

interface Props {
  onEnter: () => void
  /** 真实登录/注册入口：以本次按钮为 origin 打开统一 AuthForm 模态（未接入鉴权）。 */
  onAuth?: (origin: HTMLElement) => void
  /** 由业务页返回欢迎时聚焦 CTA；首次进入聚焦标题。 */
  returning?: boolean
  /** 宿主受控环境滑值 [0,5]（由 envBinding 决策；仅用于主体/展台同源，不再挂第二背景）。 */
  scenePosition?: number
  /** 真实入口导航（真实 hash；组件不造 routes）。 */
  onNavigate?: (hash: string) => void
  onOpenDemo?: (typeId: string, originId: string) => void
  /** M29 r04 · 宿主真实观察时钟快照（来源 + 观察时刻标签）：序幕与真实宿主消费同一选定源/时刻。 */
  hostObservation?: { source: 'schedule' | 'history'; label: string }
  /** M29 r05 · 宿主真实序列/时钟快照与播放控制（与真实控制台同一源/时刻）。 */
  hostPlayback?: HostPlayback
  /** M29 · 序幕设备入口快照（entry 恢复；runIdentity 失效由 App 判定）。 */
  initialDeviceView?: { deviceId: string; demoState: string } | null
  onDeviceViewChange?: (v: { deviceId: string; demoState: string }) => void
}

// 评审快捷入口：自然中文。href 原样保留（真实路由合同），不再向读者暴露
// scenario=/records/audit 之类技术说明；surge 是"需求超界"，不是设备故障。
const JUDGE_LINKS = [
  { id: '01', label: '常态', desc: '查看候选方案与取舍', href: '#/schedule/overview?mode=legacy&scenario=normal' },
  { id: '02', label: '边界', desc: '查看需求超界时如何拒绝', href: '#/schedule/overview?mode=legacy&scenario=surge' },
  { id: '03', label: '记录', desc: '回看已封存的决策与证据', href: '#/records/audit' },
]

/** R2 能力卡：真实现有路由 + 诚实服务状态（智能未接通 = 未配置，不造在线）。
 *  每类多张不同真实页面，保证轨道可横向探索（桌面/320/390 下一张露出）。 */
const CAPABILITIES: CapabilityItem[] = [
  { id: 'run-overview', category: '运行', title: '调度总览', summary: '合成场景的结论与下一动作。', route: '#/schedule/overview?mode=legacy&scenario=normal', entryLabel: '查看调度总览', state: 'available' },
  { id: 'run-execution', category: '运行', title: '执行面板', summary: '合成执行的记录与批准状态。', route: '#/schedule/execution?mode=legacy&scenario=normal', entryLabel: '查看执行面板', state: 'available' },
  { id: 'run-events', category: '运行', title: '运维事件', summary: '离线导入与治理事件时间线。', route: '#/events/list?mode=legacy&scenario=normal', entryLabel: '查看运维事件', state: 'available' },
  { id: 'decide-compare', category: '决策', title: '方案比较', summary: '候选并排与取舍、约束限制。', route: '#/schedule/compare?mode=legacy&scenario=normal', entryLabel: '比较候选方案', state: 'available' },
  { id: 'decide-review', category: '决策', title: '评审复核', summary: '逐项复核结论与限制条件。', route: '#/schedule/review?mode=legacy&scenario=normal', entryLabel: '进入评审复核', state: 'available' },
  { id: 'decide-evidence', category: '决策', title: '证据查看', summary: '结论所依据的来源与批次。', route: '#/schedule/evidence?mode=legacy&scenario=normal', entryLabel: '查看证据', state: 'available' },
  { id: 'decide-passport', category: '决策', title: '决策护照', summary: '已封存决策的只读摘要。', route: '#/records/audit', entryLabel: '查看决策护照', state: 'available' },
  { id: 'data-trend', category: '数据', title: '历史趋势', summary: '回放观察与趋势读图。', route: '#/history/trend?mode=legacy&scenario=normal', entryLabel: '查看历史趋势', state: 'available' },
  { id: 'data-ingress', category: '数据', title: '数据接入', summary: '离线 CSV/JSON 批次与记录级治理。', route: '#/history/data', entryLabel: '查看数据接入', state: 'available' },
  { id: 'data-governance', category: '数据', title: '治理事件', summary: '导入完成/隔离/拒绝的真实记录。', route: '#/events/governance?mode=legacy&scenario=normal', entryLabel: '查看治理事件', state: 'available' },
  { id: 'data-export', category: '数据', title: '导出记录', summary: '只读记录与导出范围。', route: '#/records/export', entryLabel: '查看导出记录', state: 'available' },
  { id: 'intel-traces', category: '智能', title: '智能体只读工具', summary: '正规 MCP 只读工具（设备/时间窗/护照）；模型未连时仍可用。', route: '#/agent/console', entryLabel: '进入智能体工作区', state: 'available' },
]

// R3 事件表：cue 起点取自正式 VTT（不手写错误表；无字幕不编）。
const ASK_EVENTS = [
  { at: '00:00', label: '调度总览落地：当前结论与下一动作' },
  { at: '00:03', label: '下滚设备与供需舞台：三台机组卡' },
  { at: '00:09', label: '机组卡全貌与只读证据栏' },
  { at: '00:15', label: '停留浏览：机组卡与供需趋势' },
]
const PROCESS_EVENTS = [
  { at: '00:00', label: '常态总览落地，随后切至方案比较' },
  { at: '00:05', label: '方案比较：基线与建议对比卡' },
  { at: '00:09', label: '比较表：基线 17 项违规 vs 建议 0 项' },
  { at: '00:13', label: '进入复验人审：安全链审查与处置区' },
]

export default function WelcomePage({ onEnter, onAuth, returning = false, scenePosition = 0, onNavigate, onOpenDemo, hostObservation, hostPlayback, initialDeviceView, onDeviceViewChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const ctaRef = useRef<HTMLButtonElement>(null)
  const [demoActiveId, setDemoActiveId] = useState<string | null>(null)
  // M24 C · 两演示播放器共享同一协调器（明确接管/互斥/陈旧事件分离）。
  const demoController = useRef(createPlaybackController()).current

  const store = useMemo(() => loadPassportStore(), [])
  const latest = store.passports.length ? store.passports[store.passports.length - 1] : null

  useReveal(rootRef)

  useEffect(() => {
    if (returning) ctaRef.current?.focus()
    else titleRef.current?.focus()
  }, [returning])

  // M13 r02：明暗/主题入口收束到左下统一「外观」入口（App 渲染），header 不再有日夜按钮。

  // scrollspy（Vercel 语法）：滚到哪节，头部对应链接点亮（aria-current）。
  // 只做标识，不改文案；无 IO 环境（jsdom/老内核）直接退化为无高亮。
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const links = Array.from(
      root.querySelectorAll<HTMLAnchorElement>('.qh-hdr-nav a[href^="#qh-"]'),
    )
    const sections = links
      .map((a) => root.querySelector<HTMLElement>(a.getAttribute('href') || ''))
      .filter((s): s is HTMLElement => !!s)
    if (!sections.length) return
    const visible = new Set<Element>()
    const sync = () => {
      let current: string | null = null
      for (const s of sections) if (visible.has(s)) current = s.id
      links.forEach((a) => {
        const on = current !== null && a.getAttribute('href') === `#${current}`
        if (on) a.setAttribute('aria-current', 'true')
        else a.removeAttribute('aria-current')
      })
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) visible.add(e.target)
          else visible.delete(e.target)
        })
        sync()
      },
      { rootMargin: '-35% 0px -55% 0px', threshold: 0 },
    )
    sections.forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [])

  const onAnchorClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const href = event.currentTarget.getAttribute('href') || ''
    // M2：欢迎页品牌指向 #/welcome。若当前已在欢迎页，hash 不变、无 hashchange，
    // 原生点击不会发生任何事 —— 这里接管为"平滑回顶"，让品牌=回到首屏成立。
    if (href === '#/welcome' || href === '#') {
      const h = window.location.hash
      const onWelcome = h === '' || h === '#' || h === '#/' || h === '#/welcome'
      if (onWelcome) {
        event.preventDefault()
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
      }
      return
    }
    // 只接管页内装饰锚点（#qh-*）；业务 hash 路由（#/...）保持原生，交给 router。
    if (!href.startsWith('#') || href.startsWith('#/')) return
    const id = href.slice(1)
    const target = document.getElementById(id)
    if (!target) return
    event.preventDefault()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    // skip link 到 main 要能实际聚焦（不改变滚动位置，focus 由 scrollIntoView 负责）。
    if (id === 'qh-main' && target instanceof HTMLElement) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
    }
  }

  return (
    <div className="qh-welcome" ref={rootRef} data-route="welcome">
      <WelcomeField />
      <div className="qh-scrim" aria-hidden="true" />

      <a className="qh-skip" href="#qh-main" onClick={onAnchorClick}>
        跳到主要内容
      </a>

      <header className="qh-hdr">
        <div className="qh-hdr-in">
          <a className="qh-brand" href="#/welcome" onClick={onAnchorClick}>
            <svg className="qh-brand-mark" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <circle cx="16" cy="16" r="13.2" opacity=".32" />
              <circle cx="16" cy="16" r="8.4" opacity=".5" />
              <path d="M8.6 20.2c2.6 0 3.2-2.6 5.4-4.4M12.4 23.4c3.4-.4 4.2-4 7-6.2M16.6 24.6c3.8-1.2 5-5.2 8.2-8" strokeLinecap="round" />
              <circle cx="16" cy="16" r="2.1" fill="currentColor" stroke="none" />
            </svg>
            <span>
              <span className="qh-brand-name">气衡</span>
              <span className="qh-brand-desc">QIHENG · 空压站协同决策台</span>
            </span>
          </a>
          <nav className="qh-hdr-nav" aria-label="页面导航">
            <a href="#qh-process" onClick={onAnchorClick}>产品路径</a>
            <a href="#qh-proof" onClick={onAnchorClick}>决策护照</a>
          </nav>
          <div className="qh-hdr-actions">
            <button
              type="button"
              className="btn ghost qh-hdr-appearance"
              aria-haspopup="dialog"
              aria-label="外观：主题 / 环境 / 玻璃"
              title="外观：主题 / 环境 / 玻璃"
              onClick={(e) => {
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('qh:appearance-open', { detail: { origin: e.currentTarget } }))
                }
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="12" cy="12" r="4.2" />
                <path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              className="btn ghost qh-hdr-auth"
              id="welcome-auth"
              data-action="welcome-auth"
              aria-haspopup="dialog"
              title="登录 / 注册（设计原型，未接入鉴权）"
              onClick={(e) => onAuth?.(e.currentTarget as HTMLElement)}
            >
              注册 / 登录
            </button>
          </div>
        </div>
      </header>

      <main className="qh-main" id="qh-main" tabIndex={-1}>
        <NarrativeSpine rootRef={rootRef} />

        <section className="qh-hero">
          <div className="qh-hero-in">
            <div className="qh-hero-copy">
              <p className="qh-eyebrow rv">01 / Trust before action</p>
              <h1 className="qh-title rv" id="welcome-title" data-welcome-title tabIndex={-1} ref={titleRef}>
                <span className="sr-only">每个调度方案，都先回答能不能用。</span>
                <span aria-hidden="true">
                  <span className="h1-l">每个调度方案，</span>
                  <span className="h1-l">都先回答</span>
                  <span className="h1-l h1-last">能不能用。</span>
                </span>
              </h1>
              <p className="qh-hero-sub rv">看清输入来源，比较方案，独立复验，再由人确认。</p>
              <div className="qh-cta-row rv">
                <button
                  ref={ctaRef}
                  id="welcome-enter-demo"
                  data-action="welcome-enter-demo"
                  data-qh-focus-fallback
                  type="button"
                  className="btn primary"
                  onClick={onEnter}
                >
                  进入评审演示
                </button>
                <a className="btn ghost" href="#/records/audit">
                  查看决策护照
                </a>
              </div>
            </div>
            <div className="qh-hero-visual rv" aria-hidden="true">
              <div className="qh-visual-marks">
                <span className="qh-visual-scale">QH-FIELD / 01</span>
              </div>
            </div>
            {/* M22 r04 A3：cue 参与 Hero 流式布局（与 CTA 同一流、margin-top 24 保 ≥24px 间隔；
                不再 absolute 顶高 hero，仍整体居中；低高度压内容间距不缩标题） */}
            <a
              className="qh-cue"
              id="scroll-cue"
              href="#qh-process"
              onClick={onAnchorClick}
              aria-label="Scroll to explore：向下浏览流程叙事"
            >
              <span className="qh-cue-inner">
                <span className="qh-cue-label">Scroll to explore</span>
                <svg className="qh-cue-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" aria-hidden="true">
                  <path d="M12 4.5v14M6.2 12.8 12 18.6l5.8-5.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </a>
          </div>
        </section>

        <section className="qh-w1-showcase" aria-label="产品体验展台（融合）">
          <SceneShowcase
            scenePosition={scenePosition}
            showControls={false}
            title="同一套外观，贯穿评审判读"
            subtitle="展台随当前环境档位呈现外观。"
          />
          <p className="qh-w1-capnote">展台外观与流程为抽象示意<NoteRef note="flow" /></p>
        </section>

        <section className="qh-w1-caps" id="qh-caps" aria-labelledby="qh-caps-h">
          <h2 id="qh-caps-h" className="sr-only">能力入口</h2>
          <CapabilityTrack
            capabilities={CAPABILITIES}
            onNavigate={(route) => onNavigate?.(route)}
          />
          <p className="qh-w1-capnote">入口开放范围与在线状态以实际接入为准<NoteRef note="readonly" /></p>
        </section>

        <section className="qh-w1-caps" id="qh-device-wheel" aria-labelledby="qh-device-wheel-h">
          <h2 id="qh-device-wheel-h" className="sr-only">设备演示图册</h2>
          <PreviewWheel
            label="设备演示图册（演示库，不是当前站机组）"
            items={DEMO_DEVICE_TYPES.map<PreviewWheelItem>((t) => ({
              id: t.id,
              title: t.name,
              eyebrow: t.tag,
              content: <div className="qh-wheel-device"><DeviceGlyph id={t.id} phase={INFORMATIVE_PHASE[t.id] ?? 0} /><details><summary>设备资料</summary><p>{t.statusNote}（{t.boundaryNote}）</p></details></div>,
            }))}
          />
          <p className="qh-w1-capnote">演示设备库与真实机组分开；不改变调度/安全资格<NoteRef note="readonly" /></p>
        </section>

        <section className="qh-rail" id="qh-process" aria-labelledby="qh-process-h">
          <h2 id="qh-process-h" className="sr-only">产品路径</h2>
          <div className="qh-rail-in">
            <ProcessStage />
          </div>
        </section>

        <ReversibleNudge ariaLabel="决策路径：可回看的上一条说明">
        <section className="qh-flowval" id="qh-flowval" aria-labelledby="qh-flowval-h">
          <div className="qh-flowval-in">
            <div className="qh-flowval-top">
              <div className="rv">
                <p className="qh-eyebrow">DEVICE SYSTEM / 设备系统体验</p>
                <h2 id="qh-flowval-h">
                  <span className="fv-l">从设备系统开始，</span>
                  <span className="fv-l">理解它如何被调度。</span>
                </h2>
              </div>
              <p className="qh-flowval-sub rv">选择设备类型查看状态与边界；演示开关只改展示，未知安全边界不会被演示成可启动。</p>
            </div>
            <div className="qh-flowval-stage rv">
              <DeviceSystemExperience onOpenDemo={onOpenDemo} hostObservation={hostObservation} hostPlayback={hostPlayback} deviceView={initialDeviceView ?? null} onDeviceViewChange={onDeviceViewChange} />
            </div>
          </div>
        </section>
        </ReversibleNudge>

        <ReversibleNudge ariaLabel="决策护照：可回看的上一条说明">
        <section className="qh-proof" id="qh-proof">
          <div className="qh-proof-in">
            <div>
              <p className="qh-eyebrow rv">Product proof / 只读预览</p>
              <h2 className="rv">证据先摆在桌上，结论才有资格出现。</h2>
              <p className="rv">一次调度的来源、约束、复验与人审，都收进同一份决策护照。</p>
              <ul className="qh-proof-list rv">
                <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" /></svg><span>来源可追</span></li>
                <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" /></svg><span>失败保留</span></li>
                <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" /></svg><span>解释不改状态</span></li>
              </ul>

              <div className="qh-proof-rail-wrap rv">
                <PassportProofRail store={store} />
              </div>

              <div className="qh-judge" id="judge-panel">
                <p className="qh-judge-hd">评审快捷入口</p>
                <ol className="qh-judge-steps">
                  {JUDGE_LINKS.map((l) => (
                    <li key={l.id}>
                      <a href={l.href}>
                        <b>{l.id}</b>
                        <span>{l.label}</span>
                        <em>{l.desc}</em>
                      </a>
                    </li>
                  ))}
                </ol>
                <p className="qh-judge-note">只读导航<NoteRef note="readonly" /></p>
              </div>
            </div>

            <aside className="qh-passport rv" aria-labelledby="qh-passport-h">
              <div className="qh-passport-hd">
                <b id="qh-passport-h">最新决策护照（只读）</b>
                <span>{store.corrupted ? 'storage' : 'readonly'}</span>
              </div>
              {store.corrupted ? (
                <p className="hint neg">护照本地存储损坏或不可用：只读展示，未持久化；说明见「已封存成果」栏。</p>
              ) : latest ? (
                /* r40 ⑤·3：最新护照明细已在左侧「已封存成果」（PassportProofRail）逐卡展示，
                   此处不再双显同一 store 数据，只留指引与警示；空态/损坏态分支保持不变。 */
                <p className="hint">最新一份已封存于左侧「已封存成果」列表；本入口不再重复展开同一记录，逐条证据可在记录页只读查看。</p>
              ) : (
                <div className="qh-passport-empty">
                  <p className="hint">
                    尚无决策护照。进入演示、生成并封存一次方案后，这里会显示该方案的真实记录。
                  </p>
                  <button type="button" className="btn ghost" onClick={onEnter}>
                    进入评审演示
                  </button>
                </div>
              )}
              {store.warnings.length ? <p className="hint neg">{store.warnings[0]}</p> : null}
              <div className="qh-passport-ft">护照只读摘要<NoteRef note="passport" /></div>
            </aside>
          </div>
        </section>
        </ReversibleNudge>

        <section className="qh-w1-demos" id="qh-demos" aria-labelledby="qh-demos-h">
          <div className="qh-w1-demos-in">
            <p className="qh-eyebrow rv">NATIVE DEMO / 预录演示</p>
            <h2 id="qh-demos-h" className="rv">预录演示：设备与方案只读浏览。</h2>
            <div className="qh-w1-demos-grid">
              <NativeDemoPlayer
                assetId="ask"
                src="/demo-assets/ask.webm"
                poster="/demo-assets/ask-poster.png"
                captions="/demo-assets/ask-zh.vtt"
                events={ASK_EVENTS}
                label="设备总览与资格边界浏览"
                activeId={demoActiveId}
                onActiveChange={setDemoActiveId}
                controller={demoController}
              />
              <NativeDemoPlayer
                assetId="process"
                src="/demo-assets/process.webm"
                poster="/demo-assets/process-poster.png"
                captions="/demo-assets/process-zh.vtt"
                events={PROCESS_EVENTS}
                label="方案比较与复验边界浏览"
                activeId={demoActiveId}
                onActiveChange={setDemoActiveId}
                controller={demoController}
              />
            </div>
            <p className="qh-w1-capnote">产品演示<Tooltip text="预录产品演示（真实候选实际交互录制），不代表当前系统状态；全程只读，无生产写入，未演示也不声称模型/工具调用成功。">ⓘ</Tooltip><NoteRef note="prerecord" /></p>
          </div>
        </section>

        <ReversibleNudge ariaLabel="能力边界：可回看的上一条说明">
        <section className="qh-bounds" id="qh-bounds">
          <div className="qh-bounds-in">
            <p className="qh-eyebrow rv">Capability bounds / 能力边界</p>
            <h2 className="rv">边界，同样是能力。</h2>
            <ul className="qh-proof-list rv" style={{ maxWidth: '60ch' }}>
              <li title="不连接生产设备、不生成 PLC 程序、不替代现场操作规程"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg><span>不写 PLC</span></li>
              <li title="喘振边界没有确认数据时，该机组不进入自动调度通道"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg><span>未知边界不自动调度</span></li>
              <li title="当前能耗为显式功率模型推算；接入真值前一律标注未验证"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg><span>合成结果不称现场 KPI</span></li>
            </ul>
          </div>
        </section>
        </ReversibleNudge>

        <section className="qh-cta-sec qh-cta-end">
          <div className="qh-cta-in">
            <h2 className="rv">先看它怎么拒绝，再看它怎么推荐。</h2>
            <p className="qh-lede rv">3 分钟看完一次可信调度。</p>
            <div className="qh-cta-row rv">
              <button type="button" className="btn primary" data-action="welcome-enter-demo" onClick={onEnter}>
                进入评审演示
              </button>
              <a className="btn ghost" href="#/records/audit">
                查看决策护照
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="qh-ftr">
        <div className="qh-ftr-in">
          <p>视觉为抽象示意，非现场指令<NoteRef note="flow" /></p>
          <span>QIHENG · SYNTHETIC DEMO</span>
        </div>
      </footer>
    </div>
  )
}
