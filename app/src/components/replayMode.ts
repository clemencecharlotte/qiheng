import { advance, type ExploreState, type TimelineClock } from '../domain/explore'

/** Presentation-only looping around the existing clock. Never changes a
 * selection, source, solver result, energy ledger or authorization. */
export function advanceReplay(clock: TimelineClock, state: ExploreState, looping: boolean): ExploreState {
  if (!state.playing) return state
  if (looping && clock.count > 1 && state.playIndex >= clock.count - 1) {
    return { ...state, playIndex: 0 }
  }
  return advance(clock, state).state
}
