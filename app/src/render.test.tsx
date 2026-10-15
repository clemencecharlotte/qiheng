import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import App from './App'
import ContextRail from './components/ContextRail'
import { CommandSearchView } from './components/CommandPalette'
import HistoryLabWorkspace from './workspaces/HistoryLabWorkspace'
import EventsWorkspace from './workspaces/EventsWorkspace'
import SchedulingWorkspace from './workspaces/SchedulingWorkspace'
import AssistantWorkspace from './workspaces/AssistantWorkspace'
import WelcomePage from './components/WelcomePage'
import DecisionDetailPanel from './components/DecisionDetailPanel'
import { runScenario } from './domain/engine'
import { runScheduleChain } from './domain/chain'
import { verifyPlanConstraints } from './domain/constraints'
import { buildOverviewSnapshot, selectStagePlan } from './domain/overview'
import { FIXED_SEED, UNITS } from './domain/units'
import {
  initialExploreState,
  labelAt,
  type TimelineClock,
} from './domain/explore'
import type { ObservationClockApi } from './components/useObservationClock'
import type { EffectiveDecision } from './domain/approval'

const NO_DECISION: EffectiveDecision = {
  status: 'none',
  decision: null,
  auditEvent: null,
  reason: '当前场景暂无处置记录。',
}

function createClockApi(clock: TimelineClock): ObservationClockApi {
  const state = initialExploreState(clock, 0)
  const noop = () => {}
  return {
    clock,
    state,
    effectiveIndex: 0,
    locked: false,
    newBuckets: 0,
    observationLabel: labelAt(clock, 0),
    hoverIndex: null,
    range: null,
    setPlaying: noop,
    toggle: noop,
    setSpeed: noop,
    step: noop,
    lockIndex: noop,
    follow: noop,
    hover: noop,
    beginBrush: noop,
    moveBrush: noop,
    endBrush: () => ({ state, committedRange: null, lockedIndex: null }),
    cancelBrush: noop,
    setRange: noop,
    resetExplore: noop,
    looping: true,
    setLooping: noop,
  }
}

const SCHEDULE_CLOCK: TimelineClock = {
  sourceId: 'synthetic_schedule',
  stepMinutes: 15,
  count: 96,
  startMinute: 0,
}

const HISTORY_CLOCK: TimelineClock = {
  sourceId: 'synthetic_history',
  stepMinutes: 15,
  count: 16,
  startMinute: 8 * 60,
}

describe('页面渲染冒烟', () => {
  it('应用外壳与四个工作区入口可渲染', () => {
    const html = renderToString(<App />)
    expect(html).toContain('气衡')
    expect(html).toContain('调度')
    expect(html).toContain('事件')
    expect(html).toContain('回放证据')
    expect(html).toContain('记录')
    // 子页导航
    expect(html).toContain('总览')
    expect(html).toContain('方案比较')
    expect(html).toContain('关联证据')
  })

  it('V2 共享外壳含窄导航、顶栏、主题切换与总览舞台/上下文栏', () => {
    const html = renderToString(<App />)
    expect(html).toContain('app-shell')
    expect(html).toContain('app-rail')
    expect(html).toContain('app-topbar')
    // 默认外观：臻彩模式 + 跟随本地时间 + 玻璃 85%（入口浮层默认关闭）。
    expect(html).toContain('data-testid="appearance-open"')
    expect(html).toContain('随本地 ·')
    expect(html).toContain('数据来源')
    expect(html).toContain('观察时刻')
    expect(html).toContain('设备与供需舞台')
    expect(html).toContain('供需趋势')
    expect(html).toContain('对象上下文')
    expect(html).toContain('供气母管')
  })

  it('共享观察时钟：总览含播放/速度/锁时滑块/预设与共时趋势', () => {
    const html = renderToString(<App />)
    expect(html).toContain('观察时钟与趋势探查')
    expect(html).toContain('播放')
    expect(html).toContain('0.5×')
    expect(html).toContain('2×')
    expect(html).toContain('时间滑块')
    expect(html).toContain('全窗口')
    expect(html).toContain('最近一小时')
    expect(html).toContain('跟随播放')
    expect(html).toContain('来源：')
    // 观察时刻标签来自同源时钟（初始 12:00）
    expect(html).toContain('观察时刻')
    expect(html).toContain('12:00')
  })

  it('调度总览真正条件渲染：只保留总览，评测/逐桶移动到证据子页', () => {
    const html = renderToString(<App />)
    // 总览子页与下一动作
    expect(html).toContain('data-page="overview"')
    expect(html).toContain('当前结论与下一动作')
    expect(html).toContain('比较方案')
    // 四子页导航
    expect(html).toContain('复验人审')
    expect(html).toContain('关联证据')
    // 总览不再铺评测与逐桶表（条件渲染，非 CSS 隐藏）
    expect(html).not.toContain('同条件合成评测')
    // 不新建第五工作区
    expect(html).not.toContain('同条件评测工作区')
  })

  it('观察区间为默认收起的渐进展开入口，含起止与应用/清除', () => {
    const html = renderToString(<App />)
    expect(html).toContain('class="transport-range"')
    expect(html).toContain('观察区间')
    expect(html).toContain('应用区间')
    expect(html).toContain('清除区间')
    expect(html).toContain('清除观察')
    expect(html).not.toContain('清除探查')
  })

  it('趋势交互说明与来源详情折叠，不占首屏', () => {
    const html = renderToString(<App />)
    expect(html).toContain('交互说明')
    // M22 r04：来源详情改为统一 Popover（触发标签可见；完整内容在展开后）。
    expect(html).toContain('来源详情')
    expect(html).toContain('disc-pop-trigger')
  })

  it('ContextRail：锁定优先于 hover，hover 不覆盖固定详情', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED)
    const selection = selectStagePlan(run)
    const snapshot = buildOverviewSnapshot(run, selection.plan, selection.planType)
    const locked = renderToString(
      <ContextRail
        snapshot={snapshot}
        scenarioLabel="常态"
        linkedUnitId="AC-01"
        hoverUnitId="AC-02"
        onToggleLock={() => {}}
        onClearLock={() => {}}
      />,
    )
    expect(locked).toContain('1# 螺杆空压机')
    expect(locked).toContain('已锁定')
    expect(locked).not.toContain('临时预览（未锁定）')
    expect(locked).not.toContain('2# 螺杆空压机')

    const preview = renderToString(
      <ContextRail
        snapshot={snapshot}
        scenarioLabel="常态"
        linkedUnitId={null}
        hoverUnitId="AC-02"
        onToggleLock={() => {}}
        onClearLock={() => {}}
      />,
    )
    expect(preview).toContain('临时预览（未锁定）')
    expect(preview).toContain('2# 螺杆空压机')
  })

  it('历史回放实验台可渲染并标注只读来源', () => {
    const html = renderToString(
      <HistoryLabWorkspace
        fixtureId="fx_baseline"
        onFixtureChange={() => {}}
        clock={createClockApi(HISTORY_CLOCK)}
      />,
    )
    expect(html).toContain('合成回放夹具')
    expect(html).toContain('只读')
    expect(html).toContain('质量分级明细')
    expect(html).toContain('规则异常提示')
  })

  it('事件与决策工作区可渲染决策链与安全审查', () => {
    const surgeRun = runScenario('surge', UNITS, FIXED_SEED)
    const html = renderToString(
      <EventsWorkspace
        scenario="surge"
        onScenarioChange={() => {}}
        run={surgeRun}
        runIdentity="test-surge-identity"
        scenarioLabel="突增"
        fixtureId="fx_baseline"
        onFixtureChange={() => {}}
        decisions={[]}
        effectiveDecision={NO_DECISION}
        reviewDraft=""
        onReviewDraftChange={() => {}}
        onDecision={() => ({
          action: 'reject',
          reason: 'x',
          decisionId: null,
          auditId: 'evt-0001',
          written: false,
        })}
      />,
    )
    expect(html).toContain('决策链')
    expect(html).toContain('安全审查')
    expect(html).toContain('拒绝批准')
    expect(html).toContain('旧方案')
    // 两份来源状态独立呈现，不用单一全局 verdict 概括
    expect(html).toContain('合成调度来源 · 证据链')
    expect(html).toContain('合成回放来源 · 只读核查')
    expect(html).toContain('回放安全核查')
    expect(html).toContain('本回放统计被禁用')
  })

  it('问答与审计工作区可渲染问答、多角色与导出', () => {
    const html = renderToString(
      <AssistantWorkspace
        scenario="normal"
        onScenarioChange={() => {}}
        run={runScenario('normal', UNITS, FIXED_SEED)}
        runIdentity="test-normal-identity"
        scenarioLabel="常态"
        fixtureId="fx_baseline"
        onFixtureChange={() => {}}
        decisions={[]}
        auditEvents={[]}
        effectiveDecision={NO_DECISION}
        onAudit={() => {}}
        onJump={() => {}}
      />,
    )
    expect(html).toContain('可信问答')
    expect(html).toContain('多角色视图')
    expect(html).toContain('导出 JSON')
    // r42 收束：常驻 3 步演示面板已删；助手默认面 = 问答 + 一处连接状态 + 空态预设一次。
    expect(html).not.toContain('3 步演示')
    expect(html).toMatch(/模型未连接 · 确定性解释|模型润色可用/)
    expect(html).toContain('预设问题')
    expect(html).toContain('本地演示记录，非生产审计存证')
  })

  it('决策详情：不可批准时按钮禁用且常驻原因可读', () => {
    const run = runScenario('surge', UNITS, FIXED_SEED)
    const chain = runScheduleChain({ scenario: 'surge', scenarioLabel: '突增', run })
    const verification = verifyPlanConstraints(run.recommendation, run)
    const baselineVerification = verifyPlanConstraints(run.baseline, run)
    const html = renderToString(
      <DecisionDetailPanel
        scenario="surge"
        scenarioLabel="用气突增"
        run={run}
        scheduleChain={chain}
        verification={verification}
        baselineVerification={baselineVerification}
        approval={NO_DECISION}
        runIdentity="test-surge-identity"
        onSubmit={() => ({
          action: 'approve',
          reason: 'x',
          decisionId: null,
          auditId: 'evt-0001',
          written: false,
          blockReason: 'x',
        })}
      />,
    )
    expect(html).toContain('decision-disabled-reason')
    expect(html).toContain('不可批准原因（常驻可读）')
    expect(html).toContain('disabled')
    expect(html).toContain('aria-describedby="decision-disabled-reason"')
    expect(html).toContain('只记录「合成演示」状态')
  })

  it('调度四子页真正条件渲染（overview/compare/review/evidence）', () => {
    const run = runScenario('normal', UNITS, FIXED_SEED)
    const baseProps = {
      scenario: 'normal' as const,
      onScenarioChange: () => {},
      run,
      scenarioLabel: '常态',
      runIdentity: 'legacy:test',
      mode: 'legacy' as const,
      labFixture: 'capacity_rise' as const,
      labPreference: 'energy_first' as const,
      onModeChange: () => {},
      onLabFixtureChange: () => {},
      onLabPreferenceChange: () => {},
      effectiveDecision: NO_DECISION,
      onNavigateSub: () => {},
      onBack: () => {},
      reviewDraft: '',
      onReviewDraftChange: () => {},
      linkedUnitId: null,
      onLinkedUnitChange: () => {},
      decisions: [],
      onDecision: () => ({
        action: 'reject' as const,
        reason: 'x',
        decisionId: null,
        auditId: 'evt-0001',
        written: false,
      }),
      clock: createClockApi(SCHEDULE_CLOCK),
    }

    const overview = renderToString(<SchedulingWorkspace {...baseProps} subroute="overview" />)
    expect(overview).toContain('data-page="overview"')
    expect(overview).toContain('当前结论与下一动作')
    expect(overview).not.toContain('同条件合成评测')
    expect(overview).not.toContain('decision-form')

    const compare = renderToString(<SchedulingWorkspace {...baseProps} subroute="compare" />)
    expect(compare).toContain('data-page="compare"')
    expect(compare).toContain('下一步：复验人审')

    const review = renderToString(<SchedulingWorkspace {...baseProps} subroute="review" />)
    expect(review).toContain('data-page="review"')
    expect(review).toContain('安全审查')
    expect(review).toContain('决策详情')

    const evidence = renderToString(<SchedulingWorkspace {...baseProps} subroute="evidence" />)
    expect(evidence).toContain('data-page="evidence"')
    expect(evidence).toContain('同条件合成评测')
    expect(evidence).toContain('返回来源')
  })

  it('命令面板只提供定位/主题/播放，不提供审批命令', () => {
    const items = [
      { id: 'd1', group: '设备' as const, label: '设备 AC-01（1# 螺杆空压机）', hint: '跳到设备证据', keywords: 'AC-01', run: () => {} },
      { id: 't1', group: '主题' as const, label: '主题：深色', hint: '切换显示主题', keywords: 'dark', run: () => {} },
      { id: 'p1', group: '播放' as const, label: '播放当前来源运输', hint: '合成调度运输', keywords: 'play', run: () => {} },
    ]
    const html = renderToString(
      <CommandSearchView
        items={items}
        query=""
        active={0}
        onQuery={() => {}}
        onActive={() => {}}
        onRun={() => {}}
      />,
    )
    expect(html).toContain('命令搜索')
    expect(html).toContain('设备 AC-01')
    expect(html).toContain('主题：深色')
    expect(html).toContain('播放当前来源运输')
    expect(html).toContain('不能通过命令批准、驳回或执行设备')
    // 空态
    expect(renderToString(
      <CommandSearchView items={[]} query="zzz" active={0} onQuery={() => {}} onActive={() => {}} onRun={() => {}} />,
    )).toContain('没有匹配的命令')
  })
})

describe('B05a 欢迎页窄冒烟（SSR）', () => {
  it('渲染标题/副文/双CTA/header 注册登录/脚注角标（静态声明移出正文）', () => {
    const html = renderToString(<WelcomePage onEnter={() => {}} />)
    expect(html).toContain('每个调度方案，都先回答能不能用。')
    expect(html).toContain('看清输入来源，比较方案，独立复验，再由人确认。')
    expect(html).toContain('id="welcome-enter-demo"')
    // header 注册/登录（与 theme 同组），Hero 不再有第三按钮
    expect(html).toContain('id="welcome-auth"')
    expect(html).toContain('注册 / 登录')
    // 静态声明减噪：Hero 不再有长声明，正文以脚注角标交叉引用
    expect(html).not.toContain('仅合成执行，不连接生产设备')
    expect(html).toContain('data-qh-note-ref="qh-note-readonly"')
    expect(html).toContain('尚无决策护照')
    expect(html).toContain('生成并封存一次方案后')
  })
})
