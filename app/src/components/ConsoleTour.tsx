import { useEffect, useRef, useState } from 'react'
import { driver, type Driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import '../styles/console-tour.css'

/** r44 H · 按模块登记步骤表；单 Driver 实例；按 模块+版本 记忆完成状态。 */
const TOUR_V = 'v3'
const KEY = (mod: string) => `qiheng.tour.${TOUR_V}.${mod}`
function firstVisit(mod: string) {
  try { return localStorage.getItem(KEY(mod)) !== 'seen' } catch { return true }
}
function markSeen(mod: string) { try { localStorage.setItem(KEY(mod), 'seen') } catch { /* preference only */ } }

type Step = [selector: string, title: string, description: string]
const ROUTE_STEPS: Record<string, Step[]> = {
  welcome: [
    ['.qh-cta-row .btn.primary, .qh-hero .btn.primary', '进入评审演示', '游客通道直达控制台；评审无需登录。'],
    ['.qh-device-orbit-wrap', '设备机构舞台', '选择类型查看外观/原理与演示走带；暂停即冻结。'],
    ['#qh-proof', '决策护照成果', '来源、约束、复验与人审收进同一份封存记录。'],
    ['.app-footer-toggle, .qh-ftr', '说明随时可查', '背景与边界说明由你主动展开。'],
  ],
  'schedule/overview': [
    ['.ws-head, .app-topbar', '工作区页头', '标题、页签、搜索与全局操作合并为一个外壳。'],
    ['.console-decision-brief, .overview-main > section', '当前结论与下一动作', '状态、三事实与可执行动作；阻断原因就近可见。'],
    ['.transport-bar, .source-bar', '播放与观察桶', '跟随播放后设备、数值与图形同源同刻变化。'],
    ['.trend, .stage-panel', '趋势与舞台', '曲线/柱消费真实序列；null 断线不补零。'],
  ],
  'schedule/compare': [
    ['.plan-grid, .overview-main > section', '基线与建议对比', '同一输入窗口下的两类取舍并排可读。'],
    ['.table-wrap, .period-table', '比较表', '覆盖、能耗、切换与约束状态逐项对照。'],
  ],
  'schedule/review': [
    ['.workspace .panel', '复验人审', '核对约束与输入身份；批准由人显式执行。'],
    ['.workspace .btn.primary, .workspace button', '处置入口', '批准/驳回需理由；指引不会代你点击。'],
  ],
  device: [
    ['.workspace .panel', '设备目录与候选', '纳入候选/已排除与排除原因就近可见。'],
    ['.qh-demo-fleet', '设备演示库', '演示开关只改展示，不改变安全资格。'],
    ['.device-details-drawer, .workspace .link-btn', '设备详情与证据', '从对象进入参数与证据，返回保留原视角。'],
  ],
  map: [
    ['.qh-relations', '关系图', '设备—管网—数据—决策—护照可定位；点击对象查看依据。'],
    ['.qh-relations .toolbar, .map-workspace .toolbar, .workspace .qel-tabs', '筛选与邻域', '类型/邻域/视图切换；返回保原视角与选择。'],
    ['.workspace .qel-note-details, .workspace details', '来源与范围', '只读 API 与域内合成口径按需展开。'],
  ],
  agent: [
    ['.chat-main', '聊天是中心', '先提问；解释与调试信息默认不占主画面。'],
    ['.chat-ctx', '当前上下文', '来源/观察/快照状态以 chips 呈现，可展开。'],
    ['.chat-side', '工具与资料', '只读工具查询是真实调用（非LLM聊天），按需展开。'],
  ],
  events: [
    ['.qel', '事件一级列表', '时间/级别/对象/短摘要扫读；默认不铺 raw 与长原因。'],
    ['.qel-tabs', '分类页签', '数据质量与合成执行/审计分类呈现、不混业务状态。'],
    ['.qel-row', '打开详情', '发生了什么→影响对象→证据/来源→可执行下一步。'],
  ],
  history: [
    ['.qh-history-trend, .trend', '分时能耗', '曲线与柱消费真实序列；播放时窗口滑动更新。'],
    ['.period-table, .table-wrap', '质量分级明细', '点击行定位分钟级证据；缺值不补零。'],
  ],
  records: [
    ['.workspace .panel', '记录与审计', '故障退休、子段人审与导出记录只读可查。'],
    ['.workspace table, .workspace .plain-list', '逐条证据', '从记录回到对象与时刻。'],
  ],
  data: [
    ['.qh-data-ingress, .workspace .panel', '数据接入与治理', '批次/来源/质量只读呈现；导入入口真实可用。'],
  ],
}
function stepsFor(routeKey: string): Step[] {
  if (ROUTE_STEPS[routeKey]) return ROUTE_STEPS[routeKey]
  const top = routeKey.split('/')[0]
  for (const k of Object.keys(ROUTE_STEPS)) if (k.startsWith(top)) return ROUTE_STEPS[k]
  return [
    ['.ws-head, .app-topbar', '工作区页头', '标题、页签与全局操作在一个外壳内。'],
    ['.workspace .panel', '当前工作区', '结论与动作优先，说明按需展开。'],
    ['.app-footer-toggle', '说明随时可查', '背景说明由你主动展开。'],
  ]
}
const moduleOf = (routeKey: string) => routeKey.split('/')[0] || 'console'

/** Mature Driver engine; no solver calls, route rewriting, or business-data writes. */
export default function ConsoleTour({ routeKey, onRailChange, guideNonce = 0 }: { routeKey: string; onRailChange?: (open:boolean) => void; guideNonce?: number }) {
  const mod = moduleOf(routeKey)
  const [invite, setInvite] = useState(() => firstVisit(mod))
  useEffect(() => { setInvite(firstVisit(moduleOf(routeKey))) }, [routeKey])
  const instance = useRef<Driver | null>(null)
  const origin = useRef<HTMLElement | null>(null)
  const pending = useRef(0)
  const GUIDE = stepsFor(routeKey)
  const start = () => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : document.querySelector<HTMLElement>('[data-testid="rail-guide-btn"]')
    markSeen(mod); setInvite(false)
    instance.current?.destroy()
    const mobile = window.innerWidth <= 900
    const move = (index:number) => {
      const seq=++pending.current
      if (index >= GUIDE.length) { instance.current?.destroy(); return }
      const navStep=mobile && index===0
      onRailChange?.(navStep)
      const deadline=performance.now()+2000
      const ready=()=>{
        if(seq!==pending.current || !instance.current) return
        const el = document.querySelector<HTMLElement>(GUIDE[index][0])
        const settled = navStep ? true : !!el || performance.now() > deadline
        if(!settled) {requestAnimationFrame(ready);return}
        if(instance.current.isActive()) instance.current.moveTo(index)
        else instance.current.drive(index)
      }
      requestAnimationFrame(ready)
    }
    const target = (selector: string) => {
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        const r = el.getBoundingClientRect()
        if (r.width && r.height && r.right > 0 && r.left < innerWidth && !el.closest('[inert]')) {
          el.scrollIntoView({ block: 'center', behavior: 'auto' })
          return el
        }
      }
      // A mobile drawer is not falsely highlighted offscreen. Teach at its actual trigger.
      return document.querySelector<HTMLElement>(mobile ? '.rail-burger' : '.ws-head, .app-topbar') ?? document.body
    }
    const steps: DriveStep[] = GUIDE.map(([selector, title, description]) => ({
      element: () => target(selector),
      popover: { title, description, side: mobile ? 'bottom' : 'right', align: 'start' },
      disableActiveInteraction: true,
    }))
    instance.current = driver({
      steps, stagePadding: 8, stageRadius: 16, overlayOpacity: .42,
      animate: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      allowKeyboardControl: true, allowClose: true, showProgress: true,
      progressText: '{{current}} / {{total}}', nextBtnText: '下一步', prevBtnText: '上一步', doneBtnText: '完成',
      popoverClass: 'qh-tour',
      onNextClick: () => move((instance.current?.getActiveIndex() ?? 0)+1),
      onPrevClick: () => move(Math.max(0,(instance.current?.getActiveIndex() ?? 0)-1)),
      onPopoverRender: popover => {
        popover.wrapper.setAttribute('role', 'dialog')
        popover.wrapper.setAttribute('aria-modal', 'true')
        popover.wrapper.setAttribute('aria-label', '使用指引')
        popover.closeButton.setAttribute('aria-label', '退出指引')
        popover.closeButton.textContent = '×'
        popover.nextButton.focus({ preventScroll: true })
      },
      onDestroyed: () => {
        ++pending.current
        onRailChange?.(false)
        instance.current = null
        const el = origin.current?.isConnected ? origin.current : document.querySelector<HTMLElement>('[data-testid="rail-guide-btn"]')
        el?.focus({ preventScroll: true })
      },
    })
    move(0)
  }
  useEffect(() => {
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !instance.current?.isActive()) return
      const box = document.querySelector<HTMLElement>('.driver-popover')
      const controls = box ? [...box.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]')].filter(el => el.getClientRects().length) : []
      if (!controls.length) { e.preventDefault(); return }
      const current = controls.indexOf(document.activeElement as HTMLElement)
      e.preventDefault(); controls[(current + (e.shiftKey ? -1 : 1) + controls.length) % controls.length].focus()
    }
    document.addEventListener('keydown', trap, true)
    return () => { ++pending.current; document.removeEventListener('keydown', trap, true); instance.current?.destroy() }
  }, [])
  useEffect(() => { ++pending.current; instance.current?.destroy() }, [routeKey])
  // r45 ⑥ · 单入口：左导航底部真实按钮触发（nonce>0 时重开当前模块导览）。
  useEffect(() => {
    if (guideNonce > 0) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideNonce])
  return <>
    {invite && <aside className="tour-invite" aria-label="首次使用指引">
      <h2>欢迎来到{mod === 'welcome' ? '序幕' : '本工作区'}</h2><p>用一分钟了解这里能做什么与证据路径。</p>
      <div className="tour-invite-actions"><button className="btn primary" type="button" onClick={start}>开始导览</button>
        <button className="btn ghost" type="button" onClick={() => { markSeen(mod); setInvite(false) }}>跳过</button></div>
    </aside>}
  </>
}
