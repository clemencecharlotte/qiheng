/**
 * D10 r01 · NativeDemoPlayer——原生 <video> 真实媒体合同（成功路径，非 simulate）。
 *
 * 原生事件白名单（全部真实 DOM 事件，非合成）：loadedmetadata（元数据就绪）/
 * play / pause / timeupdate（进度）/ ended（重播态）/ error（失败→poster+重试）。
 * 合同（协调指定）：
 * - 明确播放/暂停/重播/进度控件（自绘键盘可达按钮 + 原生进度；默认静音 muted、
 *   playsInline、preload=metadata；reduced-motion 不自动播放——本组件从不 autoplay）；
 * - 同页两实例互斥（activeId coordinator：他者播放即暂停）；
 * - 手机不同时播（同一互斥合同）；离屏（IntersectionObserver）暂停、不自动续播；
 * - 加载失败 → poster + 明确「重试」按钮（重挂 video：key=assetId:src:nonce + load()）；
 * - **src 换入不残旧监听/观察器**：全部 effect 以 [assetId, src] 为依赖重建，
 *   旧 IO/事件清理函数随 effect 卸载执行；
 * - 无 blur（数据区实底）；触达 ≥44；
 * - 测试夹具（合成色板/时间码）恒标「原生媒体测试夹具」，不计两条最终产品视频；
 *   无 src → 「暂无演示 · 待接入」诚实态，不伪正在录制、不用坏 URL 冒成功。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPlaybackController, type PlaybackController } from './demoPlaybackController'
import './NativeDemoPlayer.css'

export interface DemoEvent {
  at: string
  label: string
}

export interface NativeDemoPlayerProps {
  assetId: string
  /** 真实媒体 URL（mp4/webm）；缺省 = 待接入（无资产） */
  src?: string
  poster?: string
  captions?: string
  /** 真实事件/字幕时间表 */
  events: DemoEvent[]
  label: string
  /** 父级 coordinator：当前唯一活跃播放 assetId（两实例互斥/手机不同时播） */
  activeId?: string | null
  onActiveChange?: (assetId: string | null) => void
  onRetry?: () => void
  footnote?: string
  /** 夹具标注（真实录制资产由主线供 src 时省略） */
  fixtureBadge?: string
  /** M24 C · 共享播放协调器（两实例互斥/明确接管）；缺省每实例自建。 */
  controller?: PlaybackController
}

export type NativePhase = 'pending' | 'ready' | 'playing' | 'paused' | 'ended' | 'error'

export function nativePhaseFor(hasSrc: boolean, errored: boolean, metaReady: boolean, playing: boolean, ended: boolean): NativePhase {
  if (!hasSrc) return 'pending'
  if (errored) return 'error'
  if (playing) return 'playing'
  if (ended) return 'ended'
  if (metaReady) return 'ready' // loadedmetadata 后可播放（暂停/就绪态）
  return 'ready'
}

/** 合成媒体夹具 manifest（原创，来源可追；不计最终产品视频） */
export const NATIVE_FIXTURE_MANIFEST = {
  mp4: 'demo-assets/native-fixture-640x360.mp4',
  poster: 'demo-assets/native-fixture-poster.png',
  captions: 'demo-assets/native-fixture-zh.vtt',
  note: '原创色板/时间码条纹/几何圆环；无第三方媒体、无气衡流程演示',
} as const

export type PlayAction = 'none' | 'pause-old' | 'error'

/**
 * M24 C · 播放请求结果判定（纯函数，可窄测）：
 * - resolved：请求身份与当前一致 → 生效(none)；不一致（已被 pause/src 换入/卸载/他者抢）→ pause-old。
 * - rejected：身份不一致 → 忽略(none)；AbortError（用户取消/被打断）→ none；其余 decode/network → error。
 * 以请求身份 token 为准，天然 latest-wins；不让迟到 promise 污染新实例。
 */
export function playResultAction(
  status: 'resolved' | 'rejected',
  requestIntent: number,
  currentIntent: number,
  errName?: string,
): PlayAction {
  if (status === 'resolved') return requestIntent === currentIntent ? 'none' : 'pause-old'
  if (requestIntent !== currentIntent) return 'none'
  if (errName === 'AbortError') return 'none'
  return 'error'
}

export default function NativeDemoPlayer(props: NativeDemoPlayerProps) {
  const { assetId, src, poster, captions, events, label, activeId, onActiveChange, onRetry, footnote, fixtureBadge, controller } = props
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [metaReady, setMetaReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const [progress, setProgress] = useState(0)
  const [errored, setErrored] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const [inView, setInView] = useState(true)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [captionsOn, setCaptionsOn] = useState(true)
  const [captionsErr, setCaptionsErr] = useState(false)
  const [captionsLoading, setCaptionsLoading] = useState(false)
  const [captionsKey, setCaptionsKey] = useState(0)
  const trackRef = useRef<HTMLTrackElement | null>(null)

  // M24 C · 协调器（共享或自建）：owner/intent/desired 集中，明确接管与陈旧事件分离。
  const ctrlRef = useRef<PlaybackController | null>(null)
  if (!ctrlRef.current) ctrlRef.current = controller ?? createPlaybackController()
  const ctrl = ctrlRef.current
  const assetIdRef = useRef(assetId); assetIdRef.current = assetId
  const activeIdRef = useRef(activeId); activeIdRef.current = activeId
  const inViewRef = useRef(true)
  const pendingRef = useRef(false)
  const onActiveChangeRef = useRef(onActiveChange); onActiveChangeRef.current = onActiveChange
  const assetKey = `${assetId}:${src ?? ''}:${retryNonce}`

  // 协调器 active → 宿主 onActiveChange（单一来源）。
  useEffect(() => ctrl.subscribe((a) => onActiveChangeRef.current?.(a)), [ctrl])
  // 错误回调（AbortError 由协调器过滤）。
  const handleFatalError = useCallback(() => { pendingRef.current = false; setPlaying(false); setErrored(true) }, [])
  useEffect(() => ctrl.onError(assetId, handleFatalError), [ctrl, assetId, handleFatalError])

  // src/assetId/retry 换入或卸载：重置本实例状态 + 失效旧 intent + 释放（不清他者）。
  useEffect(() => {
    ctrl.setElement(assetId, videoRef.current)
    setMetaReady(false); setPlaying(false); setEnded(false); setProgress(0); setErrored(false); setCaptionsErr(false); setCaptionsLoading(false); pendingRef.current = false
    return () => { ctrl.setElement(assetId, null) }
  }, [ctrl, assetKey, assetId])

  // 原生track load/error是不冒泡事件，直接订阅真实track，按实例清理。
  const captionsOnRef = useRef(captionsOn); captionsOnRef.current = captionsOn
  useEffect(() => {
    const track = trackRef.current
    if (!track || !captions) { setCaptionsLoading(false); return }
    let alive = true
    const loaded = () => {
      if (!alive || track !== trackRef.current) return
      if (track.track) track.track.mode = captionsOnRef.current ? 'showing' : 'hidden'
      setCaptionsErr(false); setCaptionsLoading(false)
    }
    const failed = () => {
      if (!alive || track !== trackRef.current) return
      setCaptionsErr(true); setCaptionsLoading(false)
    }
    track.addEventListener('load', loaded)
    track.addEventListener('error', failed)
    if (track.readyState === 2) loaded()
    else if (track.readyState === 3) failed()
    else { setCaptionsErr(false); setCaptionsLoading(true) }
    return () => {
      alive = false
      track.removeEventListener('load', loaded)
      track.removeEventListener('error', failed)
    }
  }, [assetKey, captions, captionsKey, errored])

  // 他者 owner（宿主 activeId）：暂停本实例（协调器亦在共享时处理；此处兜底）。
  useEffect(() => {
    if (activeId != null && activeId !== assetId) ctrl.requestPause(assetId)
  }, [ctrl, activeId, assetId])

  // 离屏：暂停、不自动续播。
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => {
      const vis = es[0]?.isIntersecting ?? true
      setInView(vis); inViewRef.current = vis
      if (!vis) ctrl.requestPause(assetId)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [ctrl, assetKey, assetId])

  const requestPlay = useCallback(() => { pendingRef.current = true; ctrl.requestPlay(assetIdRef.current) }, [ctrl])
  const requestPause = useCallback(() => { pendingRef.current = false; ctrl.requestPause(assetIdRef.current) }, [ctrl])

  const onLoadedMetadata = useCallback(() => { const v = videoRef.current; setMetaReady(true); setProgress(0); setCurrentTime(0); setDuration(v?.duration && isFinite(v.duration) ? v.duration : 0) }, [])
  const onPlay = useCallback(() => {
    // 原生 play 只在协调器认领时生效；否则立即暂停（陈旧不认领；不写 playing）。
    if (!ctrl.notifyNativePlay(assetIdRef.current) || !inViewRef.current) { videoRef.current?.pause(); return }
    pendingRef.current = false
    setPlaying(true); setEnded(false)
  }, [ctrl])
  const onPause = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    if (v !== videoRef.current) return // 旧元素事件不写新 UI
    ctrl.notifyNativePause(assetIdRef.current)
    // 仅真正暂停（v.paused=true；含实际 ended）才更新 UI；陈旧 pause（新一轮播放中 v.paused=false）不改 UI。
    if (v.paused) { pendingRef.current = false; setPlaying(false) }
  }, [ctrl])
  const onEnded = useCallback(() => { pendingRef.current = false; ctrl.notifyNativeEnded(assetIdRef.current); setPlaying(false); setEnded(true) }, [ctrl])
  const onTimeUpdate = useCallback(() => { const v = videoRef.current; if (!v) return; if (v.duration > 0) setProgress(v.currentTime / v.duration); setCurrentTime(v.currentTime) }, [])

  const replay = useCallback(() => { const v = videoRef.current; if (!v) return; v.currentTime = 0; setEnded(false); requestPlay() }, [requestPlay])
  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    // pending（未真正 playing）或 playing → 取消/暂停；否则发起播放（明确意图，可接管）。
    if (v.paused && !pendingRef.current) requestPlay()
    else requestPause()
  }, [requestPlay, requestPause])
  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current
    if (!v || !isFinite(v.duration) || v.duration <= 0) return
    v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + delta))
    setCurrentTime(v.currentTime)
  }, [])
  const seekTo = useCallback((t: number) => {
    const v = videoRef.current
    if (!v || !isFinite(v.duration) || v.duration <= 0) return
    v.currentTime = Math.min(v.duration, Math.max(0, t))
    setCurrentTime(v.currentTime)
  }, [])
  const toggleCaptions = useCallback(() => {
    setCaptionsOn((on) => {
      const next = !on
      const v = videoRef.current
      const tracks = v?.textTracks
      if (tracks && tracks.length) tracks[0].mode = next ? 'showing' : 'hidden'
      return next
    })
  }, [])
  const onCtrlKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-5) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(5) }
    else if (e.key === 'Home') { e.preventDefault(); seekTo(0) }
    else if (e.key === 'End') { e.preventDefault(); seekTo(duration) }
  }, [seekBy, seekTo, duration])
  const fmt = (t: number) => { const s0 = Math.max(0, Math.floor(t)); const m = Math.floor(s0 / 60); const ss = String(s0 % 60).padStart(2, '0'); return `${m}:${ss}` }
  const retry = useCallback(() => { setErrored(false); setMetaReady(false); setRetryNonce((n) => n + 1); onRetry?.() }, [onRetry])

  const hasSrc = !!src
  const ph = nativePhaseFor(hasSrc, errored, metaReady, playing, ended)

  return (
    <div ref={wrapRef} className={`u-w1-natdemo u-w1-natdemo--${ph}`} data-asset-id={assetId} data-in-view={String(inView)}>
      <header className="u-w1-demo__head">
        <h4 className="u-w1-demo__label">{label}</h4>
        <span className="u-w1-demo__badge">产品演示</span>
      </header>

      <div className="u-w1-natdemo__stage">
        {ph === 'pending' ? (
          <div className="u-w1-demo__pending">
            <p className="u-w1-demo__pending-title">暂无演示 · 待接入</p>
            <p className="u-w1-demo__pending-sub">未接入正式演示资产前不提供占位播放。</p>
          </div>
        ) : ph === 'error' ? (
          <>
            {poster ? <img className="u-w1-natdemo__poster" src={poster} alt="" aria-hidden="true" /> : null}
            <div className="u-w1-demo__error">
              <p className="u-w1-demo__pending-title">演示加载失败</p>
              <p className="u-w1-demo__pending-sub">媒体解码或网络失败；poster 已保留，可重试。</p>
              <button type="button" className="u-w1-demo__retry u-glow" onClick={retry}>
                重试
              </button>
            </div>
          </>
        ) : (
          <video
            key={assetKey}
            ref={videoRef}
            className="u-w1-natdemo__video"
            src={src}
            poster={poster}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={onLoadedMetadata}
            onPlay={onPlay}
            onPause={onPause}
            onEnded={onEnded}
            onTimeUpdate={onTimeUpdate}
            onError={(e) => { if (e.target !== e.currentTarget || e.currentTarget !== videoRef.current) return; ctrl.notifyError(assetIdRef.current); handleFatalError() }}
          >
            {captions ? (
              <track
                key={captionsKey}
                ref={trackRef}
                kind="captions"
                src={captions}
                label="字幕"
                srcLang="zh-CN"
                default


              />
            ) : null}
          </video>
        )}
      </div>

      {ph !== 'pending' && ph !== 'error' ? (
        <div className="u-w1-natdemo__ctrl" tabIndex={0} role="group" aria-label="播放控制（←/→ 5 秒，Home/End）" onKeyDown={onCtrlKeyDown}>
          <button type="button" className="u-w1-demo__retry u-glow" onClick={() => seekBy(-5)} aria-label="后退 5 秒">⏪5s</button>
          <button type="button" className="u-w1-demo__retry u-glow" onClick={togglePlay}>
            {playing ? '暂停' : '播放'}
          </button>
          <button type="button" className="u-w1-demo__retry u-glow" onClick={() => seekBy(5)} aria-label="前进 5 秒">5s⏩</button>
          <button type="button" className="u-w1-demo__retry u-glow" onClick={replay}>
            重播
          </button>
          {captions ? (
            captionsLoading ? (
              <button type="button" className="u-w1-demo__retry u-glow" disabled>字幕加载中…</button>
            ) : captionsErr ? (
              <button type="button" className="u-w1-demo__retry u-glow" onClick={() => { setCaptionsLoading(true); setCaptionsKey((k) => k + 1) }}>
                字幕失效 · 重试
              </button>
            ) : (
              <button type="button" className="u-w1-demo__retry u-glow" aria-pressed={captionsOn} onClick={toggleCaptions}>
                字幕{captionsOn ? '开' : '关'}
              </button>
            )
          ) : null}
          <span className="u-w1-natdemo__pct" aria-live="off">
            {fmt(currentTime)} / {fmt(duration)} · 进度 {Math.round(progress * 100)}%
          </span>
        </div>
      ) : null}

      <details className="u-w1-demo__events qh-note-details">
        <summary>事件时间表（{events.length}）</summary>
        <ol className="u-w1-demo__event-list">
          {events.map((e, i) => (
            <li key={i} className="u-w1-demo__event">
              <span className="u-w1-demo__event-at">{e.at}</span>
              <span className="u-w1-demo__event-label">{e.label}</span>
            </li>
          ))}
        </ol>
      </details>
      {fixtureBadge ? <p className="u-w1-natdemo__fixture">{fixtureBadge}</p> : null}
      {footnote ? <p className="u-w1-demo__footnote">{footnote}</p> : null}
    </div>
  )
}
