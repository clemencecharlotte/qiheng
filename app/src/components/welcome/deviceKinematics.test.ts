import { describe, expect, it } from 'vitest'
import {
  MECH_PERIOD, pistonPose, screwPose, screwChamberVolume, centrifugalPose, tankPose,
  dryerPose, adsorberPose, filterPose, valvePose, poseFor, phaseForHostIndex,
  PISTON_ROD_RATIO, TANK_DRAIN_PERIOD,
} from './deviceKinematics'

/** r41 · 机构运动学单测：物理关联与阶段机正确性（纯函数层，不冒充视觉验收）。 */
const sample = <T>(period: number, n: number, f: (t: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => f((i / n) * period))

describe('piston crank-slider kinematics', () => {
  it('crank angle drives piston travel through the exact slider-crank relation', () => {
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * MECH_PERIOD.piston
      const p = pistonPose(t)
      const th = (p.crankDeg * Math.PI) / 180
      const r = 1, l = PISTON_ROD_RATIO
      const x = r * Math.cos(th) + Math.sqrt(l * l - r * r * Math.sin(th) ** 2)
      expect(p.pistonTravel).toBeCloseTo((r + l - x) / (2 * r), 9)
      expect(p.rodDeg).toBeCloseTo((Math.asin((r * Math.sin(th)) / l) * 180) / Math.PI, 9)
    }
  })
  it('valve phases are synchronised with the stroke, never independent', () => {
    const P = MECH_PERIOD.piston
    expect(pistonPose(0).intakeLift).toBe(0)                 // TDC：两阀关
    expect(pistonPose(P * 0.25).intakeLift).toBeGreaterThan(0.9) // 吸气冲程进气阀开
    expect(pistonPose(P * 0.25).exhaustLift).toBe(0)
    const mid = pistonPose(P * (0.5 + 0.06))                 // 压缩窗：两阀关
    expect(mid.intakeLift).toBe(0)
    expect(mid.exhaustLift).toBe(0)
    expect(mid.compression).toBe(true)
    expect(pistonPose(P * 0.85).exhaustLift).toBeGreaterThan(0.5) // 排气冲程排气阀开
  })
  it('travel stays within [0,1] and rods stay physical', () => {
    for (const p of sample(MECH_PERIOD.piston, 96, pistonPose)) {
      expect(p.pistonTravel).toBeGreaterThanOrEqual(0)
      expect(p.pistonTravel).toBeLessThanOrEqual(1)
      expect(Math.abs(p.rodDeg)).toBeLessThan(20)
    }
  })
})

describe('screw / centrifugal', () => {
  it('screw rotors counter-rotate at the 4:6 mesh ratio and chambers shrink', () => {
    const p = screwPose(MECH_PERIOD.screw * 0.3)
    expect(p.femaleDeg).toBeCloseTo(-p.angleDeg * (4 / 6), 9)
    expect(p.chambers).toHaveLength(3)
    expect(screwChamberVolume(0)).toBeGreaterThan(screwChamberVolume(1))
  })
  it('centrifugal impeller spins while diffuser/volute flows advance independently of body', () => {
    const a = centrifugalPose(0.7), b = centrifugalPose(1.4)
    expect(a.impellerDeg).not.toBe(b.impellerDeg)
    expect(a.diffuserFlow).toBeGreaterThanOrEqual(0)
    expect(a.diffuserFlow).toBeLessThan(1)
  })
})

describe('tank pressure buffer (not a level)', () => {
  it('pressure oscillates around setpoint and the needle follows', () => {
    for (const p of sample(MECH_PERIOD.tank, 64, tankPose)) {
      expect(p.pressure).toBeGreaterThan(0.35)
      expect(p.pressure).toBeLessThan(0.9)
      expect(p.needleDeg).toBeCloseTo(-50 + 100 * p.pressure, 9)
    }
  })
  it('drain is an independent bottom process, mostly closed', () => {
    let open = 0
    for (let t = 0; t < TANK_DRAIN_PERIOD; t += 0.05) if (tankPose(t).drainOpen > 0) open++
    expect(open).toBeGreaterThan(0)
    expect(open).toBeLessThan(200 * 0.2)
  })
})

describe('dryer / adsorber / filter / valve', () => {
  it('dryer droplet grows then drains intermittently', () => {
    const P = MECH_PERIOD.dryer
    expect(dryerPose(P * 0.4).droplet).toBeGreaterThan(dryerPose(P * 0.1).droplet)
    expect(dryerPose(P * 0.9).drainOpen).toBeGreaterThan(0)
    expect(dryerPose(P * 0.3).drainOpen).toBe(0)
  })
  it('adsorber cycles A-adsorb → equalize → B-adsorb → equalize with continuous dry outlet', () => {
    const stages = new Set(sample(MECH_PERIOD.adsorber, 200, (t) => adsorberPose(t).stage))
    expect(stages).toEqual(new Set(['A-adsorb', 'equalize-ab', 'B-adsorb', 'equalize-ba']))
    for (const p of sample(MECH_PERIOD.adsorber, 50, adsorberPose)) {
      expect(p.dryOut).toBeGreaterThanOrEqual(0)
      expect(p.dryOut).toBeLessThan(1)
    }
  })
  it('filter dp rises with loading inside a cycle and flow slows', () => {
    const P = MECH_PERIOD.filter
    const a = filterPose(P * 0.1), b = filterPose(P * 0.7)
    expect(b.dp).toBeGreaterThan(a.dp)
    expect(b.trapped).toBeGreaterThan(a.trapped)
  })
  it('valve opening bounds and ball angle coupling', () => {
    for (const v of sample(MECH_PERIOD.valve, 64, valvePose)) {
      expect(v.opening).toBeGreaterThanOrEqual(0.06)
      expect(v.opening).toBeLessThanOrEqual(0.96)
      expect(v.ballDeg).toBeCloseTo(v.opening * 90, 9)
    }
  })
})

describe('clock semantics', () => {
  // 主物理字段按各自周期严格周期；dash 流相位是连续视觉流，不要求整周期回环。
  const PRIMARY: Record<string, string[]> = {
    screw: ['angleDeg', 'femaleDeg', 'chambers'],
    centrifugal: ['impellerDeg', 'diffuserFlow', 'voluteFlow'],
    piston: ['crankDeg', 'pistonTravel', 'rodDeg', 'intakeLift', 'exhaustLift', 'compression'],
    tank: ['pressure', 'needleDeg'],
    dryer: ['droplet', 'drainOpen'],
    adsorber: ['stage', 'adsorb', 'inStage'],
    filter: ['load', 'dp', 'trapped'],
    valve: ['opening', 'ballDeg', 'branch'],
  }
  const pick = (o: unknown, keys: string[]) => keys.map((k) => (o as Record<string, unknown>)[k])
  const close = (a: unknown, b: unknown): boolean => {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => close(x, b[i]))
    if (typeof a === 'string' && typeof b === 'string') return a === b
    if (typeof a === 'boolean' && typeof b === 'boolean') return a === b
    return false
  }
  it('primary physical fields are periodic and deterministic per type', () => {
    for (const t of Object.keys(MECH_PERIOD) as (keyof typeof MECH_PERIOD)[]) {
      const P = MECH_PERIOD[t]
      expect(close(pick(poseFor(t, 3.3).v, PRIMARY[t]), pick(poseFor(t, 3.3 + P).v, PRIMARY[t])), `${t} periodic`).toBe(true)
      expect(close(pick(poseFor(t, 3.3).v, PRIMARY[t]), pick(poseFor(t, 3.3).v, PRIMARY[t])), `${t} deterministic`).toBe(true)
    }
  })
  it('host index seek maps to a deterministic phase', () => {
    expect(phaseForHostIndex(4)).toBeCloseTo(4.8, 9)
    expect(phaseForHostIndex(0)).toBe(0)
  })
})
