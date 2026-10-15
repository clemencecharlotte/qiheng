import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  chooseClosingTarget,
  chooseOpeningFrom,
  identityPose,
  type Pose,
  type Rect,
} from './dialogGeometry'
import { PanelMotion } from './dialogMotion'
import { shouldCloseOnScrimPress, trapModalTab } from './modalFocus'
import { acquireBg, acquireScroll, isMeasurableAnchor, lockStyle, nextPhase } from './lifecycle'
import './ProductMaterial.css'
import './OriginDialog.css'

/**
 * D06-r04 · OriginDialog（r03 组件门残留三处收口）。
 * 1) 反转（closing→open）：startOpen 先 sampleThenCancel 采样当前位姿（含 opacity），
 *    **同步**启动 opening 动画且 from=采样位姿（chooseOpeningFrom reversal 分支）——
 *    不再回锚点；仅完整 closed→open 才走 layout-effect 的来源 FLIP。
 * 2) closing：startClose 在背景锁/正文未释放、采样之后 **重测本次真实来源**
 *    （measureAnchor：连接+可见+有效 rect；隐藏/移除 → 清缓存），
 *    终点由 chooseClosingTarget 决定：有效 → 未变换布局 rect FLIP；
 *    无效 → 当前位置仅 opacity 淡出（不飞旧坐标、不 identity 跳变）。
 * 3) 采样位姿消费/完整 settle 即清理（startFromPoseRef），下次完整打开不误用旧 pose。
 * 每次意图只一条有效动画：intentRef + PanelMotion 令牌失效旧回调、完成即 cancel 清 fill；
 * closing 期间正文/标题/尺寸冻结（宿主 onAfterClose 才清内容），背景隔离/滚动锁维持到
 * settle-closed；回焦校验可见可聚焦。reduce：瞬切（无远距动画），仅 ≤160ms 颜色反馈。
 */

type Phase = 'closed' | 'opening' | 'open' | 'closing'
const OPEN_MS = 320
const CLOSE_MS = 260

interface Props {
  title: string
  children: ReactNode
  note?: ReactNode
  /** 受控模式：传 open 后内部触发器不渲染；onAfterClose 在完全关闭后回调 */
  open?: boolean
  onClose?: () => void
  /** 完全关闭（closing 结束、背景/滚动已恢复）后回调：宿主此时才清内容 */
  onAfterClose?: () => void
  /** 每次打开前，宿主把 originRef.current 指到本次入口元素 */
  originRef?: RefObject<HTMLElement | null>
  /** portal 就绪即聚焦（应为面板内可见表单首字段） */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** 来源消失时的回焦候选（须可见可聚焦） */
  fallbackFocusRef?: RefObject<HTMLElement | null>
  /** 非受控模式触发器 */
  triggerLabel?: ReactNode
}

function layoutRectOf(el: HTMLElement): Rect {
  // 未变换 layout rect：offsetLeft/Top/Width/Height 不受 transform 影响
  return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
}

export default function OriginDialog(props: Props) {
  const { title, children, note } = props
  const controlled = props.open !== undefined
  const titleId = useId()

  const internalTriggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [internalOpen, setInternalOpen] = useState(false)
  const [phase, setPhaseState] = useState<Phase>('closed')
  const phaseRef = useRef<Phase>('closed')
  const intentRef = useRef<'open' | 'close' | null>(null)
  const motionRef = useRef<PanelMotion | null>(null)
  const openingStartedRef = useRef(false)
  const anchorRef = useRef<Rect | null>(null)
  const panelLayoutRef = useRef<Rect | null>(null)
  const bgRef = useRef<{ inert: boolean; aria: string | null } | null>(null)
  const scrollRef = useRef<{ overflow: string | null; paddingRight: string | null } | null>(null)
  const startFromPoseRef = useRef<Pose | null>(null)

  const open = controlled ? !!props.open : internalOpen

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])

  const transition = useCallback(
    (evt: 'open' | 'close' | 'settle-open' | 'settle-closed'): boolean => {
      const next = nextPhase(phaseRef.current, evt)
      if (next) setPhase(next)
      return next !== null
    },
    [setPhase],
  )

  const originEl = useCallback((): HTMLElement | null => {
    return (controlled ? props.originRef?.current : internalTriggerRef.current) ?? null
  }, [controlled, props.originRef])

  const measureAnchor = useCallback(() => {
    const el = originEl()
    if (!isMeasurableAnchor(el)) {
      anchorRef.current = null // 来源无效：就地淡出，不清旧缓存也不飞旧坐标
      return null
    }
    const r = el!.getBoundingClientRect()
    anchorRef.current = { left: r.left, top: r.top, width: r.width, height: r.height }
    return anchorRef.current
  }, [originEl])

  const lockScroll = useCallback(() => {
    if (scrollRef.current) return // 重入不覆盖
    const docEl = document.documentElement
    const gap = window.innerWidth - docEl.clientWidth
    scrollRef.current = acquireScroll(
      scrollRef.current,
      { overflow: docEl.style.overflow || null, paddingRight: docEl.style.paddingRight || null },
      gap,
    )
    const st = lockStyle(scrollRef.current, gap)
    docEl.style.overflow = st.overflow
    docEl.style.paddingRight = st.paddingRight
  }, [])

  const releaseScroll = useCallback(() => {
    const st = scrollRef.current
    if (!st) return
    const docEl = document.documentElement
    if (st.overflow !== null) docEl.style.overflow = st.overflow
    else docEl.style.removeProperty('overflow')
    if (st.paddingRight !== null) docEl.style.paddingRight = st.paddingRight
    else docEl.style.removeProperty('padding-right')
    scrollRef.current = null
  }, [])

  const isolateBg = useCallback(() => {
    if (bgRef.current) return // 重入不覆盖
    const root = document.getElementById('root')
    if (!root) return
    bgRef.current = acquireBg(null, { inert: root.inert, aria: root.getAttribute('aria-hidden') })
    root.inert = true
    root.setAttribute('aria-hidden', 'true')
  }, [])

  const releaseBg = useCallback(() => {
    const root = document.getElementById('root')
    const st = bgRef.current
    if (!root || !st) return
    root.inert = st.inert
    if (st.aria === null) root.removeAttribute('aria-hidden')
    else root.setAttribute('aria-hidden', st.aria)
    bgRef.current = null
  }, [])

  const settleOpen = useCallback(() => {
    openingStartedRef.current = false
    startFromPoseRef.current = null // 完整 settle 清理采样
    if (!transition('settle-open')) return
    const initEl = props.initialFocusRef?.current
    if (initEl && panelRef.current?.contains(initEl)) initEl.focus({ preventScroll: true })
    else closeRef.current?.focus({ preventScroll: true })
  }, [props.initialFocusRef, transition])

  const settleClosed = useCallback(() => {
    if (!transition('settle-closed')) return
    intentRef.current = null
    openingStartedRef.current = false
    startFromPoseRef.current = null // 完整 settle 清理采样
    releaseBg()
    releaseScroll()
    props.onAfterClose?.()
    // 回焦：本次来源（仍连接/可见）→ fallbackFocusRef → data-qh-focus-fallback → body
    const origin = originEl()
    if (origin && isMeasurableAnchor(origin)) {
      origin.focus({ preventScroll: true })
      return
    }
    const fb = props.fallbackFocusRef?.current
    if (fb && isMeasurableAnchor(fb)) {
      fb.focus({ preventScroll: true })
      return
    }
    const generic = document.querySelector<HTMLElement>('[data-qh-focus-fallback]')
    ;(generic ?? document.body).focus({ preventScroll: true })
  }, [originEl, props.fallbackFocusRef, props.onAfterClose, releaseBg, releaseScroll, transition])

  const motion = useCallback((): PanelMotion => {
    if (!motionRef.current) {
      motionRef.current = new PanelMotion({
        getComputedStyle: () => {
          const el = panelRef.current
          if (!el) return { transform: 'none', opacity: '1' }
          const cs = window.getComputedStyle(el)
          return { transform: cs.transform, opacity: cs.opacity }
        },
        animate: (kf, opts) => panelRef.current!.animate(kf, opts),
      })
    }
    return motionRef.current
  }, [])

  const requestClose = useCallback(() => {
    if (controlled) props.onClose?.()
    else setInternalOpen(false)
  }, [controlled, props.onClose])

  const startOpen = useCallback(() => {
    intentRef.current = 'open'
    const reversal = phaseRef.current === 'closing'
    if (reversal) {
      // 反转：**先采样当前位姿再取消**（连续反向；r01/r03 实测跳位根因）
      const sampled = motion().sampleThenCancel()
      startFromPoseRef.current = sampled
    } else {
      // 完整打开：清理任何旧采样，防止误用上一次的位姿
      startFromPoseRef.current = null
    }
    if (!transition('open')) return
    isolateBg()
    lockScroll()
    measureAnchor()
    if (reversal) {
      // 反转：面板已在 DOM，同步启动 opening 动画，from=本次采样位姿（含 opacity），
      // layout-effect 因 openingStartedRef 已置位不会重复启动
      openingStartedRef.current = true
      const el = panelRef.current
      const layout = el
        ? layoutRectOf(el)
        : { left: Math.max(0, (window.innerWidth - 380) / 2), top: 12, width: 380, height: 320 }
      panelLayoutRef.current = layout
      const from = chooseOpeningFrom({
        reversal: true,
        sampled: startFromPoseRef.current,
        anchor: null,
        originConnected: false,
        panelFinal: layout,
      })
      startFromPoseRef.current = null // 消费即清
      motion().play(
        from,
        identityPose(),
        OPEN_MS,
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        settleOpen,
      )
    }
    // 完整打开：FLIP 在 layout-effect（下方）启动
  }, [measureAnchor, motion, isolateBg, lockScroll, settleOpen, transition])

  const startClose = useCallback(() => {
    // 幂等资格 guard（M12-r01 阻断修复）：closing/closed 下重复 close 完全无副作用。
    // 宿主的 inline onAfterClose/onClose 每 render 新身份会令受控 effect 在 open=false 不变时重跑；
    // 若无 guard，重复 startClose 会 sampleThenCancel 取消进行中的 closing 动画，随后 transition('close')
    // 因 phase='closing' 返回 null，导致没有新 play/settle，phase 永久停在 closing、root 保持 inert。
    // 真正关闭仍是：先采样 → 再取消 → 再 transition（不能粗暴先 transition 改当前 pose）。
    if (nextPhase(phaseRef.current, 'close') === null) return
    // 变 phase / 改内容前采样当前位姿（Esc 中途关闭同样适用）
    const pose = motion().sampleThenCancel()
    startFromPoseRef.current = pose
    intentRef.current = 'close'
    if (!transition('close')) return
    // 背景锁/正文未释放、采样之后：**重测本次真实来源**
    // （连接 + 可见 + 有效 rect；display:none/移除 → 清缓存返回 null）
    const anchor = measureAnchor()
    // closing 收回同步启动（面板已挂载，无跳帧）；终点用未变换 layout rect
    const layout = panelRef.current
      ? layoutRectOf(panelRef.current)
      : { left: Math.max(0, (window.innerWidth - 380) / 2), top: 12, width: 380, height: 320 }
    panelLayoutRef.current = layout
    const target = chooseClosingTarget({ anchor, pose, panelFinal: layout })
    motion().play(pose, target, CLOSE_MS, window.matchMedia('(prefers-reduced-motion: reduce)').matches, settleClosed)
  }, [measureAnchor, motion, settleClosed, transition])

  // 受控：外部 open 变化驱动（open 变量在此消费）
  useEffect(() => {
    if (!controlled) return
    if (open) startOpen()
    else startClose()
  }, [controlled, open, startOpen, startClose])

  // 非受控：内部开关驱动
  useEffect(() => {
    if (controlled) return
    if (internalOpen) startOpen()
    else startClose()
  }, [controlled, internalOpen, startOpen, startClose])

  // opening：仅完整 closed→open 的来源 FLIP 在此启动一次
  // （反转 closing→open 已由 startOpen 同步启动并置 openingStartedRef，此处跳过）
  useLayoutEffect(() => {
    if (phase !== 'opening') return
    if (intentRef.current !== 'open') return
    if (openingStartedRef.current) return
    openingStartedRef.current = true
    const vw = window.innerWidth
    const panelEl = panelRef.current
    const layout = panelEl ? layoutRectOf(panelEl) : { left: Math.max(0, (vw - 380) / 2), top: 12, width: 380, height: 320 }
    panelLayoutRef.current = layout
    const from = chooseOpeningFrom({
      reversal: false,
      sampled: startFromPoseRef.current,
      anchor: anchorRef.current,
      originConnected: !!(originEl()?.isConnected ?? false),
      panelFinal: layout,
    })
    startFromPoseRef.current = null // 消费即清
    motion().play(from, identityPose(), OPEN_MS, window.matchMedia('(prefers-reduced-motion: reduce)').matches, settleOpen)
    // portal 就绪即初始焦点（可见表单首字段 → 关闭钮）
    const initEl = props.initialFocusRef?.current
    if (initEl && panelRef.current?.contains(initEl)) initEl.focus({ preventScroll: true })
    else closeRef.current?.focus({ preventScroll: true })
  }, [phase, motion, originEl, props.initialFocusRef, settleOpen])

  // 打开全程：滚动/缩放/侧栏重测锚点与面板 layout rect（事件驱动，不逐帧布局查询）
  useEffect(() => {
    if (phase !== 'open' && phase !== 'opening') return
    const onRe = () => {
      measureAnchor()
      const el = panelRef.current
      if (el) panelLayoutRef.current = layoutRectOf(el)
    }
    window.addEventListener('scroll', onRe, { passive: true })
    window.addEventListener('resize', onRe)
    return () => {
      window.removeEventListener('scroll', onRe)
      window.removeEventListener('resize', onRe)
    }
  }, [phase, measureAnchor])

  // 全程键盘：Esc + Tab 围栏（opening/open/closing）
  useEffect(() => {
    if (phase === 'closed') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        requestClose()
        return
      }
      if (e.key === 'Tab') {
        trapModalTab(
          e,
          panelRef.current ?? { contains: () => false },
          document.activeElement,
          Array.from(
            panelRef.current?.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
            ) ?? [],
          ),
        )
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [phase, startClose])

  // 卸载兜底：取消动画 + 恢复隔离/滚动
  useEffect(
    () => () => {
      motionRef.current?.cancel()
      motionRef.current = null
      releaseBg()
      releaseScroll()
    },
    [releaseBg, releaseScroll],
  )

  const mounted = phase !== 'closed'
  const showInternalTrigger = !controlled

  return (
    <>
      {showInternalTrigger ? (
        <button
          type="button"
          ref={internalTriggerRef}
          className="u-origin-trigger"
          aria-haspopup="dialog"
          aria-expanded={phase === 'open' || phase === 'opening'}
          onClick={startOpen}
        >
          {props.triggerLabel}
        </button>
      ) : null}
      {mounted
        ? createPortal(
            <div
              className="u-dialog-scrim"
              data-phase={phase}
              onMouseDown={(e) => {
                if (shouldCloseOnScrimPress(e)) requestClose()
              }}
            >
              <div
                className="u-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                data-phase={phase}
                ref={panelRef}
              >
                <div className="u-dialog__head">
                  <h2 id={titleId}>{title}</h2>
                  <button type="button" className="u-dialog__close" aria-label="关闭" onClick={requestClose} ref={closeRef}>
                    ✕
                  </button>
                </div>
                <div className="u-dialog__body">{children}</div>
                {note ? <div className="u-dialog__note">{note}</div> : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
