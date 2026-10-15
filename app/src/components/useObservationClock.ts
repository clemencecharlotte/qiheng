import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { advanceReplay } from './replayMode'
import { bindMechSource } from './welcome/mechClock'
import {
  BASE_TICK_MS,
  beginBrush as beginBrushPure,
  cancelBrush as cancelBrushPure,
  clockSignature,
  effectiveIndex as effectiveIndexPure,
  endBrush as endBrushPure,
  followPlayback as followPlaybackPure,
  initialExploreState,
  isTimeLocked,
  labelAt,
  lockTime as lockTimePure,
  moveBrush as moveBrushPure,
  newBucketsSinceLock,
  pause,
  resetExploreState,
  setHoverIndex,
  setSpeed as setSpeedPure,
  stepTransport,
  togglePlaying as togglePlayingPure,
  type EndBrushResult,
  type ExploreState,
  type PlaySpeed,
  type TimelineClock,
} from '../domain/explore'

export interface ObservationClockApi {
  clock: TimelineClock
  state: ExploreState
  effectiveIndex: number
  locked: boolean
  newBuckets: number
  observationLabel: string
  hoverIndex: number | null
  range: [number, number] | null
  setPlaying: (value: boolean) => void
  toggle: () => void
  setSpeed: (speed: PlaySpeed) => void
  step: (delta: number) => void
  lockIndex: (index: number) => void
  follow: () => void
  hover: (index: number | null) => void
  beginBrush: (index: number) => void
  moveBrush: (index: number) => void
  endBrush: (index: number) => EndBrushResult
  cancelBrush: () => void
  setRange: (range: [number, number] | null) => void
  resetExplore: () => void
  /** M29 r31 · 展示层循环（默认 true，但不自动播放）。 */
  looping: boolean
  setLooping: (v: boolean) => void
}

/**
 * 共享观察时钟：播放运输、时间锁、临时 hover、刷选范围。
 * 同一来源（clock 签名）在组件生命周期内保持；签名变化（切来源 / 时轴）才重置。
 */
export function useObservationClock(
  clock: TimelineClock,
  initialIndex = 0,
): ObservationClockApi {
  const [state, setState] = useState<ExploreState>(() =>
    initialExploreState(clock, initialIndex),
  )
  const clockRef = useRef(clock)
  clockRef.current = clock
  const [looping, setLoopingState] = useState(true)
  const loopingRef = useRef(looping)
  loopingRef.current = looping

  const signature = clockSignature(clock)
  const signatureRef = useRef(signature)
  useEffect(() => {
    if (signatureRef.current === signature) return
    signatureRef.current = signature
    setState(initialExploreState(clockRef.current, initialIndex))
  }, [signature, initialIndex])

  const playing = state.playing
  const speed = state.speed
  useEffect(() => {
    if (!playing) return
    const interval = Math.max(60, Math.round(BASE_TICK_MS / speed))
    const id = setInterval(() => {
      setState((prev) => advanceReplay(clockRef.current, prev, loopingRef.current))
    }, interval)
    return () => clearInterval(id)
  }, [playing, speed, signature, looping])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      if (document.hidden) setState((prev) => pause(prev))
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const effective = effectiveIndexPure(state)
  const locked = isTimeLocked(state)
  const newBuckets = newBucketsSinceLock(state)

  // r43 · 机构相位时钟唯一写者上移到共享时钟钩子：序幕/控制台同一路由树内真实消费。
  // 此前仅 DeviceSystemExperience 绑定：进控制台卸载即 bind null，机构全链路静止（线上视觉实证）。
  // 仅调度时钟绑定（history 实例不写），保持单一写者合同。
  useEffect(() => {
    if (clock.sourceId !== 'synthetic_schedule') return
    bindMechSource({ playing, speed, index: effective })
    return () => bindMechSource(null)
  }, [clock.sourceId, playing, speed, effective])

  const setPlaying = useCallback((value: boolean) => {
    setState((prev) => (prev.playing === value ? prev : { ...prev, playing: value }))
  }, [])
  const toggle = useCallback(() => {
    setState((prev) => togglePlayingPure(clockRef.current, prev))
  }, [])
  const setSpeed = useCallback((next: PlaySpeed) => {
    setState((prev) => setSpeedPure(prev, next))
  }, [])
  const step = useCallback((delta: number) => {
    setState((prev) => stepTransport(clockRef.current, prev, delta))
  }, [])
  const lockIndex = useCallback((index: number) => {
    setState((prev) => lockTimePure(clockRef.current, prev, index))
  }, [])
  const follow = useCallback(() => {
    setState((prev) => followPlaybackPure(prev))
  }, [])
  const hover = useCallback((index: number | null) => {
    setState((prev) => setHoverIndex(clockRef.current, prev, index))
  }, [])
  const beginBrush = useCallback((index: number) => {
    setState((prev) => beginBrushPure(clockRef.current, prev, index))
  }, [])
  const moveBrush = useCallback((index: number) => {
    setState((prev) => moveBrushPure(clockRef.current, prev, index))
  }, [])
  const endBrush = useCallback(
    (index: number): EndBrushResult => {
      const result = endBrushPure(clockRef.current, state, index)
      setState(result.state)
      return result
    },
    [state],
  )
  const cancelBrush = useCallback(() => {
    setState((prev) => cancelBrushPure(prev))
  }, [])
  const setRange = useCallback((range: [number, number] | null) => {
    setState((prev) => ({ ...prev, range, hoverIndex: null }))
  }, [])
  const resetExplore = useCallback(() => {
    setState((prev) => resetExploreState(prev))
  }, [])

  return useMemo<ObservationClockApi>(
    () => ({
      clock,
      state,
      effectiveIndex: effective,
      locked,
      newBuckets,
      observationLabel: labelAt(clock, effective),
      hoverIndex: state.hoverIndex,
      range: state.range,
      setPlaying,
      toggle,
      setSpeed,
      step,
      lockIndex,
      follow,
      hover,
      beginBrush,
      moveBrush,
      endBrush,
      cancelBrush,
      setRange,
      resetExplore,
      looping,
      setLooping: setLoopingState,
    }),
    [
      clock,
      state,
      effective,
      locked,
      newBuckets,
      setPlaying,
      toggle,
      setSpeed,
      step,
      lockIndex,
      follow,
      hover,
      beginBrush,
      moveBrush,
      endBrush,
      cancelBrush,
      setRange,
      resetExplore,
      looping,
    ],
  )
}