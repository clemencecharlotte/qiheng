import { useEffect, useRef, useState } from 'react'
import { driver, type Driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'

const KEY = 'qiheng.console-tour.v1'
function firstVisit() {
  try { return localStorage.getItem(KEY) !== 'seen' } catch { return true }
}
function markSeen() { try { localStorage.setItem(KEY, 'seen') } catch { /* preference only */ } }
const GUIDE = [
  ['.app-nav', '从工作区开始', '调度、设备、关系MAP与智能体各司其职。手机可通过导航按钮打开工作区。'],
  ['.transport-bar,.source-bar,.agent-context,.map-workspace .toolbar', '同一来源，同一时刻', '播放或定位观察桶，设备、数值与图形共同变化。调度与历史回放保持各自来源。'],
  ['.sub-nav', '先比较，再复验', '在方案比较中查看取舍，复验人审核对约束；指引不会代你批准或启动。'],
  ['.stage-panel,.context-panel,.agent-tools,.relation-evidence', '从对象进入证据', '设备与来源引用可定位具体证据。使用页面的显式返回，回到本次入口。'],
  ['[data-tour-workspace="map"]', '看懂关系', '关系MAP连接设备、数据与决策证据。点击对象查看依据，而不是把连线当安全许可。'],
  ['[data-tour-workspace="agent"]', '带着上下文查询', '智能体内选择预置资料与工具，结果可回到来源。模型连接状态以页面显示为准。'],
  ['.app-footer-toggle', '说明随时可查', '背景说明由你主动展开。完成后可使用“使用指引”重新查看。'],
] as const

/** Mature Driver engine; no solver calls, route rewriting, or business-data writes. */
export default function ConsoleTour({ routeKey, onRailChange }: { routeKey: string; onRailChange?: (open:boolean) => void }) {
  const [invite, setInvite] = useState(firstVisit)
  const instance = useRef<Driver | null>(null)
  const origin = useRef<HTMLElement | null>(null)
  const replay = useRef<HTMLButtonElement>(null)
  const pending = useRef(0)
  const start = () => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : replay.current
    markSeen(); setInvite(false)
    instance.current?.destroy()
    const mobile = window.innerWidth <= 900
    const move = (index:number) => {
      const seq=++pending.current
      if (index >= GUIDE.length) { instance.current?.destroy(); return }
      const navStep=mobile && [0,4,5].includes(index)
      onRailChange?.(navStep)
      const deadline=performance.now()+2000
      const ready=()=>{
        if(seq!==pending.current || !instance.current) return
        const nav=document.querySelector<HTMLElement>('.app-nav')
        const r=nav?.getBoundingClientRect()
        const settled=navStep ? !!r && r.left>=0 && r.right<=innerWidth : !document.querySelector('.app-body[inert]')
        if(!settled && performance.now()<deadline) {requestAnimationFrame(ready);return}
        if(instance.current.isActive()) instance.current.moveTo(index)
        else instance.current.drive(index)
      }
      requestAnimationFrame(ready)
    }
    const target = (selector: string) => {
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        const r = el.getBoundingClientRect()
        if (r.width && r.height && r.right > 0 && r.left < innerWidth && !el.closest('[inert]')) return el
      }
      // A mobile drawer is not falsely highlighted offscreen. Teach at its actual trigger.
      return document.querySelector<HTMLElement>(mobile ? '.rail-burger' : '.app-topbar') ?? replay.current!
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
        const el = origin.current?.isConnected ? origin.current : replay.current
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
  return <>
    {invite && <aside className="tour-invite" aria-label="首次使用指引">
      <h2>欢迎来到操作台</h2><p>用一分钟了解工作区和证据路径。</p>
      <div className="tour-invite-actions"><button className="btn primary" type="button" onClick={start}>开始指引</button>
        <button className="btn ghost" type="button" onClick={() => { markSeen(); setInvite(false) }}>稍后</button></div>
    </aside>}
    <button className="btn ghost tour-replay" type="button" ref={replay} onClick={start}>使用指引</button>
  </>
}
