/**
 * D09 r04 · 全局光标单源（光感交互的正确心智模型，修复“切卡跳闪”）。
 *
 * 用户裁定的心智模型：光点**一直跟随鼠标**（页面级连续位置），
 * 卡片只负责「进入区域→显现该卡上的光感反馈；离开→隐没」——
 * 位置从不重置（不再从卡中心 (50,50) 起步），切卡时高光无缝交接。
 *
 * 架构：单例 rAF 阻尼循环（0.16，与规格一致）+ 订阅广播：
 * - pointermove（仅 mouse）更新目标；每帧 current += (t-c)*0.16；
 * - settled 且无新输入自停（省帧）；新输入唤醒；
 * - reduce：事件直落（无逐帧），订阅者立即收到；
 * - 触屏（hover:none）：不启动循环（CSS 同时隐藏 L5）。
 * 订阅者拿到的是**视口像素坐标**（连续、单调），各自换算为自身盒内百分比。
 */

import { useEffect } from 'react'

/** 应用根部挂一次（React 包装） */
export function useAutoGlow(): void {
  useEffect(() => {
    installAutoGlow()
  }, [])
}

type CursorListener = (x: number, y: number) => void

const listeners = new Set<CursorListener>()
let cur = { x: -1, y: -1 } // -1=尚无鼠标位置（未进入前不给任何卡点亮）
let tgt = { x: -1, y: -1 }
let raf: number | null = null
let reduce = false
let touchOnly = false
let inited = false

function mediaInit(): void {
  if (inited || typeof window === 'undefined') return
  inited = true
  if (typeof window.matchMedia !== 'function') return
  reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  touchOnly = window.matchMedia('(hover: none)').matches
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => (reduce = e.matches))
}

function loop(): void {
  const dx = tgt.x - cur.x
  const dy = tgt.y - cur.y
  if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) {
    cur = { ...tgt }
    broadcast()
    raf = null
    return
  }
  cur = { x: cur.x + dx * 0.16, y: cur.y + dy * 0.16 }
  broadcast()
  raf = requestAnimationFrame(loop)
}

function broadcast(): void {
  for (const fn of listeners) fn(cur.x, cur.y)
}

function wake(): void {
  if (raf === null) raf = requestAnimationFrame(loop)
}

function ensureGlobal(): void {
  if (inited) return
  mediaInit()
  if (touchOnly) return
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return
      tgt = { x: e.clientX, y: e.clientY }
      if (cur.x < 0) cur = { ...tgt } // 首次进入：直接就位（无跨屏飞入）
      if (reduce) {
        cur = { ...tgt }
        broadcast()
        return
      }
      wake()
    },
    { passive: true },
  )
}

/** 订阅全局阻尼光标；返回退订。触屏环境返回 no-op（不点亮）。 */
export function subscribeCursor(fn: CursorListener): () => void {
  ensureGlobal()
  if (touchOnly) return () => {}
  listeners.add(fn)
  if (cur.x >= 0) fn(cur.x, cur.y) // 新卡注册即拿到当前连续位置（切卡零跳变）
  return () => listeners.delete(fn)
}

/** 测试用：直接注入位置（绕过 DOM 事件） */
export function injectCursor(x: number, y: number): void {
  tgt = { x, y }
  cur = { x, y }
  broadcast()
}

/**
 * D09 r05 · 委托式光感（覆盖全部按钮/卡片/滑条/模块——零逐组件代码）：
 * document 级 pointerover/out 委托 + 广播写 --gx/--gy：
 * - 任何带 .u-glow / .u-glass / .u-cta-glass 的元素进入即点亮（.u-glass--lit）、离开即隐没；
 * - 位置=全局阻尼光标映射到该元素盒（**从不重置**——切卡/切按钮零跳变）；
 * - 离场组 inert/aria-hidden 不产生指针事件，天然不点亮；
 * - reduce 直落、触屏不启动（与订阅合同一致）。
 * 在应用根部调用一次：useAutoGlow()。
 */
const GLOW_SELECTOR =
  '.u-glow, .u-glass, .u-cta-glass, .lg-glass, ' +
  '.app-shell .panel, .app-shell .overview-main > section, ' +
  '.app-shell .app-topbar, .app-shell .app-rail, .app-shell .sub-nav, ' +
  '.app-shell .source-bar-controls, .app-shell .context-rail, .app-shell .device-details-drawer, ' +
  '.app-shell .trend, .app-shell .transport-bar, .app-shell .quality-summary, ' +
  '.app-shell .nav-item, .app-shell .sub-nav-item, ' +
  '.appearance-scene-trigger, .qh-welcome .qh-hdr-appearance, .app-footer-toggle, ' +
  '.qh-welcome .qh-hdr, .u-w1-natdemo, .topbar-modal, .u-dialog, ' +
  '.app-shell .plan-card, .app-shell .lab-card, .app-shell .kpi-card, ' +
  '.app-shell .chain-card, .app-shell .event-detail-card, .app-shell .qa-card, .app-shell .stage-card, ' +
  '.qh-relations, .qh-data-ingress, .qh-gov-events, ' +
  // r44 B · 外层卡同族光感：统一页头/设备面板/演示卡/成果与页脚卡
  '.app-shell .ws-head, .qh-welcome .qh-device-panel, .qh-welcome .qh-demo-machine, ' +
  '.qh-welcome .qh-proof-card, .qh-welcome .qh-passport-side, .qh-welcome .qh-cta-band, ' +
  '.app-shell .chat-main, .app-shell .event-row'
let litEl: HTMLElement | null = null
let autoInstalled = false

function writeGlow(el: HTMLElement, cx: number, cy: number): void {
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  el.style.setProperty('--gx', `${(((cx - rect.left) / rect.width) * 100).toFixed(2)}%`)
  el.style.setProperty('--gy', `${(((cy - rect.top) / rect.height) * 100).toFixed(2)}%`)
}

function inTrack(el: HTMLElement | null): boolean {
  return !!el && (el.matches(GLOW_SELECTOR) || !!el.closest(GLOW_SELECTOR))
}

export function installAutoGlow(): void {
  if (autoInstalled || typeof document === 'undefined') return
  autoInstalled = true
  ensureGlobal()
  if (touchOnly) return
  document.addEventListener(
    'pointerover',
    (e) => {
      const el = (e.target as Element | null)?.closest?.(GLOW_SELECTOR) as HTMLElement | null
      if (el && el !== litEl) {
        if (litEl) litEl.classList.remove('u-glass--lit')
        litEl = el
        el.classList.add('u-glass--lit')
        writeGlow(el, cur.x, cur.y) // 进入即就位（无起点跳变）
      }
    },
    { passive: true },
  )
  document.addEventListener(
    'pointerout',
    (e) => {
      if (!litEl) return
      const related = e.relatedTarget as Element | null
      if (!related || !inTrack(related as HTMLElement)) {
        litEl.classList.remove('u-glass--lit')
        litEl = null
      }
    },
    { passive: true },
  )
  // 广播时同步点亮元素的 --gx/--gy
  listeners.add((cx, cy) => {
    if (litEl) writeGlow(litEl, cx, cy)
  })
}
