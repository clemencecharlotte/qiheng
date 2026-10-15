import type { Unit } from './types'

export const FIXED_SEED = 20260929

export const SYNTHETIC_BANNER = '合成演示数据（固定种子），非生产实测'

export const UNITS: Unit[] = [
  {
    id: 'AC-01',
    name: '1# 螺杆空压机',
    kind: 'screw',
    ratedCapacity: 20,
    minLoadRatio: 0.4,
    ratedPower: 132,
    unloadPowerRatio: 0.25,
    minStartStopInterval: 10,
    surgeBoundaryVerified: true,
  },
  {
    id: 'AC-02',
    name: '2# 螺杆空压机',
    kind: 'screw',
    ratedCapacity: 12,
    minLoadRatio: 0.35,
    ratedPower: 90,
    unloadPowerRatio: 0.28,
    minStartStopInterval: 8,
    surgeBoundaryVerified: true,
  },
  {
    id: 'AC-03',
    name: '3# 离心空压机',
    kind: 'centrifugal',
    ratedCapacity: 40,
    minLoadRatio: 0.7,
    ratedPower: 250,
    unloadPowerRatio: 0.15,
    minStartStopInterval: 20,
    surgeBoundaryVerified: false,
  },
]

export const UNITS_BY_ID: Record<string, Unit> = Object.fromEntries(
  UNITS.map((u) => [u.id, u]),
)

export const PRIORITY_ORDER = ['AC-01', 'AC-02', 'AC-03']

export function minCapacity(unit: Unit): number {
  return unit.ratedCapacity * unit.minLoadRatio
}