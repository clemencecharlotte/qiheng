/**
 * D08-W1 · R3 ProductDemo——真实产品演示播放器（录屏资产由主线负责）。
 *
 * 合同（S1-R1 R3 / SHARED-CONTRACT）：
 * - props：assetId/src?/poster?/captions?/events/label/onRetry?。缺 src → 显示
 *   「暂无演示 · 待接入」（真实无资产态），绝不做假打字/「录制中」冒充。
 * - 原生 <video> muted playsInline preload=metadata；播放/暂停/重播/进度原生控件 +
 *   键盘可达（原生控件自带）；默认静音。
 * - 单活跃播放：由父级 coordinator 传 activeId（本组件 muted 之外的互斥）——
 *   播放时请求 activeId=assetId；activeId≠assetId 时自动 pause。两实例互斥。
 * - 离屏（IntersectionObserver）自动暂停；回到页面不自动续播（保守）。
 * - 加载/播放失败 → poster + 真实「重试」按钮（调 onRetry 或重置 video.load）；
 *   错误态如实显示，不假成功。
 * - 点击视频/播放绝不调用 LLM/审批/设备（纯 UI 组件，无任何副作用 API）。
 * - events：真实事件/字幕时间表 [{at,label}]，就近列表呈现（不裁切隐藏安全提示）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { GlassSurface } from './GlassSurface'
import '../unified/ProductMaterial.css' // D08-r02：显式携带已接受语义 token 依赖（D06 r04 原件，只读）
import './ProductDemo.css'

export interface DemoEvent {
  at: string
  label: string
}

export interface ProductDemoProps {
  assetId: string
  /** 视频资产 URL；缺省 = 待接入（无资产） */
  src?: string
  poster?: string
  captions?: string
  /** 真实事件/字幕时间表（来自实际录屏脚本） */
  events: DemoEvent[]
  label: string
  /** 父级 coordinator：当前唯一活跃播放的 assetId（两播放器互斥） */
  activeId?: string | null
  onActiveChange?: (assetId: string | null) => void
  onRetry?: () => void
  footnote?: string
  /** D09 · 成功路径合成夹具：给定 durationSec 渲染自驱动模拟播放器（真实 src 优先） */
  simulate?: DemoSimulateSpec
}

export type DemoPhase = 'pending' | 'idle' | 'playing' | 'paused' | 'error'

export function demoPhaseFor(hasSrc: boolean, errored: boolean): DemoPhase {
  if (!hasSrc) return 'pending'
  if (errored) return 'error'
  return 'idle'
}

/**
 * D09 · 合成媒体适配器（成功路径测试夹具，typed 合同）。
 * 协调授权：成功路径用「明确标注的原创合成夹具」验证播放/暂停/重播/进度/互斥/离屏，
 * 不再以不存在 URL 当成功样例；真实 <video> 分支合同不变（主线交资产即用）。
 * 事件合同与原生 video 对齐：play→请求互斥、pause→释放、timeupdate→进度、ended→重播态、
 * 离屏→强制 pause。UI 恒标「合成媒体 · 测试夹具」，绝不冒充最终产品演示。
 */
export interface DemoSimulateSpec {
  /** 合成媒体时长（秒，>0） */
  durationSec: number
  /** 夹具说明（默认标注合成来源） */
  label?: string
}

export type DemoSimPhase = 'idle' | 'playing' | 'paused' | 'ended'

export function demoSimNextPhase(phase: DemoSimPhase, action: 'play' | 'pause' | 'end' | 'replay'): DemoSimPhase {
  switch (action) {
    case 'play':
      return phase === 'ended' ? 'playing' : 'playing'
    case 'pause':
      return phase === 'playing' ? 'paused' : phase
    case 'end':
      return 'ended'
    case 'replay':
      return 'playing'
  }
}

export function demoSimProgress(sec: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0
  return Math.min(1, Math.max(0, sec / durationSec))
}

export default function ProductDemo(props: ProductDemoProps) {
  const { assetId, src, poster, captions, events, label, activeId, onActiveChange, onRetry, footnote, simulate } = props
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [errored, setErrored] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const [inView, setInView] = useState(true)
  const phase = demoPhaseFor(!!src, errored)

  // ── D09 · 合成媒体成功路径（simulate 存在且无真实 src 时启用）──
  const simActive = !src && !!simulate && simulate.durationSec > 0
  const [simPhase, setSimPhase] = useState<DemoSimPhase>('idle')
  const [simSec, setSimSec] = useState(0)
  const simRaf = useRef<number | null>(null)
  const simLast = useRef(0)

  const simPause = useCallback(() => {
    if (simRaf.current !== null) {
      cancelAnimationFrame(simRaf.current)
      simRaf.current = null
    }
  }, [])
  const simPlay = useCallback(() => {
    if (simRaf.current !== null) return
    setSimPhase((p) => demoSimNextPhase(p, 'play'))
    onActiveChange?.(assetId) // 互斥：请求成为唯一活跃
    simLast.current = performance.now()
    const dur = simulate?.durationSec ?? 1
    const tick = (now: number) => {
      const d = (now - simLast.current) / 1000
      simLast.current = now
      setSimSec((sec) => {
        const next = sec + d
        if (next >= dur) {
          setSimPhase('ended')
          onActiveChange?.(null)
          simRaf.current = null
          return dur
        }
        simRaf.current = requestAnimationFrame(tick)
        return next
      })
    }
    simRaf.current = requestAnimationFrame(tick)
  }, [assetId, onActiveChange, simulate?.durationSec])
  const simRestart = useCallback(() => {
    simPause()
    setSimSec(0)
    setSimPhase((p) => demoSimNextPhase(p, 'replay'))
    onActiveChange?.(assetId)
    simLast.current = performance.now()
    const dur = simulate?.durationSec ?? 1
    const tick = (now: number) => {
      const d = (now - simLast.current) / 1000
      simLast.current = now
      setSimSec((sec) => {
        const next = sec + d
        if (next >= dur) {
          setSimPhase('ended')
          onActiveChange?.(null)
          simRaf.current = null
          return dur
        }
        simRaf.current = requestAnimationFrame(tick)
        return next
      })
    }
    simRaf.current = requestAnimationFrame(tick)
  }, [assetId, onActiveChange, simPause, simulate?.durationSec])

  // 互斥：activeId 归属他人 → 合成媒体同步暂停
  useEffect(() => {
    if (!simActive) return
    if (activeId != null && activeId !== assetId) {
      simPause()
      setSimPhase((p) => demoSimNextPhase(p, 'pause'))
    }
  }, [activeId, assetId, simActive, simPause])

  // 离屏：合成媒体暂停（不自动续播）
  useEffect(() => {
    if (!simActive) return
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => {
      const vis = es[0]?.isIntersecting ?? true
      setInView(vis)
      if (!vis) {
        simPause()
        setSimPhase((p) => demoSimNextPhase(p, 'pause'))
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [simActive, simPause])
  useEffect(
    () => () => {
      if (simRaf.current !== null) cancelAnimationFrame(simRaf.current)
    },
    [],
  )

  // 离屏自动暂停（保守：不自动续播）
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => {
      const vis = es[0]?.isIntersecting ?? true
      setInView(vis)
      if (!vis && typeof document !== 'undefined') videoRef.current?.pause()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // 互斥：activeId 归属他人 → 暂停
  useEffect(() => {
    if (activeId != null && activeId !== assetId) videoRef.current?.pause()
  }, [activeId, assetId])

  const requestActive = useCallback(() => onActiveChange?.(assetId), [assetId, onActiveChange])
  const onPause = useCallback(() => {
    if (onActiveChange && activeId === assetId) onActiveChange(null)
  }, [activeId, assetId, onActiveChange])

  const onError = useCallback(() => setErrored(true), [])
  const retry = useCallback(() => {
    setErrored(false)
    setRetryNonce((n) => n + 1)
    onRetry?.()
    const v = videoRef.current
    if (v) {
      v.load()
    }
  }, [onRetry])

  return (
    <GlassSurface innerRef={wrapRef} className={`u-w1-demo u-w1-demo--${phase}`} ariaLabel={label} dataAttrs={{ "data-asset-id": assetId, "data-in-view": String(inView) }}>
      <header className="u-w1-demo__head">
        <h4 className="u-w1-demo__label">{label}</h4>
        <span className="u-w1-demo__badge">产品演示</span>
      </header>

      <div className="u-w1-demo__stage">
        {simActive ? (
          /* D09 · 合成媒体适配器夹具：自驱动状态机走与原生 video 相同的事件合同 */
          <div className="u-w1-demo__sim" data-sim-phase={simPhase}>
            <span className="u-w1-demo__sim-badge">合成媒体 · 测试夹具（非最终产品演示）</span>
            {poster ? <img className="u-w1-demo__poster" src={poster} alt="" aria-hidden="true" /> : null}
            <div className="u-w1-demo__sim-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(demoSimProgress(simSec, simulate?.durationSec ?? 1) * 100)}>
              <span className="u-w1-demo__sim-fill" style={{ width: `${(demoSimProgress(simSec, simulate?.durationSec ?? 1) * 100).toFixed(1)}%` }} />
            </div>
            <div className="u-w1-demo__sim-ctrl">
              {simPhase === 'playing' ? (
                <button type="button" className="u-w1-demo__retry u-glow" onClick={() => { simPause(); setSimPhase('paused'); onActiveChange?.(null) }}>
                  暂停
                </button>
              ) : (
                <button type="button" className="u-w1-demo__retry u-glow" onClick={simPhase === 'ended' ? simRestart : simPlay}>
                  {simPhase === 'ended' ? '重播' : '播放'}
                </button>
              )}
              <span className="u-w1-demo__sim-time">
                {simSec.toFixed(1)}s / {(simulate?.durationSec ?? 0).toFixed(1)}s · in-view={String(inView)}
              </span>
            </div>
          </div>
        ) : phase === 'pending' ? (
          <div className="u-w1-demo__pending">
            <p className="u-w1-demo__pending-title">暂无演示 · 待接入</p>
            <p className="u-w1-demo__pending-sub">未接入正式演示资产前不提供占位播放。</p>
          </div>
        ) : phase === 'error' ? (
          <>
            {poster ? <img className="u-w1-demo__poster" src={poster} alt="" aria-hidden="true" /> : null}
            <div className="u-w1-demo__error">
              <p className="u-w1-demo__pending-title">演示加载失败</p>
              <p className="u-w1-demo__pending-sub">视频资产未能加载（网络或文件问题），可重试。</p>
              <button type="button" className="u-w1-demo__retry u-glow" onClick={retry}>
                重试
              </button>
            </div>
          </>
        ) : (
          <video
            key={`${assetId}:${retryNonce}`}
            ref={videoRef}
            className="u-w1-demo__video"
            src={src}
            poster={poster}
            controls
            muted
            playsInline
            preload="metadata"
            onError={onError}
            onPlay={requestActive}
            onPause={onPause}
          >
            {captions ? <track kind="captions" src={captions} label="字幕" srcLang="zh-CN" /> : null}
          </video>
        )}
      </div>

      <div className="u-w1-demo__events">
        <h5 className="u-w1-demo__events-h">事件时间表</h5>
        <ol className="u-w1-demo__event-list">
          {events.map((e, i) => (
            <li key={i} className="u-w1-demo__event">
              <span className="u-w1-demo__event-at">{e.at}</span>
              <span className="u-w1-demo__event-label">{e.label}</span>
            </li>
          ))}
        </ol>
      </div>
      {footnote ? <p className="u-w1-demo__footnote">{footnote}</p> : null}
    </GlassSurface>
  )
}
