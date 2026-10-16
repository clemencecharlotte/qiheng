import { afterEach, expect, it } from 'vitest'
import { bindMechSource, mechPhaseNow } from './mechClock'
import { SECONDS_PER_HOST_INDEX } from './deviceKinematics'

afterEach(() => bindMechSource(null))
it('seeking moves the shared mechanism phase to the exact host index without inventing a timeline', () => {
  bindMechSource({ playing: false, speed: 1, index: 4 })
  expect(mechPhaseNow()).toBe(4 * SECONDS_PER_HOST_INDEX)
  bindMechSource({ playing: true, speed: 2, index: 17 })
  expect(mechPhaseNow()).toBe(17 * SECONDS_PER_HOST_INDEX)
  bindMechSource({ playing: false, speed: 1, index: 0 })
  expect(mechPhaseNow()).toBe(0)
})
