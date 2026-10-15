import { agentWindowProvenance } from './integration/agentWindowProvenance'
import ConsoleTour from './components/ConsoleTour'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { EvidenceReturnSnapshot } from './integration/evidenceReturn'
import type { QaViewSnapshot, PrologueViewSnapshot, AgentViewSnapshot } from './integration/evidenceReturn'
import type { UnitDirectoryState } from './components/UnitRoster'
import AppNav, { type WorkspaceId } from './components/AppNav'
import { useAutoGlow } from './components/w1/cursor'
import {
  bucketRangeValid,
  isGovernanceHash,
  mapGovernanceQuery,
  mergeObjectContext,
  parseHash,
  reduceRouteNotice,
  resolveNav,
  routeHash,
  routesEqual,
  ROUTE_SPEC,
  SUB_LABEL,
  timeIndexValid,
  TOP_LABEL,
  workspaceForTop,
  type EventSeverityParam,
  type EventTypeParam,
  type RouteOrigin,
  type RouteState,
  type TopRoute,
} from './domain/router'
import { computeRunIdentity } from './domain/runIdentity'
import {
  addEntry,
  backTargetId,
  createStore,
  getEntry,
  hasEntry,
  parentRoute,
  selectTriggerId,
  shouldApplyRestore,
  updateEntry,
  withEntryId,
} from './domain/sessionNav'
import CommandPalette, { type CommandItem } from './components/CommandPalette'
import OriginDialog from './components/unified/OriginDialog'
import { AuthForm } from './components/unified/AuthPreview'
import type { EvidenceFocus } from './components/useEvidenceFocus'
import SchedulingWorkspace from './workspaces/SchedulingWorkspace'
import HistoryLabWorkspace from './workspaces/HistoryLabWorkspace'
import DataIngressWorkspace from './workspaces/DataIngressWorkspace'
import GovernanceWorkspace from './workspaces/GovernanceWorkspace'
import EventsWorkspace from './workspaces/EventsWorkspace'
import AssistantWorkspace from './workspaces/AssistantWorkspace'
import DeviceWorkspace from './workspaces/DeviceWorkspace'
import MapWorkspace from './workspaces/MapWorkspace'
import AgentWorkspace from './workspaces/AgentWorkspace'
import { executionController } from './domain/execution'
import WelcomePage from './components/WelcomePage'
import { entryViewFromHash, isWelcomeHash, WELCOME_HASH, type EntryView } from './domain/entry'
import { replanController } from './domain/replan'
import { FIXED_SEED, UNITS } from './domain/units'
import Clock from './components/console/Clock'
import ConnectionState from './components/console/ConnectionState'
import ConnectionBadge from './components/console/ConnectionBadge'
import MessagesPopover from './components/console/MessagesPopover'
import { consoleDataBus } from './integration/consoleDataBus'
import Popover from './components/console/Popover'
import NotesBar from './components/console/NotesBar'
import NoteRef from './components/console/NoteRef'
import AppearanceDock from './components/appearance/AppearanceDock'
import { installLiquidGlass } from './components/ui/liquidGlass'
import {
  loadAppearanceState,
  saveAppearanceState,
  normalizeAppearance,
  appearanceModeToTheme,
  DEFAULT_APPEARANCE_V2,
  type AppearanceStateV2,
  type AppearanceMode,
} from './components/appearance/appearanceState'
import SceneBackdrop from './components/w1/SceneBackdrop'
import { resolveEnvironment } from './components/w1/environmentAdapter'
import { sampleGlass } from './components/b5/glass-anchors'
import type { RelationKind } from './integration/relations'
import {
  BUCKET_COUNT,
  BUCKET_MINUTES,
  FIXED_HISTORY_SEED,
  HISTORY_MACHINES,
  HISTORY_START_MINUTE,
  buildHistoryFixture,
} from './domain/history'
import { OBSERVATION_INDEX } from './domain/overview'
import type { TimelineClock } from './domain/explore'
import { useObservationClock } from './components/useObservationClock'
import type { EventLocate } from './domain/events'
import { SCENARIOS } from './domain/demand'
import { runScenario, type ScenarioRun } from './domain/engine'
import {
  buildLabRun,
  type LabFixtureId,
  type LabPreference,
  type LabRun,
} from './domain/lab'
import { runHistoryChain, runScheduleChain } from './domain/chain'
import { buildTimeline } from './domain/events'
import { assessHealth } from './domain/health'
import { aggregateQuality } from './domain/quality'
import { RULE_VERSION, makeAuditEvent, planSummary, type AuditEvent } from './domain/audit'
import {
  checkSubmitSnapshot,
  loadDemoStore,
  planSignature,
  resolveEffectiveDecision,
  saveDemoStore,
  type ApprovalContext,
  type EffectiveDecision,
} from './domain/approval'
import type { EvidenceWorkspace } from './domain/evidence'
import type { ApprovalDecision, DecisionOutcome, ScenarioId } from './domain/types'
import {
  applyTheme,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
  systemPrefersDark,
  type ResolvedTheme,
  type ThemePreference,
} from './theme'

/** 搜索来源有效性：确为本轮可聚焦的真实元素（非 body/失效/不可聚焦）。 */
function isUsableOrigin(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.isConnected || el === document.body) return false
  return (
    typeof el.focus === 'function' &&
    (el.tabIndex >= 0 || el.matches('a[href], button, input, select, textarea, summary'))
  )
}

export default function App() {
  // M20 r03 · 全局光学指针（页面级单源阻尼）——所有 .u-glow/玻璃表面实时追随鼠标。
  useAutoGlow()
  const [initialRoute] = useState<RouteState>(() =>
    parseHash(typeof window !== 'undefined' ? window.location.hash : ''),
  )
  const [route, setRoute] = useState<RouteState>(() =>
    initialRoute.valid ? initialRoute : parseHash(initialRoute.normalizedHash),
  )
  const routeRef = useRef(route)
  routeRef.current = route
  const [entryView, setEntryView] = useState<EntryView>(() =>
    // 无 window（SSR/测试）回退业务壳；真实浏览器空 hash 才进欢迎。
    typeof window !== 'undefined' ? entryViewFromHash(window.location.hash) : 'business',
  )
  const welcomeReturningRef = useRef(false)
  const workspace = workspaceForTop(route.top)
  const [scenario, setScenario] = useState<ScenarioId>(initialRoute.scenario)
  const [fixtureId, setFixtureId] = useState('fx_baseline')
  const [initialStore] = useState(loadDemoStore)
  const [decisions, setDecisions] = useState<ApprovalDecision[]>(initialStore.decisions)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(initialStore.auditEvents)
  const [storeNotice] = useState<string | null>(
    initialStore.warnings[0] ?? null,
  )
  const [storeError, setStoreError] = useState<string | null>(null)
  const [locateNotice, setLocateNotice] = useState<string | null>(null)
  const [routeNotice, setRouteNotice] = useState<string | null>(
    initialRoute.valid ? null : initialRoute.reason,
  )
  // 仅本会话内存的人审理由草稿：按完整当前身份绑定，换身份清空，绝不入 URL/localStorage。
  const [reviewDraft, setReviewDraft] = useState('')
  // 调度设备锁提升到 App：跨四子页返回保留。
  const [linkedUnitId, setLinkedUnitId] = useState<string | null>(null)
  const [focus, setFocus] = useState<EvidenceFocus | null>(null)
  const [recomputeNonce, setRecomputeNonce] = useState(0)
  const [mode, setMode] = useState<'legacy' | 'lab'>(initialRoute.mode)
  const [labFixture, setLabFixture] = useState<LabFixtureId>(initialRoute.lab)
  const [labPreference, setLabPreference] = useState<LabPreference>(initialRoute.pref)
  const [themePref, setThemePref] = useState<ThemePreference>(loadThemePreference)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(loadThemePreference(), systemPrefersDark()))
  // M16 r01 · 外观受控状态 v2（唯一宿主 state）：environmentPosition / appearanceMode / followLocalTime / glassIntensity。
  const [appearance, setAppearance] = useState<AppearanceStateV2>(() => {
    const s = loadAppearanceState()
    // 主题偏好与外观模式显式映射（旧 light/dark ↔ 新 day/night）。
    return s
  })
  const glassIntensity = appearance.glassIntensity
  const followRealTime = appearance.followLocalTime
  const setScenePosition = (v: number) => setAppearance((a) => normalizeAppearance({ ...a, environmentPosition: v }))
  const setGlassIntensity = (v: number) => setAppearance((a) => normalizeAppearance({ ...a, glassIntensity: v }))
  const setFollowRealTime = (v: boolean) => setAppearance((a) => normalizeAppearance({ ...a, followLocalTime: v }))
  const setAppearanceMode = (m: AppearanceMode) => {
    setAppearance((a) => normalizeAppearance({ ...a, appearanceMode: m }))
    setThemePref(appearanceModeToTheme(m))
  }
  const appearanceMode: AppearanceMode = appearance.appearanceMode
  useEffect(() => {
    saveAppearanceState(appearance)
  }, [appearance])
  // 液态玻璃指针高光（全局单例，阻尼跟随；卸载即撤）。
  useEffect(() => installLiquidGlass(), [])
  // 随本地时间：每分钟 bump 非空 tick，触发 resolveEnvironment 以新时刻重算（D11 时钟由宿主注入）。
  const [, setNowTick] = useState(0)
  useEffect(() => {
    if (!followRealTime) return
    setNowTick((t) => t + 1)
    const id = window.setInterval(() => setNowTick((t) => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [followRealTime])
  // 重置：回到默认「跟随系统」（mode=system、地球关、手动值清、默认玻璃）。
  const resetAppearance = () => {
    setThemePref('system')
    setAppearance({ ...DEFAULT_APPEARANCE_V2 })
  }
  // M12 r02：R6 关联证据上下文（App 持有，路由中立；governance 返回时恢复筛选/选中）。
  const [directoryState, setDirectoryState] = useState<UnitDirectoryState>({ query: '', filter: 'all' })
  const directoryRef = useRef(directoryState); directoryRef.current = directoryState
  const [evidenceFilter, setEvidenceFilter] = useState<'all' | RelationKind>('all')
  const [evidenceSelected, setEvidenceSelected] = useState<string | null>(null)
  const [evidenceDepth, setEvidenceDepth] = useState<1 | 2>(1)

  const evidenceFilterRef = useRef(evidenceFilter); evidenceFilterRef.current = evidenceFilter
  const evidenceSelectedRef = useRef(evidenceSelected); evidenceSelectedRef.current = evidenceSelected
  const linkedUnitIdRef = useRef(linkedUnitId); linkedUnitIdRef.current = linkedUnitId
  const evidenceDepthRef = useRef(evidenceDepth); evidenceDepthRef.current = evidenceDepth
  // M27 B · 已完成 QA 视图（受控）：仅内存，随唯一会话 entry 的临时快照捕获/恢复。
  const [qaView, setQaView] = useState<QaViewSnapshot | null>(null)
  const qaViewRef = useRef(qaView); qaViewRef.current = qaView
  const [prologueView, setPrologueView] = useState<PrologueViewSnapshot | null>(null)
  const prologueViewRef = useRef(prologueView); prologueViewRef.current = prologueView
  const [agentView, setAgentView] = useState<AgentViewSnapshot | null>(null)
  const agentViewRef = useRef(agentView); agentViewRef.current = agentView
  const [mapView, setMapView] = useState<'site' | 'data' | 'decision'>('site')
  const mapViewRef = useRef(mapView); mapViewRef.current = mapView
  const [commandOpen, setCommandOpen] = useState(false)
  // 搜索模态：本次打开的真实来源（Ctrl+K 捕获当前有效焦点，否则真实搜索触发按钮兜底）。
  const commandOriginRef = useRef<HTMLElement | null>(null)
  const searchTriggerRef = useRef<HTMLButtonElement>(null)
  // 登录/注册模态（AuthForm，未接入鉴权）：本次来源 + 面板首字段。
  const [authOpen, setAuthOpen] = useState(false)
  const authOriginRef = useRef<HTMLElement | null>(null)
  const authEmailRef = useRef<HTMLInputElement | null>(null)

  // S1 侧栏：固定窄栏（移除滑动设计；移动端用 railOpen 抽屉）。不保存/伪造身份。
  const [railOpen, setRailOpen] = useState(false)
  const [demoTarget, setDemoTarget] = useState<string | null>(null)
  const railTriggerRef = useRef<HTMLButtonElement | null>(null)
  const railAsideRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const railOpenRef = useRef(false)
  railOpenRef.current = railOpen
  const pendingHeadingFocusRef = useRef(false)
  const railExitRef = useRef<'menu' | 'route'>('menu')
  const [railIsDrawer, setRailIsDrawer] = useState(false)
  // 断点判定：仅手机抽屉启用 dialog/inert/围栏语义；桌面 rail 为普通 navigation。
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)')
    const on = () => setRailIsDrawer(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  // 两种退出原因分离：menu（Esc/遮罩/关闭按钮）→ 回 menu button；route → 目标 heading。
  const closeRailToTrigger = useCallback(() => { railExitRef.current = 'menu'; setRailOpen(false) }, [])
  const closeRailByRoute = useCallback(() => { railExitRef.current = 'route'; pendingHeadingFocusRef.current = true; setRailOpen(false) }, [])
  useEffect(() => {
    if (!railOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRailToTrigger() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [railOpen, closeRailToTrigger])
  // 抽屉语义 + 背景(.app-body) inert + 初始焦点（仅手机抽屉）；关闭按需释放旧 inert。
  useEffect(() => {
    if (!railOpen || !railIsDrawer) return
    const body = bodyRef.current
    const prevInert = body ? body.inert : false
    if (body) body.inert = true
    const aside = railAsideRef.current
    const closeBtn = aside?.querySelector<HTMLElement>('.rail-close')
    const active = aside?.querySelector<HTMLElement>('.nav-item[aria-current], .nav-item')
    ;(closeBtn ?? active)?.focus?.()
    return () => { if (body) body.inert = prevInert }
  }, [railOpen, railIsDrawer])
  // 路由成功：仅当抽屉此前开着 → 记 pending（不依赖 railOpen，避免 cleanup 取消 rAF）。
  const prevRouteKeyRef = useRef(`${route.top}/${route.sub}`)
  useEffect(() => {
    const key = `${route.top}/${route.sub}`
    if (prevRouteKeyRef.current === key) return
    prevRouteKeyRef.current = key
    if (railOpenRef.current) closeRailByRoute()
  }, [route.top, route.sub, closeRailByRoute])
  // 消费 pending：目标 DOM commit 且抽屉/inert 释放后聚焦真实可见标题（latest-wins 单标志）。
  useEffect(() => {
    if (!pendingHeadingFocusRef.current) return
    if (railOpen) return
    pendingHeadingFocusRef.current = false
    const el = document.querySelector<HTMLElement>('[data-page-title], .topbar-title h1, .app-content h1, .app-content h2')
    if (!el) return
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
    el.focus()
  }, [route.top, route.sub, railOpen])

  // M23 B r06 · 二级导航当前项在局部横滚容器内自动可见：**只调 .sub-nav.scrollLeft**，不动祖先/页面纵向滚动。
  useEffect(() => {
    const run = () => {
      const nav = document.querySelector<HTMLElement>('.sub-nav')
      const el = nav?.querySelector<HTMLElement>('.sub-nav-item[aria-current="page"], .sub-nav-item.active')
      if (!nav || !el) return
      // M23 B r07 · 用 nav/item 真实 rect 差 + scrollLeft，只改局部 scrollLeft（不混祖先坐标、不纵向滚页）。
      const nr = nav.getBoundingClientRect()
      const er = el.getBoundingClientRect()
      if (er.left < nr.left) nav.scrollLeft += er.left - nr.left - 12
      else if (er.right > nr.right) nav.scrollLeft += er.right - nr.right + 12
    }
    run()
    window.addEventListener('resize', run)
    return () => window.removeEventListener('resize', run)
  }, [route.top, route.sub])

  // 退出后按原因恢复焦点：menu→burger（route 由 pending 消费）。
  const prevRailOpenRef = useRef(false)
  useEffect(() => {
    if (prevRailOpenRef.current && !railOpen && railExitRef.current === 'menu') railTriggerRef.current?.focus()
    prevRailOpenRef.current = railOpen
  }, [railOpen])
  // resize 跨断点：收起并释放（回 menu）。
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900 && railOpenRef.current) { railExitRef.current = 'menu'; setRailOpen(false) }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // 抽屉内 Tab / 首次 ShiftTab 围栏（背景已 inert）。
  const onRailKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (!railOpen || !railIsDrawer || e.key !== 'Tab') return
    const aside = railAsideRef.current
    if (!aside) return
    const focusables = Array.from(aside.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
    if (!focusables.length) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const activeEl = document.activeElement as HTMLElement | null
    if (e.shiftKey && (activeEl === first || !aside.contains(activeEl))) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && activeEl === last) { e.preventDefault(); first.focus() }
  }, [railOpen, railIsDrawer])
  // 移动端顶栏：默认收齐状态/操作，按按钮展开。
  const [topbarOpen, setTopbarOpen] = useState(false)
  const decisionsRef = useRef<ApprovalDecision[]>(initialStore.decisions)

  useEffect(() => {
    // v2 读取损坏 / 被拒时 writable=false：不覆盖坏原文，只保留本次会话内存态。
    if (!initialStore.writable) return
    const result = saveDemoStore(decisions, auditEvents)
    if (!result.ok) {
      setStoreError(
        `演示状态仅本次会话有效、未保存：${result.error ?? '本地存储不可用'}（刷新后不会恢复）。`,
      )
    } else {
      setStoreError(null)
    }
  }, [decisions, auditEvents, initialStore.writable])

  useEffect(() => {
    const r = applyTheme(themePref)
    saveThemePreference(themePref)
    setResolvedTheme(r)
  }, [themePref])

  useEffect(() => {
    if (themePref !== 'system') return
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setResolvedTheme(applyTheme('system'))
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [themePref])

  const legacyRun = useMemo(
    () => runScenario(scenario, UNITS, FIXED_SEED),
    [scenario],
  )
  // 唯一 activeRun：旧版冻结示例或 lab 选定夹具 + 策略；各工作区不再自行重算当前方案。
  const run: ScenarioRun = useMemo(
    () =>
      mode === 'lab'
        ? buildLabRun(labFixture, labPreference)
        : legacyRun,
    [mode, labFixture, labPreference, legacyRun],
  )
  // 执行链业务上下文守卫（持久上层）：真实业务输入/来源/模式/参数/资格故障/规则变化即停步退休。
  // 视图 subroute / 观察 index / 播放 / 主题 / 墙钟变化不进入 businessKey。
  useEffect(() => {
    const fault = run.faultUnitId ?? null
    executionController.setBusinessContext({
      businessKey: `${scenario}|${mode}|${labFixture}|${labPreference}|${RULE_VERSION}|fault=${fault ?? 'none'}`,
      invalid: Boolean(fault),
    })
    replanController.setBusinessContext({
      businessKey: `${scenario}|${mode}|${labFixture}|${labPreference}|${RULE_VERSION}|fault=${fault ?? 'none'}`,
      invalid: Boolean(fault),
    })
  }, [scenario, mode, labFixture, labPreference, run])

  // 统一显示 / 确认 / 提交端同一身份快照：与 approvalContext.runRef 完全一致。
  // 旧模式保留持久 runRef 兼容；lab 用完整 identity（含偏好隔离）。
  const runRef = useMemo(
    () =>
      mode === 'lab'
        ? (run as LabRun).lab.identity
        : `synthetic_schedule:${scenario}:seed=${run.series.seed}`,
    [mode, run, scenario],
  )
  // 显示 / 捕获 / 草稿绑定 / 提交端使用同一个“强身份”（含规则/候选/初态/参数/时轴/计划）；
  // 持久 runRef 仅用于存储与有效批准兼容。
  const runIdentity = useMemo(
    () =>
      computeRunIdentity({
        mode,
        persistentRunRef: runRef,
        scenario,
        ruleVersion: RULE_VERSION,
        candidateRef: run.evaluation.candidates.map((u) => u.id).join('+') || 'none',
        planSignature: planSignature(run.recommendation),
        initial: run.initial,
        stepMinutes: run.series.stepMinutes,
        seed: run.series.seed,
        points: run.series.points.map((p) => ({
          minuteOfDay: p.minuteOfDay,
          demand: p.demand,
        })),
        units: run.allUnits,
        eligibility: run.evaluation.eligibility,
        faultUnitId: run.faultUnitId,
        labIdentity: mode === 'lab' ? (run as LabRun).lab.identity : undefined,
      }),
    [mode, runRef, scenario, run],
  )


  // 同源观察时钟提升到 App：切换工作区 / 主题不丢失同源上下文；
  // 调度与回放来源时轴不同，各自独立，不拼接分钟。
  const scheduleTimeline = useMemo<TimelineClock>(
    () => ({
      sourceId: 'synthetic_schedule',
      stepMinutes: run.series.stepMinutes,
      count: run.series.points.length,
      startMinute: 0,
    }),
    [run.series.stepMinutes, run.series.points.length],
  )
  const historyTimeline = useMemo<TimelineClock>(
    () => ({
      sourceId: 'synthetic_history',
      stepMinutes: BUCKET_MINUTES,
      count: BUCKET_COUNT,
      startMinute: HISTORY_START_MINUTE,
    }),
    [],
  )
  const scheduleClock = useObservationClock(scheduleTimeline, OBSERVATION_INDEX)
  const historyClock = useObservationClock(historyTimeline, 0)
  const scheduleClockRef = useRef(scheduleClock)
  scheduleClockRef.current = scheduleClock
  const historyClockRef = useRef(historyClock)
  historyClockRef.current = historyClock

  const currentScenarioLabel =
    mode === 'lab'
      ? run.series.scenarioLabel
      : SCENARIOS.find((s) => s.id === scenario)?.label ?? scenario

  const scheduleChain = useMemo(
    () => runScheduleChain({ scenario, scenarioLabel: currentScenarioLabel, run }),
    [scenario, currentScenarioLabel, run],
  )

  const approvalContext = useMemo<ApprovalContext>(
    () => ({
      scenario,
      sourceId: 'synthetic_schedule',
      runRef,
      candidateRef: run.evaluation.candidates.map((u) => u.id).join('+') || 'none',
      ruleVersion: RULE_VERSION,
      planSignature: planSignature(run.recommendation),
    }),
    [scenario, run, runRef],
  )
  const effectiveDecision = useMemo<EffectiveDecision>(
    () => resolveEffectiveDecision(decisions, auditEvents, approvalContext),
    [decisions, auditEvents, approvalContext],
  )
  // 提交端快照核验用的“最新上下文”引用。
  const approvalContextRef = useRef(approvalContext)
  approvalContextRef.current = approvalContext
  // 提交端核验比较“最新强身份 ref”，不用旧闭包。
  const runIdentityRef = useRef(runIdentity)
  runIdentityRef.current = runIdentity

  const fixture = useMemo(
    () => buildHistoryFixture(fixtureId, FIXED_HISTORY_SEED),
    [fixtureId],
  )
  const quality = useMemo(() => aggregateQuality(fixture), [fixture])
  const health = useMemo(() => assessHealth(fixture), [fixture])
  const historyReview = useMemo(
    () => runHistoryChain({ fixture, quality, health }),
    [fixture, quality, health],
  )
  const timeline = useMemo(
    () =>
      buildTimeline({
        run,
        scenarioLabel: currentScenarioLabel,
        quality,
        health,
        scheduleChain,
        historyReview,
        decisions: decisions.filter((d) => d.scenario === scenario),
      }),
    [run, currentScenarioLabel, quality, health, scheduleChain, historyReview, decisions, scenario],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen((prev) => {
          if (prev) return false
          // 打开：捕获本次有效焦点为来源；无效/body → 真实搜索触发按钮兜底（不沿用旧来源）。
          const ae = document.activeElement as HTMLElement | null
          commandOriginRef.current = isUsableOrigin(ae) ? ae : searchTriggerRef.current
          return true
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 仅会话 history-entry：每个浏览器条目唯一 entryId（写在 history.state，保留其他字段）。
  const navStoreRef = useRef(createStore())
  const currentEntryIdRef = useRef<string>('')
  const entrySeqRef = useRef(0)
  const nextEntryId = useCallback(
    () => `e${++entrySeqRef.current}-${Date.now().toString(36)}`,
    [],
  )
  const applyRouteState = useCallback((next: RouteState) => {
    setRoute(next)
    setMode(next.mode)
    setScenario(next.scenario)
    setLabFixture(next.lab)
    setLabPreference(next.pref)
  }, [])
  const restoringRef = useRef(false)
  const lastRestoredEntryRef = useRef<string | null>(null)
  // 已处理的真实导航 hash（用于识别规范化后的重复 popstate/hashchange 回响，避免误清本次拒绝提示）。
  const lastHandledHashRef = useRef<string | null>(
    typeof window !== 'undefined' ? window.location.hash : null,
  )
  const [pendingEntry, setPendingEntry] = useState<{ id: string; returning: boolean } | null>(null)
  const captureEntry = useCallback((originId?: string) => {
    const id = currentEntryIdRef.current
    if (!id || restoringRef.current) return
    const rec = getEntry(navStoreRef.current, id)
    const active = document.activeElement as HTMLElement | null
    // Popover内部按钮会卸载，不允许覆盖长期来源trigger。
    const activeId = active?.closest('.disc-pop') ? '' : active?.id || ''
    const triggerId = originId || selectTriggerId(activeId, rec?.triggerId)
    const scrollY = (document.scrollingElement || document.documentElement).scrollTop
    const context: EvidenceReturnSnapshot = {
      route: { ...routeRef.current }, filter: evidenceFilterRef.current,
      selected: evidenceSelectedRef.current, linked: linkedUnitIdRef.current,
      depth: evidenceDepthRef.current, scrollY, focusId: triggerId, directory: { ...directoryRef.current },
      qaView: qaViewRef.current ?? undefined,
      prologueView: prologueViewRef.current ?? undefined,
      agentView: agentViewRef.current ?? undefined,
      mapView: mapViewRef.current,
    }
    updateEntry(navStoreRef.current, id, { scrollY, triggerId, context })
  }, [])
  const restoreEntry = useCallback((id: string, returning: boolean) => {
    restoringRef.current = true
    const context = returning ? getEntry(navStoreRef.current, id)?.context : null
    if (context) {
      setFocus(null)
      if (context.directory) setDirectoryState(context.directory)
      setEvidenceFilter(context.filter); setEvidenceSelected(context.selected)
      setLinkedUnitId(context.linked); setEvidenceDepth(context.depth)
      // M27 B · 同一 commit 恢复 QA 视图，使本次 qa-ref 按钮真实存在后再回焦；不重新 askQuestion/narrateAnswer。
      const qa = context.qaView
      setQaView(qa && qa.runIdentity === runIdentityRef.current ? qa : null)
      const av = context.agentView
      setAgentView(av && av.runIdentity === runIdentityRef.current ? av : null)
      if (context.mapView) setMapView(context.mapView)
    } else if (returning) {
      // 返回目标 entry 无 QA 快照 / 代次失效：废弃旧答案与引用。
      setQaView(null)
    }
    setPendingEntry({ id, returning })
  }, [])
  // React提交了目标route和context才消费；同hash也由pendingEntry触发。
  useLayoutEffect(() => {
    if (!pendingEntry) return
    const rec = getEntry(navStoreRef.current, pendingEntry.id)
    if (!rec || currentEntryIdRef.current !== rec.entryId || route.normalizedHash !== rec.canonicalHash) return
    const context = pendingEntry.returning ? rec.context : null
    if (context && (evidenceFilter !== context.filter || evidenceSelected !== context.selected ||
        linkedUnitId !== context.linked || evidenceDepth !== context.depth)) return
    if (context?.directory && (directoryState.query !== context.directory.query || directoryState.filter !== context.directory.filter)) return
    const triggerId = pendingEntry.returning ? rec.triggerId : null
    const srcEl = triggerId ? document.getElementById(triggerId) : null
    const srcVisible = !!srcEl && srcEl.getClientRects().length > 0
    // M29 r33 · 异步来源宿主（MAP 图 loaded 后才挂 relations-open-* 按钮）：不立即完成/不 fallback；
    // 有界 MutationObserver 等目标存在+可见后一次回焦；切 entry/卸载取消；不可用才一次合法 fallback。
    if (triggerId && triggerId.startsWith('relations-open') && !srcVisible) {
      let obs: MutationObserver | null = null
      let timer = 0
      const cleanup = () => { obs?.disconnect(); obs = null; if (timer) window.clearTimeout(timer) }
      const complete = (el: HTMLElement | null) => {
        cleanup()
        const target = (el && el.getClientRects().length ? el : null) || document.querySelector<HTMLElement>('[data-page-title], .topbar-title h1, .app-content h2')
        if (!target) return
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
        target.focus({ preventScroll: true })
        const scroller = document.scrollingElement || document.documentElement
        scroller.scrollTop = rec.scrollY
        lastRestoredEntryRef.current = rec.entryId
        restoringRef.current = false
        setPendingEntry(null)
      }
      const tryFocus = () => { const el = document.getElementById(triggerId); if (el && el.getClientRects().length) complete(el) }
      obs = new MutationObserver(tryFocus)
      obs.observe(document.body, { childList: true, subtree: true })
      timer = window.setTimeout(() => complete(null), 2000)
      tryFocus()
      return cleanup
    }
    const target = (srcVisible ? srcEl : null) || document.querySelector<HTMLElement>('[data-page-title], .topbar-title h1, .app-content h2')
    if (!target) return
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
    const scroller = document.scrollingElement || document.documentElement
    scroller.scrollTop = pendingEntry.returning ? rec.scrollY : 0
    lastRestoredEntryRef.current = rec.entryId
    restoringRef.current = false
    setPendingEntry(null)
  }, [pendingEntry, route.normalizedHash, evidenceFilter, evidenceSelected, linkedUnitId, evidenceDepth, directoryState])
  // 当前entry的对象状态同步；恢复批次不得回写污染来源。
  useEffect(() => { captureEntry() }, [evidenceFilter, evidenceSelected, linkedUnitId, evidenceDepth, directoryState, captureEntry])
  useEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => { window.history.scrollRestoration = previous }
  }, [])

  // 被动记录当前条目的 scroll / focus（程序性恢复期间跳过）。
  useEffect(() => {
    if (typeof window === 'undefined') return
    const record = () => { captureEntry() }
    window.addEventListener('scroll', record, { passive: true })
    window.addEventListener('focusin', record)
    return () => {
      window.removeEventListener('scroll', record)
      window.removeEventListener('focusin', record)
    }
  }, [captureEntry])

  // 首次配置：会话内已有入口用其 entryId，否则新建并 replaceState 规范化（保留 state）。
  useEffect(() => {
    if (typeof window === 'undefined') return
    // 欢迎页（空 hash / #/welcome）不得被初始 replaceState 吞掉。
    if (entryViewFromHash(window.location.hash) === 'welcome') return
    const st = window.history.state as { qihengEntryId?: string } | null
    const existing = st?.qihengEntryId
    let id = typeof existing === 'string' && hasEntry(navStoreRef.current, existing) ? existing : ''
    if (!id) {
      id = nextEntryId()
      addEntry(navStoreRef.current, {
        entryId: id,
        canonicalHash: initialRoute.normalizedHash,
        parentEntryId: null,
        scrollY: 0,
        triggerId: null,
      })
      window.history.replaceState(withEntryId(st, id), '', initialRoute.normalizedHash)
    }
    currentEntryIdRef.current = id
  }, [initialRoute, nextEntryId])

  // 白名单 hash 导航：一次点击一次 pushState 新条目；显式解析（pushState 无 hashchange）。
  const navigate = useCallback(
    (
      partial: {
        top: TopRoute
        sub?: string
        mode?: 'legacy' | 'lab'
        scenario?: ScenarioId
        lab?: LabFixtureId
        pref?: LabPreference
        source?: 'schedule' | 'history' | null
        t?: number | null
        a?: number | null
        b?: number | null
        batchId?: string | null
        eventId?: string | null
        sourceId?: string | null
        passportId?: string | null
        eventType?: EventTypeParam | null
        eventSeverity?: EventSeverityParam | null
        eventOffset?: number | null
        from?: RouteOrigin | null
        fromSourceId?: string | null
        fromEventId?: string | null
        fromType?: EventTypeParam | null
        fromSeverity?: EventSeverityParam | null
        fromOffset?: number | null
      },
      opts?: { replace?: boolean; forceEntry?: boolean; originId?: string },
    ) => {
      const base = routeRef.current
      const sameTop = partial.top === base.top
      // 携带目标页时钟的当前合法选择（手动锁/区间后不回滚到旧 route.t）。
      const clockApi =
        partial.top === 'history'
          ? historyClockRef.current
          : partial.top === 'schedule'
            ? scheduleClockRef.current
            : null
      const live =
        clockApi && clockApi.range && clockApi.range[0] >= 0
          ? { a: clockApi.range[0], b: clockApi.range[1] }
          : { a: null, b: null }
      const liveSel = clockApi
        ? {
            source: partial.top === 'history' ? ('history' as const) : ('schedule' as const),
            t: clockApi.state.timeLock ?? clockApi.effectiveIndex,
            a: live.a,
            b: live.b,
          }
        : { source: null, t: null, a: null, b: null }
      const next = {
        top: partial.top,
        sub: partial.sub ?? (sameTop ? base.sub : ROUTE_SPEC[partial.top][0]),
        mode: partial.mode ?? base.mode,
        scenario: partial.scenario ?? base.scenario,
        lab: partial.lab ?? base.lab,
        pref: partial.pref ?? base.pref,
        source: partial.source !== undefined ? partial.source : liveSel.source,
        t: partial.t !== undefined ? partial.t : liveSel.t,
        a: partial.a !== undefined ? partial.a : liveSel.a,
        b: partial.b !== undefined ? partial.b : liveSel.b,
        batchId: null as string | null,
        eventId: null as string | null,
        sourceId: null as string | null,
        passportId: null as string | null,
        eventType: null as EventTypeParam | null,
        eventSeverity: null as EventSeverityParam | null,
        eventOffset: null as number | null,
        from: null as RouteOrigin | null,
        fromSourceId: null as string | null,
        fromEventId: null as string | null,
        fromType: null as EventTypeParam | null,
        fromSeverity: null as EventSeverityParam | null,
        fromOffset: null as number | null,
      }
      // 对象定位/查询上下文：显式提供则用其值（null=清除）；同一离线子页内沿用当前上下文
      // （事件选择/分页/筛选不丢已应用来源）；跨页仅带显式提供的对象，避免旧参数污染导航。
      Object.assign(
        next,
        mergeObjectContext(partial, base, next.top, next.sub),
      )
      // 离线功能子页不携带合成定位/时钟；仅带受控对象定位。
      const offlineTarget =
        (next.top === 'history' && next.sub === 'data') ||
        (next.top === 'events' && next.sub === 'governance')
      if (offlineTarget) {
        next.source = null
        next.t = null
        next.a = null
        next.b = null
      }
      const hash = routeHash(next)
      // 明确合法 UI 导航：先清本次拒绝提示（同 hash 也清），再早退——不 pushState/造 entry/假重读。
      setRouteNotice((prev) => reduceRouteNotice(prev, { type: 'ui-navigate' }))
      if (typeof window === 'undefined' || (window.location.hash === hash && !opts?.forceEntry)) return
      captureEntry(opts?.originId)
      const store = navStoreRef.current
      const curId = currentEntryIdRef.current
      // 导航开始即进入恢复保护：React 卸载 / 浏览器 focus 恢复不得覆盖离开前记录的 trigger。
      restoringRef.current = true
      if (opts?.replace) {
        window.history.replaceState(withEntryId(window.history.state, curId), '', hash)
        updateEntry(store, curId, { canonicalHash: hash })
        applyRouteState(parseHash(hash))
        lastHandledHashRef.current = window.location.hash
        window.setTimeout(() => {
          restoringRef.current = false
        }, 0)
        return
      }

      const id = nextEntryId()
      addEntry(store, {
        entryId: id,
        canonicalHash: hash,
        parentEntryId: curId || null,
        scrollY: 0,
        triggerId: null,
      })
      window.history.pushState(withEntryId(window.history.state, id), '', hash)
      currentEntryIdRef.current = id
      lastHandledHashRef.current = window.location.hash
      applyRouteState(parseHash(hash))
      restoreEntry(id, false)
    },
    [applyRouteState, nextEntryId, restoreEntry, captureEntry],
  )

  // popstate / hashchange 统一：按 history.state 的 entryId 恢复；无则新建（parent=当前）。
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onNav = () => {
      const browserId = (window.history.state as { qihengEntryId?: string } | null)?.qihengEntryId
      if (browserId !== currentEntryIdRef.current) captureEntry()
      // 欢迎页：只切换视图，不解析业务路由、不覆盖 hash。
      if (isWelcomeHash(window.location.hash)) {
        welcomeReturningRef.current = true
        setEntryView('welcome')
        setRouteNotice(null)
        // M29 · 返回序幕：按目标 entry 快照恢复设备入口（runIdentity 失效即废弃）。
        const bounds = typeof browserId === 'string' ? getEntry(navStoreRef.current, browserId) : null
        const pv = bounds?.context?.prologueView
        // r40：有快照按 runIdentity 校验恢复；无快照保留当前选中（演示库「类型资料 ↗」先设
        // prologueView 再跳回欢迎，不应被无 entry 的 hash 变化清空；runIdentity 失效仍废弃）。
        const keep = prologueViewRef.current
        setPrologueView(pv ? (pv.runIdentity === runIdentityRef.current ? pv : null) : (keep && keep.runIdentity === runIdentityRef.current ? keep : null))
        restoringRef.current = false
        return
      }
      setEntryView('business')
      // 导航/浏览器前进后退一开始就进入恢复保护，屏蔽卸载与浏览器 focus/scroll 恢复的写入。
      restoringRef.current = true
      const raw = window.location.hash
      // 统一归约：非法覆盖 reason、合法 echo 保留、合法新意图清（规范化回响不清本次 notice）。
      const nav = resolveNav(raw, lastHandledHashRef.current)
      setRouteNotice((prev) => reduceRouteNotice(prev, { type: 'browser-nav', raw, lastHandled: lastHandledHashRef.current }))
      if (!nav.valid) {
        window.history.replaceState(
          withEntryId(window.history.state, currentEntryIdRef.current),
          '',
          nav.normalizedHash,
        )
      }
      // route 始终持有规范化后的合法 canonical；拒绝原因只走 routeNotice，避免旧 route.reason 压过新请求。
      const canonical = parseHash(nav.normalizedHash)
      lastHandledHashRef.current = window.location.hash
      const store = navStoreRef.current
      const st = window.history.state as { qihengEntryId?: string } | null
      const existing = st?.qihengEntryId
      let id = typeof existing === 'string' && hasEntry(store, existing) ? existing : ''
      if (!id) {
        id = nextEntryId()
        addEntry(store, {
          entryId: id,
          canonicalHash: canonical.normalizedHash,
          parentEntryId: currentEntryIdRef.current || null,
          scrollY: 0,
          triggerId: null,
        })
        window.history.replaceState(withEntryId(st, id), '', canonical.normalizedHash)
      }
      currentEntryIdRef.current = id
      if (!routesEqual(canonical, routeRef.current) || !routeRef.current.valid) {
        applyRouteState(canonical)
      }
      // 重复 popstate/hashchange 通知只恢复一次；等目标 React 页真实挂载后再恢复。
      if (shouldApplyRestore(id, lastRestoredEntryRef.current)) {
        restoreEntry(id, true)
      } else {
        // 重复通知不重复恢复，但仍需释放恢复保护。
        window.setTimeout(() => {
          restoringRef.current = false
        }, 0)
      }
    }
    window.addEventListener('hashchange', onNav)
    window.addEventListener('popstate', onNav)
    return () => {
      window.removeEventListener('hashchange', onNav)
      window.removeEventListener('popstate', onNav)
    }
  }, [applyRouteState, nextEntryId, restoreEntry, captureEntry])

  // 深链定位真实接入：合法 source/t/a/b 才应用，越界/错源提示而不伪定位，并暂停播放。
  useEffect(() => {
    if (!route.valid) return
    if (!route.source) {
      // 新的合法无定位页：清掉旧定位提示。
      setLocateNotice(null)
      return
    }
    const problems: string[] = []
    // 页面 / source 匹配：调度页只应用调度索引，回放证据页只应用回放索引。
    const expectedTop = route.source === 'schedule' ? 'schedule' : 'history'
    if (route.top !== expectedTop) {
      setLocateNotice(
        `来源「${route.source}」与当前页面「${route.top}」不匹配，已忽略定位（不夹边）。`,
      )
      return
    }
    const api = route.source === 'schedule' ? scheduleClock : historyClock
    const count = api.clock.count
    api.setPlaying(false)
    if (route.t !== null) {
      if (timeIndexValid(route.t, count)) api.lockIndex(route.t)
      else problems.push(`定位时刻 ${route.t} 超出时轴（0–${count - 1}）`)
    }
    if (route.a !== null && route.b !== null) {
      if (bucketRangeValid(route.a, route.b, count)) api.setRange([route.a, route.b])
      else
        problems.push(
          `闭桶区间 [${route.a},${route.b}] 超出时轴（要求 0≤a≤b<${count}）`,
        )
    }
    setLocateNotice(problems.length ? `深链定位未应用：${problems.join('；')}` : null)
    // 仅按规范化身份触发，避免播放 tick / 主题等重放。
  }, [route.normalizedHash, route.valid, route.source, route.t, route.a, route.b])

  // 真实来源返回：当前条目确有我方直接父条目才 history.back；否则父页 fallback。
  const goBack = useCallback(() => {
    const store = navStoreRef.current
    const curId = currentEntryIdRef.current
    const parentId = backTargetId(store, curId)
    if (parentId && typeof window !== 'undefined') {
      captureEntry()
      window.history.back()
      return
    }
    const parent = parentRoute(routeRef.current.top, routeRef.current.sub)
    if (parent) {
      navigate({ top: parent.top as TopRoute, sub: parent.sub }, { replace: true })
    }
  }, [navigate, captureEntry])

  // 批次页“返回治理事件”受限来源（仅在 data 子页且 URL 带 from=governance 时存在；直接深链为空）。
  const govOrigin =
    route.top === 'history' && route.sub === 'data' && route.from === 'governance'
      ? {
          sourceId: route.fromSourceId,
          eventId: route.fromEventId,
          type: route.fromType,
          severity: route.fromSeverity,
          offset: route.fromOffset,
        }
      : null

  // 返回治理事件：优先走 sessionNav 直接父条目（保留已存滚动/焦点）；刷新后父条目不在则按受限来源重建。
  const returnToGovernance = useCallback(() => {
    const store = navStoreRef.current
    const curId = currentEntryIdRef.current
    const parentId = backTargetId(store, curId)
    const parentRec = parentId ? getEntry(store, parentId) : null
    if (parentRec && isGovernanceHash(parentRec.canonicalHash)) {
      goBack()
      return
    }
    const r = routeRef.current
    navigate({
      top: 'events',
      sub: 'governance',
      sourceId: r.fromSourceId,
      eventType: r.fromType,
      eventSeverity: r.fromSeverity,
      eventOffset: r.fromOffset,
      eventId: r.fromEventId,
    })
  }, [navigate, goBack])

  // 完整身份变化才清理由草稿；挂载时不误清（draftKeyRef 初始为当前身份）。
  const draftKeyRef = useRef(runIdentity)
  useEffect(() => {
    if (draftKeyRef.current !== runIdentity) {
      draftKeyRef.current = runIdentity
      setReviewDraft('')
      // 场景/代次变化：废弃旧 QA 视图与序幕设备视图，避免跨场景误恢复。
      setQaView(null)
      setPrologueView(null)
      setAgentView(null)
    }
  }, [runIdentity])

  const activeClock = workspace === 'history' ? historyClock : scheduleClock
  const themeOptions: { id: ThemePreference; label: string }[] = [
    { id: 'light', label: '浅色' },
    { id: 'dark', label: '深色' },
    { id: 'system', label: '跟随系统' },
  ]

  const auditRef = useRef<AuditEvent[]>(auditEvents)
  const recordAudit = (partial: Parameters<typeof makeAuditEvent>[1]): AuditEvent => {
    const event = makeAuditEvent(auditRef.current, partial)
    auditRef.current = [...auditRef.current, event]
    setAuditEvents(auditRef.current)
    return event
  }

  const jumpToEvidence = (target: EvidenceWorkspace, anchor: string, originId?: string) => {
    const top: TopRoute = target === 'history' ? 'history' : target === 'events' ? 'events' : 'schedule'
    navigate({ top, sub: target === 'schedule' ? 'evidence' : undefined }, { forceEntry: true, originId })

    setFocus({ workspace: target, target: anchor, nonce: Date.now() })
    // M23 B r06 · 到达证据后**真实选中对象**（不只 toast）：unit:<id> → 对象上下文联动 + 关系图选中 device 节点。
    if (anchor.startsWith('unit:')) {
      const id = anchor.slice('unit:'.length)
      setLinkedUnitId(id)
      setEvidenceSelected(`device:${id}`)
      // 旧筛选可能隐去该对象：调整可见筛选为 all；先保存原筛选，离开证据页再恢复。
      setEvidenceFilter('all')
      // 目录查询/筛选若隐去该对象，`data-evidence="unit:<id>"` 不在 DOM → 聚焦静默失败；复位目录到 all 才能真实可见聚焦。
      setDirectoryState({ query: '', filter: 'all' })
    } else if (anchor.startsWith('bucket:')) {
      setEvidenceSelected(null)
    }
  }

  // 事件定位：按事件自身来源映射到对应时轴，锁时并跳转到对应页面与证据。
  // 不允许跨来源猜测：调度事件用调度时钟，回放事件用回放时钟。
  const locateEvent = (locate: EventLocate) => {
    if (locate.kind === 'schedule') {
      scheduleClock.lockIndex(locate.index)
      navigate({ top: 'schedule', sub: 'evidence', source: 'schedule', t: locate.index })
      setFocus({
        workspace: 'schedule',
        target: `period:${locate.index}`,
        nonce: Date.now(),
      })
      return
    }
    historyClock.lockIndex(locate.index)
    navigate({ top: 'history', sub: 'trend', source: 'history', t: locate.index })
    setFocus({
      workspace: 'history',
      target: `bucket:${locate.machineId}:${locate.index}`,
      nonce: Date.now(),
    })
  }

  const commands = useMemo<CommandItem[]>(() => {
    const deviceItems: CommandItem[] = UNITS.map((u) => ({
      id: `device-${u.id}`,
      group: '设备',
      label: `设备 ${u.id}（${u.name}）`,
      hint: '跳到合成调度的设备证据',
      keywords: `${u.id} ${u.name} 设备 unit`,
      run: () => jumpToEvidence('schedule', `unit:${u.id}`),
    }))

    const eventItems: CommandItem[] = timeline.map((e) => ({
      id: `event-${e.id}`,
      group: '事件',
      label: e.title,
      hint: `${e.category} · ${e.status} · ${e.locate ? '可定位' : '未关联时轴'}`,
      keywords: `${e.id} ${e.category} ${e.status} 事件 ${e.reason}`,
      run: () => {
        navigate({ top: 'events' })
        if (e.locate) locateEvent(e.locate)
      },
    }))

    const evidenceItems: CommandItem[] = [
      {
        id: 'ev-scenario',
        group: '证据',
        label: '场景与需求证据',
        hint: '跳到合成调度的场景证据',
        keywords: 'scenario 场景 需求 证据',
        run: () => jumpToEvidence('schedule', 'scenario'),
      },
      {
        id: 'ev-safety',
        group: '证据',
        label: '调度安全审查结论',
        hint: '跳到事件与决策的安全证据',
        keywords: 'safety verdict 安全 审核 证据',
        run: () => jumpToEvidence('events', 'safety-verdict'),
      },
      {
        id: 'ev-history',
        group: '证据',
        label: '回放核查结论',
        hint: '跳到事件与决策的回放证据',
        keywords: 'history verdict 回放 核查 证据',
        run: () => jumpToEvidence('events', 'history-verdict'),
      },
      ...scheduleChain.roles.map<CommandItem>((r) => ({
        id: `ev-role-${r.id}`,
        group: '证据',
        label: `角色 ${r.id}`,
        hint: '跳到合成调度的角色证据',
        keywords: `${r.id} role 角色 证据`,
        run: () => jumpToEvidence('events', `role:${r.id}`),
      })),
      ...HISTORY_MACHINES.map<CommandItem>((m) => ({
        id: `ev-machine-${m.id}`,
        group: '证据',
        label: `回放机组 ${m.id}`,
        hint: '跳到回放实验台',
        keywords: `${m.id} machine 机组 回放`,
        run: () => {
          navigate({ top: 'history', sub: 'trend' })
          setFocus({
            workspace: 'history',
            target: `bucket:${m.id}:0`,
            nonce: Date.now(),
          })
        },
      })),
    ]

    const themeItems: CommandItem[] = themeOptions.map((t) => ({
      id: `theme-${t.id}`,
      group: '主题',
      label: `主题：${t.label}`,
      hint: '切换显示主题',
      keywords: `theme ${t.id} ${t.label} 主题`,
      run: () => setThemePref(t.id),
    }))

    const transportItems: CommandItem[] = [
      {
        id: 'transport-toggle',
        group: '播放',
        label: activeClock.state.playing ? '暂停当前来源运输' : '播放当前来源运输',
        hint: workspace === 'history' ? '合成回放夹具运输' : '合成调度运输',
        keywords: 'play pause 播放 暂停 运输',
        run: () => activeClock.toggle(),
      },
    ]

    return [...deviceItems, ...eventItems, ...evidenceItems, ...themeItems, ...transportItems]
  }, [timeline, scheduleChain, activeClock, workspace, jumpToEvidence, locateEvent])

  // M10：命令面板仅新增“当前已加载范围”的真实批次/治理事件（typed 定位到子页），
  // 不冒充全库搜索；未加载/未配置时不产生条目。
  const consoleSnap = useSyncExternalStore(consoleDataBus.subscribe, consoleDataBus.get, consoleDataBus.get)
  const loadedCommands: CommandItem[] = useMemo(() => {
    if (!consoleSnap || consoleSnap.status !== 'ready') return []
    const out: CommandItem[] = []
    for (const b of consoleSnap.batches.slice(0, 8)) {
      out.push({
        id: `loaded-batch-${b.id}`, group: '证据',
        label: `已加载批次 · ${b.sourceId}`,
        hint: `有效 ${b.validRows} / 隔离 ${b.isolatedRows} / 拒绝 ${b.rejectedRows}（打开数据接入）`,
        keywords: `batch 批次 ${b.sourceId} ${b.id} 已加载`,
        run: () => navigate({ top: 'history', sub: 'data', batchId: b.id }),
      })
    }
    for (const e of consoleSnap.events.slice(0, 8)) {
      out.push({
        id: `loaded-event-${e.eventId}`, group: '事件',
        label: `已加载事件 · ${e.type}`,
        hint: `${e.sourceId ?? '—'}（打开治理事件）`,
        keywords: `event 事件 ${e.type} ${e.sourceId ?? ''} 已加载`,
        run: () => navigate({ top: 'events', sub: 'governance', eventId: e.eventId }),
      })
    }
    return out
  }, [consoleSnap, navigate])

  const addDecision = (
    action: 'approve' | 'reject',
    reason: string,
    expectedRunIdentity?: string,
  ): DecisionOutcome => {
    // 提交端快照核验：过期 / 缺失的确认快照一律 fail-closed，不写入、不记审计。
    const snapshot = checkSubmitSnapshot(expectedRunIdentity, runIdentityRef.current)
    if (!snapshot.ok) {
      return {
        action,
        reason,
        decisionId: null,
        auditId: '',
        written: false,
        stale: true,
        blockReason: snapshot.reason,
      }
    }
    // 被阻断的批准尝试：只留阻断审计，decisionId 为 null，绝不作为成功批准的证据。
    if (action === 'approve' && scheduleChain.safety.verdict !== 'allow') {
      const blockReason = scheduleChain.safety.reasons[0] ?? '不满足批准条件'
      const event = recordAudit({
        kind: 'approve',
        scenario,
        sourceIds: ['synthetic_schedule'],
        sourceScope: 'schedule',
        inputSummary: `尝试批准「${currentScenarioLabel}」建议`,
        conclusion: `业务侧阻断批准：${blockReason}`,
        evidenceIds: ['safety-verdict', 'role:duty_engineer'],
        operatorAction: '批准请求被安全审查阻断，未写入决策记录',
        beforePlanSummary: planSummary(run.baseline),
        rejectionReason: reason,
        decisionId: null,
      })
      return {
        action,
        reason,
        decisionId: null,
        auditId: event.id,
        written: false,
        blockReason,
      }
    }

    // 重复点击防护：同一上下文已存在同动作的有效处置时，不生成第二条。
    const existing = resolveEffectiveDecision(
      decisionsRef.current,
      auditRef.current,
      approvalContext,
    )
    if (existing.status === 'effective' && existing.decision?.action === action) {
      return {
        action,
        reason,
        decisionId: existing.decision.id,
        auditId: existing.auditEvent?.id ?? '',
        written: false,
        blockReason: '同一上下文已存在相同动作的有效处置，未重复写入。',
      }
    }

    const baseId = `${scenario}-${run.series.seed}-${Date.now()}`
    let decisionId = baseId
    let suffix = 1
    while (decisionsRef.current.some((d) => d.id === decisionId)) {
      decisionId = `${baseId}-${suffix}`
      suffix += 1
    }
    const event = recordAudit({
      kind: action,
      scenario,
      sourceIds: ['synthetic_schedule'],
      sourceScope: 'schedule',
      inputSummary: `对「${currentScenarioLabel}」建议执行${action === 'approve' ? '批准' : '驳回'}`,
      conclusion: reason,
      evidenceIds: ['safety-verdict', 'role:duty_engineer'],
      operatorAction: action === 'approve' ? '人工批准（仅演示状态）' : '人工驳回',
      beforePlanSummary: planSummary(run.baseline),
      afterPlanSummary: planSummary(run.recommendation),
      rejectionReason: action === 'reject' ? reason : undefined,
      decisionId,
    })
    const decision: ApprovalDecision = {
      id: decisionId,
      scenario,
      action,
      reason,
      createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      createdAtIso: new Date().toISOString(),
      synthetic: true,
      sourceId: 'synthetic_schedule',
      runRef: approvalContext.runRef,
      candidateRef: run.evaluation.candidates.map((u) => u.id).join('+') || 'none',
      ruleVersion: RULE_VERSION,
      planSignature: approvalContext.planSignature,
      planFeasible: scheduleChain.safety.checks.recommendationFeasible,
      auditId: event.id,
    }
    const next = [decision, ...decisionsRef.current].slice(0, 50)
    decisionsRef.current = next
    setDecisions(next)
    return {
      action,
      reason,
      decisionId: decision.id,
      auditId: event.id,
      written: true,
    }
  }

  const handleRecompute = (s: ScenarioId) => {
    setRecomputeNonce((n) => n + 1)
    recordAudit({
      kind: 'recompute',
      scenario: s,
      sourceIds: ['synthetic_schedule'],
      sourceScope: 'schedule',
      inputSummary: `重算场景「${SCENARIOS.find((x) => x.id === s)?.label ?? s}」`,
      conclusion: `固定种子 ${run.series.seed} 下重算，结果可复现。`,
      evidenceIds: ['role:dispatcher'],
      operatorAction: '重新运行合成调度',
    })
  }

  const scenarioDecisions = decisions.filter((d) => d.scenario === scenario)

  const changeMode = (m: 'legacy' | 'lab') => {
    setMode(m)
    navigate({ top: route.top, sub: route.sub, mode: m })
  }
  const changeLabFixture = (id: LabFixtureId) => {
    setLabFixture(id)
    navigate({ top: route.top, sub: route.sub, lab: id })
  }
  const changeLabPreference = (p: LabPreference) => {
    setLabPreference(p)
    navigate({ top: route.top, sub: route.sub, pref: p })
  }
  const changeScenario = (s: ScenarioId) => {
    setScenario(s)
    navigate({
      top: 'schedule',
      sub: route.top === 'schedule' ? route.sub : ROUTE_SPEC.schedule[0],
      scenario: s,
    })
  }
  const onNavChange = (id: WorkspaceId) => {
    const top: TopRoute = id === 'assistant' ? 'records' : id
    navigate({ top })
  }
  // 欢迎页一击进入正常合成调度总览（一次真实导航）：不注册、不自动生成/批准/执行、不清记录。
  const enterDemo = () => {
    welcomeReturningRef.current = false
    setEntryView('business')
    navigate({ top: 'schedule', sub: ROUTE_SPEC.schedule[0] })
  }
  const navigateToCapability = (hash: string) => {
    const target = parseHash(hash)
    if (!target.valid) return
    welcomeReturningRef.current = false
    setEntryView('business')
    navigate({ top: target.top, sub: target.sub, mode: target.mode, scenario: target.scenario })
  }
  // 显式返回与浏览器Back共用唯一entry。
  const goBackWithReturn = goBack
  // M29 r30 · 目的页返回本次来源：仅当直接父 entry 来自 agent/map（真实有据父，不造假返回）。
  const parentEntryRec = getEntry(navStoreRef.current, backTargetId(navStoreRef.current, currentEntryIdRef.current))
  const parentHash = parentEntryRec?.canonicalHash ?? ''
  const sourceReturnLabel = parentHash.includes('/agent/') ? '智能体会话' : parentHash.includes('/map/') ? '关系MAP' : null

  const parentEntry = getEntry(navStoreRef.current, backTargetId(navStoreRef.current, currentEntryIdRef.current))
  const hasKpiSource = parentEntry?.context?.focusId?.startsWith('kpi-basis-') === true
  const subs = ROUTE_SPEC[route.top]

  // M10：离线功能子页不用合成回放时轴/播放器声明。
  const offlineSub =
    (workspace === 'history' && route.sub === 'data') ||
    (workspace === 'events' && route.sub === 'governance')

  // D11 adapter：宿主字段 → W1 环境绑定（纯函数；时钟由宿主注入）。
  const envBinding = resolveEnvironment({
    environmentPosition: appearance.environmentPosition,
    appearanceMode: appearance.appearanceMode,
    followLocalTime: appearance.followLocalTime,
    themeResolved: resolvedTheme,
  })
  const scenePosition = envBinding.scenePosition
  // B5：glassIntensity → 六锚点连续材质，按表面角色采样（hero/button/overlay/card/data）。
  const glassPct = Math.round(glassIntensity * 100)
  const gCard = sampleGlass(glassIntensity, 'card')
  const gBtn = sampleGlass(glassIntensity, 'button')
  const gOverlay = sampleGlass(glassIntensity, 'overlay')
  const gData = sampleGlass(glassIntensity, 'data')
  const appearanceVars = {
    '--cg-blur': `${gCard.blur}px`,
    '--cg-fill-a': String(gCard.fillAlpha),
    '--cg-edge': String(gCard.edge),
    '--cg-gloss': String(gCard.gloss),
    '--cg-shadow': String(gCard.shadow),
    '--cg-btn-blur': `${gBtn.blur}px`,
    '--cg-btn-fill-a': String(gBtn.fillAlpha),
    '--cg-overlay-blur': `${gOverlay.blur}px`,
    '--cg-overlay-fill-a': String(gOverlay.fillAlpha),
    '--cg-data-blur': `${gData.blur}px`,
    '--cg-data-fill-a': String(gData.fillAlpha),
    // 兼容既有 liquid-glass token（面板=card）
    '--qh-glass-blur': `${gCard.blur}px`,
    '--qh-glass-sat': '140%',
    '--qh-glass-fill': String(gCard.fillAlpha),
    '--qh-glass-btn-fill': String(gBtn.fillAlpha),
    '--qh-glass-edge': String(gCard.edge),
    '--qh-glass-gloss': String(gCard.gloss),
    '--qh-glass-shadow': String(gCard.shadow),
  } as React.CSSProperties

  // M22 r07 · 将外观/材质（连续 g）变量同步到 documentElement：
  // createPortal 的模态（OriginDialog/.u-dialog/.topbar-modal）脱离 .appearance-host，
  // 仅靠根变量才能继承同一主题 + 连续 g，避免回退到固定 62%/14px。主题 token 本就在 :root。
  useEffect(() => {
    const el = document.documentElement
    for (const [k, v] of Object.entries(appearanceVars)) el.style.setProperty(k, String(v))
    el.dataset.glass = String(glassPct)
    return () => { delete el.dataset.glass }
  }, [glassIntensity])

  // 统一登录/注册模态（欢迎页与控制台账号入口共用；未接入鉴权，游客不被挡路）。
  const authDialog = (
    <OriginDialog
      open={authOpen}
      onClose={() => setAuthOpen(false)}
      originRef={authOriginRef}
      initialFocusRef={authEmailRef}
      title="登录或注册（设计原型）"
      note="评审游客可直接进入工作区，不被此入口挡路（提交口径见表单说明）"
    >
      <AuthForm emailRef={authEmailRef} />
    </OriginDialog>
  )

  if (entryView === 'welcome') {
    return (
      <div className="appearance-host appearance-welcome-host scene-surface" style={appearanceVars} data-glass={String(glassPct)}>
        <SceneBackdrop visualPosition={scenePosition} />
        <WelcomePage
          onEnter={enterDemo}
          onAuth={(el) => {
            authOriginRef.current = el
            setAuthOpen(true)
          }}
          returning={welcomeReturningRef.current}
          scenePosition={scenePosition}
          onNavigate={navigateToCapability}
          onOpenDemo={(typeId, originId) => { setDemoTarget(typeId); setEntryView("business"); navigate({top:"device", sub:"units"}, {originId}) }}
          hostObservation={{ source: 'schedule', label: scheduleClock.observationLabel }}
          initialDeviceView={prologueView}
          onDeviceViewChange={(v) => setPrologueView({ ...v, runIdentity: runIdentityRef.current })}
          hostPlayback={{
            source: 'schedule',
            sourceLabel: '合成调度示例',
            stepMinutes: run.series.stepMinutes,
            labels: run.series.points.map((p) => p.label),
            demand: run.series.points.map((p) => p.demand),
            supply: run.recommendation.periods.map((p) => p.supply),
            power: run.recommendation.periods.map((p) => p.powerKw),
            energy: run.recommendation.periods.map((p) => p.energyKwh),
            unitDemand: 'm³/min',
            unitPower: 'kW',
            window: `${run.series.points[0]?.label ?? '—'}–${run.series.points[run.series.points.length - 1]?.label ?? '—'}`,
            index: scheduleClock.effectiveIndex,
            playing: scheduleClock.state.playing,
            speed: scheduleClock.state.speed,
            onToggle: () => { if (!scheduleClock.state.playing) scheduleClock.follow(); scheduleClock.toggle() },
            onSeek: (i) => scheduleClock.lockIndex(i),
            onStep: (d) => scheduleClock.step(d),
            onSpeed: (sp) => scheduleClock.setSpeed(sp),
            looping: scheduleClock.looping,
            onLoopChange: (v) => scheduleClock.setLooping(v),
            units: run.evaluation.eligibility.map((e) => ({ id: e.unitId, eligible: e.eligible, reason: e.reason })),
            loadsAt: (i) => run.recommendation.periods[i]?.unitLoads ?? {},
            loadRatiosAt: (i) => run.recommendation.periods[i]?.unitLoadRatios ?? {},
          }}
        />
        <div className="welcome-notes">
          <NotesBar sceneLabel="序幕" context="synthetic" />
        </div>
        <AppearanceDock
          environmentPosition={scenePosition}
          onEnvironmentPositionChange={setScenePosition}
          glassIntensity={glassIntensity}
          onGlassIntensityChange={setGlassIntensity}
          appearanceMode={appearanceMode}
          onAppearanceModeChange={setAppearanceMode}
          followLocalTime={followRealTime}
          onFollowLocalTimeChange={setFollowRealTime}
          onReset={resetAppearance}
          materialVars={appearanceVars}
          triggerHidden
        />
        {authDialog}
      </div>
    )
  }

  return (
    <div
      className="app-shell appearance-host scene-surface"
      data-glass={String(glassPct)}

      style={{ ...appearanceVars, '--rail-w': '132px' } as React.CSSProperties}
    >
      <SceneBackdrop visualPosition={scenePosition} />
      {railOpen ? (
        <button type="button" className="rail-scrim" aria-hidden="true" tabIndex={-1} onClick={closeRailToTrigger} />
      ) : null}
      <aside
        ref={railAsideRef}
        className="app-rail"
        data-open={railOpen ? '1' : '0'}
        role={railOpen && railIsDrawer ? 'dialog' : undefined}
        aria-modal={railOpen && railIsDrawer ? true : undefined}
        aria-label={railOpen && railIsDrawer ? '导航抽屉' : undefined}
        onKeyDown={onRailKeyDown}
      >
        <button
          type="button"
          className="rail-close"
          aria-label="关闭导航"
          onClick={closeRailToTrigger}
        >
          ✕
        </button>
        <div className="rail-brand" aria-hidden="true">
          气衡
        </div>
        <AppNav value={workspace} onChange={onNavChange} />
        <div className="rail-foot">
          {/* M2/M28：业务壳返回“序幕”入口（键盘可达，走现有 #/welcome 合同） */}
          <a className="rail-welcome-link" href="#/welcome" aria-label="返回序幕（开场前言）">
            ← 返回序幕
          </a>
          <AppearanceDock
            environmentPosition={scenePosition}
            onEnvironmentPositionChange={setScenePosition}
            glassIntensity={glassIntensity}
            onGlassIntensityChange={setGlassIntensity}
            appearanceMode={appearanceMode}
            onAppearanceModeChange={setAppearanceMode}
            followLocalTime={followRealTime}
            onFollowLocalTimeChange={setFollowRealTime}
            onReset={resetAppearance}
            materialVars={appearanceVars}
          />
        </div>
      </aside>

      <div className="app-body" ref={bodyRef}>
        <header className="app-topbar u-pm u-pm-glass" data-topbar-open={topbarOpen ? '1' : '0'}>
          <button
            type="button"
            ref={railTriggerRef}
            className="rail-burger"
            aria-label={railOpen ? '关闭导航' : '打开导航'}
            aria-expanded={railOpen}
            onClick={() => setRailOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          <div className="topbar-title">
            <h1 data-page-title tabIndex={-1}>
              {TOP_LABEL[route.top]}
              <span className="topbar-crumb"> · {SUB_LABEL[route.top][route.sub]}</span>
              <NoteRef note={offlineSub ? 'offline' : 'synthetic'} />
            </h1>
          </div>
          <button
            type="button"
            className="topbar-more"
            aria-label={topbarOpen ? '收起状态与操作' : '展开状态与操作'}
            aria-expanded={topbarOpen}
            onClick={() => setTopbarOpen((v) => !v)}
          >
            {topbarOpen ? '收起' : '更多'}
          </button>
          <span className="topbar-badge-slot"><ConnectionBadge /></span>
          <div className="topbar-actions">
            <button
              type="button"
              ref={searchTriggerRef}
              className="btn topbar-search"
              data-qh-focus-fallback
              onClick={() => {
                commandOriginRef.current = searchTriggerRef.current
                setCommandOpen(true)
              }}
              aria-haspopup="dialog"
            >
              搜索 <kbd className="cmd-kbd">Ctrl K</kbd>
            </button>
            <Popover
              label="消息"
              title="消息"
              renderContent={(close) => (
                <MessagesPopover
                  onGovernance={(eventId) => {
                    navigate({ top: 'events', sub: 'governance', eventId })
                    close()
                  }}
                />
              )}
            />
            <span className="sr-only"><ConnectionState /></span>
            <Clock />
            <button
              type="button"
              className="btn topbar-account"
              aria-haspopup="dialog"
              title="登录 / 注册（设计原型，未接入鉴权）"
              onClick={(e) => {
                authOriginRef.current = e.currentTarget
                setAuthOpen(true)
              }}
            >
              游客 / 账号
            </button>
          </div>
        </header>

        <nav className="sub-nav" aria-label={`${TOP_LABEL[route.top]}子页`}>
          {subs.map((sub) => (
            <button
              type="button"
              key={sub}
              id={`subnav-${sub}`}
              data-action={`nav-${sub}`}
              className={`sub-nav-item${sub === route.sub ? ' active' : ''}`}
              aria-current={sub === route.sub ? 'page' : undefined}
              onClick={() => navigate({ top: route.top, sub })}
            >
              {SUB_LABEL[route.top][sub]}
            </button>
          ))}
        </nav>

        <main className="app-content">
          {hasKpiSource && route.top !== 'schedule' ? <div className="decision-actions"><button id="kpi-return-source" type="button" className="btn-secondary" onClick={goBack}>返回指标来源</button></div> : null}
          <p className="sr-only" aria-live="polite">
            {focus ? `已跳转到证据 ${focus.target}` : ''}
          </p>

          {!route.valid && route.reason ? (
            <p className="store-banner warn" role="status">
              {route.reason}
            </p>
          ) : null}
          {routeNotice ? (
            <p className="store-banner warn" role="status">
              {routeNotice}
            </p>
          ) : null}
          {locateNotice ? (
            <p className="store-banner warn" role="status">
              {locateNotice}
            </p>
          ) : null}

          {storeError ? (
            <p className="store-banner bad" role="status">
              {storeError}
            </p>
          ) : null}
          {storeNotice ? (
            <p className="store-banner warn" role="status">
              {storeNotice}
            </p>
          ) : null}

          {workspace === 'schedule' ? (
            <SchedulingWorkspace
              directoryState={directoryState}
              onDirectoryChange={setDirectoryState}
              onOpenEvidenceUnit={(id) => jumpToEvidence('schedule', `unit:${id}`)}
              onOpenRecords={() => navigate({ top: 'records', sub: 'audit' })}
              onOpenKpiDestination={(t) => {
                // 保本人当前 mode/scenario（不强制 normal）：device → 真实对象定位；route → 真实子路由。
                if (t.type === 'device') jumpToEvidence('schedule', `unit:${t.id}`, t.originId ?? t.entryId)
                else navigate({ top: t.top, sub: t.sub, mode: routeRef.current.mode, scenario: routeRef.current.scenario }, { forceEntry: true, originId: t.originId ?? t.entryId })

              }}
              scenario={scenario}
              onScenarioChange={changeScenario}
              run={run}
              scenarioLabel={currentScenarioLabel}
              runIdentity={runIdentity}
              mode={mode}
              labFixture={labFixture}
              labPreference={labPreference}
              onModeChange={changeMode}
              onLabFixtureChange={changeLabFixture}
              onLabPreferenceChange={changeLabPreference}
              subroute={route.sub}
              effectiveDecision={effectiveDecision}
              onNavigateSub={(sub) => navigate({ top: 'schedule', sub })}
              onBack={goBackWithReturn}
              reviewDraft={reviewDraft}
              onReviewDraftChange={setReviewDraft}
              linkedUnitId={linkedUnitId}
              onLinkedUnitChange={setLinkedUnitId}
              decisions={scenarioDecisions}
              onDecision={addDecision}
              focus={focus}
              onRecompute={handleRecompute}
              recomputeNonce={recomputeNonce}
              clock={scheduleClock}
              onOpenBatch={(batchId) => navigate({ top: 'history', sub: 'data', batchId })}
              onOpenEvent={(eventId) => navigate({ top: 'events', sub: 'governance', eventId })}
              onOpenSource={(sourceId) => navigate({ top: 'events', sub: 'governance', sourceId })}
              evidenceFilter={evidenceFilter}
              evidenceSelected={evidenceSelected}
              evidenceDepth={evidenceDepth}
              onEvidenceDepthChange={setEvidenceDepth}
              onEvidenceFilterChange={setEvidenceFilter}
              onEvidenceSelect={setEvidenceSelected}
            />
          ) : null}

          {workspace === 'history' ? (
            route.sub === 'data' ? (
              <DataIngressWorkspace
                initialBatchId={route.batchId}
                governanceOrigin={govOrigin}
                onLocate={(batchId) => navigate({ top: 'history', sub: 'data', batchId })}
                onImported={() => consoleDataBus.requestRefresh()}
                onOpenEvents={(sourceId) => navigate({ top: 'events', sub: 'governance', sourceId })}
                onReturnToGovernance={returnToGovernance}
              />
            ) : (
              <HistoryLabWorkspace
                originWindow={parentHash.includes("/agent/") ? agentWindowProvenance(parentEntryRec?.context?.agentView, runIdentity) : undefined}
                fixtureId={fixtureId}
                onFixtureChange={setFixtureId}
                focus={focus}
                clock={historyClock}
                returnSourceLabel={sourceReturnLabel ?? undefined}
                onReturnToSource={sourceReturnLabel ? goBackWithReturn : undefined}
              />
            )
          ) : null}

          {workspace === 'events' ? (
            route.sub === 'governance' ? (
              <GovernanceWorkspace
                query={{ sourceId: route.sourceId, type: route.eventType, severity: route.eventSeverity, offset: route.eventOffset }}
                initialEventId={route.eventId}
                onQueryChange={(q) => navigate({ top: 'events', sub: 'governance', ...mapGovernanceQuery(q), eventId: null })}
                onLocate={(eventId) => navigate({ top: 'events', sub: 'governance', eventId })}
                onOpenBatch={(batchId) => navigate({
                  top: 'history', sub: 'data', batchId,
                  from: 'governance',
                  fromSourceId: route.sourceId,
                  fromEventId: route.eventId,
                  fromType: route.eventType,
                  fromSeverity: route.eventSeverity,
                  fromOffset: route.eventOffset,
                })}
              />
            ) : (
            <EventsWorkspace
              scenario={scenario}
              onScenarioChange={changeScenario}
              run={run}
              runIdentity={runIdentity}
              scenarioLabel={currentScenarioLabel}
              fixtureId={fixtureId}
              onFixtureChange={setFixtureId}
              decisions={decisions}
              onDecision={addDecision}
              effectiveDecision={effectiveDecision}
              reviewDraft={reviewDraft}
              onReviewDraftChange={setReviewDraft}
              focus={focus}
              observationLabel={scheduleClock.observationLabel}
              onLocate={locateEvent}
            />
            )
          ) : null}

          {workspace === 'device' ? (
            <DeviceWorkspace
              demoTarget={demoTarget}
              onDemoTargetHandled={() => setDemoTarget(null)}
              units={run.allUnits}
              eligibility={run.evaluation.eligibility}
              onOpenEvidence={(id) => jumpToEvidence('schedule', `unit:${id}`)}
              onOpenMap={() => navigate({ top: 'map', sub: 'topology' })}
              clockLabel={scheduleClock.observationLabel}
              onInspectDemo={(typeId, st) => {
                // 演示库卡片「类型资料 ↗」→ 序幕设备详情：带准确类型/演示状态返回，同一 runIdentity 才有效。
                setPrologueView({ deviceId: typeId, demoState: st, runIdentity: runIdentityRef.current })
                window.location.hash = WELCOME_HASH
              }}
            />
          ) : null}

          {workspace === 'map' ? (
            <MapWorkspace
              run={run}
              scenario={scenario}
              scenarioLabel={currentScenarioLabel}
              view={mapView}
              onViewChange={setMapView}
              observationIndex={scheduleClock.effectiveIndex}
              observationLabel={scheduleClock.observationLabel}
              playbackSlot={(
                <div className="toolbar" role="group" aria-label="观察时钟（同一来源）">
                  <button type="button" className="btn" onClick={() => { if (!scheduleClock.state.playing) scheduleClock.follow(); scheduleClock.toggle() }}>{scheduleClock.state.playing ? '暂停' : '播放并跟随'}</button>
                  <button type="button" className="btn ghost" aria-label="上一时段" onClick={() => scheduleClock.step(-1)}>‹</button>
                  <button type="button" className="btn ghost" aria-label="下一时段" onClick={() => scheduleClock.step(1)}>›</button>
                  <span className="tag">同源时刻 {scheduleClock.observationLabel}</span>
                  <label className="hint"><input type="checkbox" checked={scheduleClock.looping} onChange={(e) => scheduleClock.setLooping(e.target.checked)} /> 循环</label>
                </div>
              )}
              filter={evidenceFilter}
              selected={evidenceSelected}
              depth={evidenceDepth}
              onFilterChange={setEvidenceFilter}
              onSelect={setEvidenceSelected}
              onDepthChange={setEvidenceDepth}
              onOpenDevice={(id) => jumpToEvidence('schedule', `unit:${id}`)}
              onOpenPassport={(pid, originId) => navigate({ top: 'records', sub: 'audit', passportId: pid }, { originId })}
              onOpenBatch={(batchId) => navigate({ top: 'history', sub: 'data', batchId })}
              onOpenEvent={(eventId) => navigate({ top: 'events', sub: 'governance', eventId })}
              onOpenSource={(sourceId) => navigate({ top: 'events', sub: 'governance', sourceId })}
            />
          ) : null}

          {workspace === 'agent' ? (
            <AgentWorkspace
              run={run}
              scenario={scenario}
              scenarioLabel={currentScenarioLabel}
              runIdentity={runIdentity}
              fixtureId={fixtureId}
              currentDecision={effectiveDecision.decision}
              decisionEventId={effectiveDecision.auditEvent?.id ?? null}
              observationIndex={scheduleClock.effectiveIndex}
              observationLabel={scheduleClock.observationLabel}
              historyFixture={fixture}
              historyStartMinute={HISTORY_START_MINUTE}
              historyBucketMinutes={fixture.bucketMinutes}
              historyObservationIndex={historyClock.effectiveIndex}
              historyObservationLabel={historyClock.observationLabel}
              initialAgentView={agentView}
              onAgentViewChange={(v) => setAgentView({ ...v, runIdentity: runIdentityRef.current })}
              onJump={jumpToEvidence}
              onOpenPassport={(pid, originId) => navigate({ top: 'records', sub: 'audit', passportId: pid }, { originId })}
              onBack={goBackWithReturn}
              onOpenWindow={(source, a, b, originId) => navigate({ top: source === 'synthetic_history' ? 'history' : 'schedule', sub: source === 'synthetic_history' ? 'trend' : 'evidence', source: source === 'synthetic_history' ? 'history' : 'schedule', t: a, a, b }, { originId })}
            />
          ) : null}

          {workspace === 'data' ? (
            <DataIngressWorkspace
              initialBatchId={route.batchId}
              governanceOrigin={govOrigin}
              onLocate={(batchId) => navigate({ top: 'data', sub: 'batches', batchId })}
              onImported={() => consoleDataBus.requestRefresh()}
              onOpenEvents={(sourceId) => navigate({ top: 'events', sub: 'governance', sourceId })}
              onReturnToGovernance={returnToGovernance}
            />
          ) : null}

          {workspace === 'assistant' ? (
            <AssistantWorkspace
              scenario={scenario}
              onScenarioChange={changeScenario}
              run={run}
              runIdentity={runIdentity}
              scenarioLabel={currentScenarioLabel}
              subroute={route.sub}
              fixtureId={fixtureId}
              onFixtureChange={setFixtureId}
              decisions={decisions}
              auditEvents={auditEvents}
              effectiveDecision={effectiveDecision}
              onAudit={recordAudit}
              onJump={jumpToEvidence}
              qaView={qaView}
              onQaViewChange={(v) => setQaView(v ? { input: v.input, answer: v.answer, runIdentity: runIdentityRef.current } : null)}
              passportId={route.passportId}
              returnSourceLabel={sourceReturnLabel ?? undefined}
              onReturnToSource={sourceReturnLabel ? goBackWithReturn : undefined}
              onOpenExecution={() => navigate({ top: 'schedule', sub: 'execution' })}
            />
          ) : null}
        </main>

        <footer className="app-footer">
          <NotesBar
            sceneLabel={offlineSub ? '离线批次 / 治理事件（只读，非实时）' : currentScenarioLabel}
            context={offlineSub ? 'offline' : 'synthetic'}
          />
        </footer>
      </div>

      <ConsoleTour routeKey={`${route.top}/${route.sub}`} onRailChange={setRailOpen} />
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        items={[...commands, ...loadedCommands]}
        originRef={commandOriginRef}
        fallbackFocusRef={searchTriggerRef}
      />
      {authDialog}
    </div>
  )
}