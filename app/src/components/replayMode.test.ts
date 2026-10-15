import { expect, it } from 'vitest'
import { initialExploreState, type TimelineClock } from '../domain/explore'
import { advanceReplay } from './replayMode'

const clock: TimelineClock = { sourceId: 'synthetic_schedule', count: 4, stepMinutes: 15, startMinute: 0 }
it('wraps last real bucket to first without changing locked selection/range', () => {
  const state = { ...initialExploreState(clock, 3), playing: true, timeLock: 2, range: [1, 2] as [number, number] }
  const next = advanceReplay(clock, state, true)
  expect(next).toEqual({ ...state, playIndex: 0 })
  expect(next.range).toBe(state.range)
})
it('preserves existing end-pause behavior when looping is disabled', () => {
  const state = { ...initialExploreState(clock, 3), playing: true }
  expect(advanceReplay(clock, state, false)).toEqual({ ...state, playing: false })
})
it('does not restart paused playback', () => {
  const state = initialExploreState(clock, 3)
  expect(advanceReplay(clock, state, true)).toBe(state)
})
it('continues intermediate buckets without mutation', () => {
  const state = { ...initialExploreState(clock, 1), playing: true }
  expect(advanceReplay(clock, state, true).playIndex).toBe(2)
  expect(state.playIndex).toBe(1)
})
it('keeps source-specific history index semantics', () => {
  const history: TimelineClock = { sourceId: 'synthetic_history', count: 16, startMinute: 480, stepMinutes: 15 }
  const state = { ...initialExploreState(history, 15), playing: true }
  expect(advanceReplay(history, state, true).playIndex).toBe(0)
  expect(history.startMinute).toBe(480)
})
it('single-bucket clock pauses instead of an empty animation loop', () => {
  const single = { ...clock, count: 1 }
  const state = { ...initialExploreState(single), playing: true }
  expect(advanceReplay(single, state, true).playing).toBe(false)
})
