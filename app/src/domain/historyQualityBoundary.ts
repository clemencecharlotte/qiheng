import { HISTORY_START_MINUTE, type HistoryFixture, type MinuteSample } from './history'

/**
 * B05b2 合成历史回放的独立数据质量边界（聚合前验证）。
 * 只读、防御性；不接真实文件/调度输入/生产控制；不修改任何源数据。
 */

export type BoundaryCode =
  | 'MISSING_FIELD'
  | 'NON_FINITE_VALUE'
  | 'NEGATIVE_VALUE'
  | 'BAD_TIMESTAMP'
  | 'DUPLICATE_SAMPLE'
  | 'UNKNOWN_MACHINE'
  | 'MINUTE_INCONSISTENT'
  | 'MISSING_FLOW'
  | 'UNIT_MISMATCH'
  | 'FIXTURE_INVALID'

export const BOUNDARY_CODE_META: Record<BoundaryCode, { label: string; severity: 'invalid' }> = {
  MISSING_FIELD: { label: '必需字段缺失', severity: 'invalid' },
  NON_FINITE_VALUE: { label: '非有限数值（NaN/±Infinity）', severity: 'invalid' },
  NEGATIVE_VALUE: { label: '负值', severity: 'invalid' },
  BAD_TIMESTAMP: { label: '时间戳非法/错序/越窗', severity: 'invalid' },
  DUPLICATE_SAMPLE: { label: '同机组同分钟重复样本', severity: 'invalid' },
  UNKNOWN_MACHINE: { label: '未知机组', severity: 'invalid' },
  MINUTE_INCONSISTENT: { label: 'minuteOfDay 与 minuteIndex 不一致', severity: 'invalid' },
  MISSING_FLOW: { label: '流量缺值', severity: 'invalid' },
  UNIT_MISMATCH: { label: '单位合同冲突', severity: 'invalid' },
  FIXTURE_INVALID: { label: '夹具无法定位/整体无效', severity: 'invalid' },
}

export interface SyntheticHistoryUnits {
  flow: 'm³/min'
  stationTotalFlow: 'm³/min'
  pressure: 'MPa'
  power: 'kW'
}

/** 仅已知合成 builder 可声明的 canonical 单位合同。 */
export const SYNTHETIC_HISTORY_UNITS: SyntheticHistoryUnits = {
  flow: 'm³/min',
  stationTotalFlow: 'm³/min',
  pressure: 'MPa',
  power: 'kW',
}

export interface SampleIssue {
  sampleIndex: number
  machineId: string | null
  minuteIndex: number | null
  codes: BoundaryCode[]
}

export interface FixtureBoundaryReport {
  /** 全部样本可定位且无结构性问题。 */
  ok: boolean
  /** 存在无法定位（未知机组/无合法分钟）→ 整体显式 invalid。 */
  fixtureInvalid: boolean
  fixtureReasons: BoundaryCode[]
  sampleIssues: SampleIssue[]
  /** machineId -> (minuteIndex -> firstSampleIndex)；重复另记 issue。 */
  uniqueByMachineMinute: Map<string, Map<number, number>>
  units: SyntheticHistoryUnits
}

const STATES = new Set(['running', 'stopped', 'unknown'])

function isSafeNonNegInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

function checkNum(
  v: unknown,
  codes: BoundaryCode[],
  missingCode: BoundaryCode = 'MISSING_FIELD',
): boolean {
  if (v === undefined) {
    codes.push(missingCode)
    return false
  }
  if (v === null) return true // 允许显式 null（缺值），由调用方按字段语义判定
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    codes.push('NON_FINITE_VALUE')
    return false
  }
  if (v < 0) {
    codes.push('NEGATIVE_VALUE')
    return false
  }
  return true
}

export interface ValidateOptions {
  units?: SyntheticHistoryUnits
}

/**
 * 聚合前独立验证 HistoryFixture 与每条 MinuteSample：
 * 必需键/已知 machineId/state、时间有限安全整数且在窗口、minuteOfDay 与 minuteIndex 一致；
 * 每机内时间严格顺序、machineId+minuteIndex 唯一；跨机同分钟合法；数值有限非负；
 * stationTotalFlow 有限非负；单位合同可显式传入，冲突拒绝。
 * 非法/无法定位条目保留原索引/原因；不抛异常、不滤掉后假 PASS。
 */
export function validateHistoryFixture(
  fixture: HistoryFixture,
  opts: ValidateOptions = {},
): FixtureBoundaryReport {
  const units = opts.units ?? SYNTHETIC_HISTORY_UNITS
  const fixtureReasons: BoundaryCode[] = []
  const knownMachines = new Set((fixture.machines ?? []).map((m) => m.id))
  const window = isSafeNonNegInteger(fixture.minuteCount) ? fixture.minuteCount : 0
  const uniqueByMachineMinute = new Map<string, Map<number, number>>()
  const sampleIssues: SampleIssue[] = []
  let fixtureInvalid = false

  if (opts.units) {
    // 若未来接入方声明单位，必须与合成合同完全一致；未知/冲突拒绝。
    const u = opts.units
    if (
      u.flow !== SYNTHETIC_HISTORY_UNITS.flow ||
      u.stationTotalFlow !== SYNTHETIC_HISTORY_UNITS.stationTotalFlow ||
      u.pressure !== SYNTHETIC_HISTORY_UNITS.pressure ||
      u.power !== SYNTHETIC_HISTORY_UNITS.power
    ) {
      fixtureReasons.push('UNIT_MISMATCH')
      fixtureInvalid = true
    }
  }
  // 若夹具自带 units 字段（未来 ingest），与合同冲突则拒绝。
  const claimed = (fixture as unknown as { units?: Partial<SyntheticHistoryUnits> }).units
  if (claimed) {
    if (
      (claimed.flow !== undefined && claimed.flow !== units.flow) ||
      (claimed.stationTotalFlow !== undefined && claimed.stationTotalFlow !== units.stationTotalFlow) ||
      (claimed.pressure !== undefined && claimed.pressure !== units.pressure) ||
      (claimed.power !== undefined && claimed.power !== units.power)
    ) {
      fixtureReasons.push('UNIT_MISMATCH')
      fixtureInvalid = true
    }
  }

  const lastMinuteByMachine = new Map<string, number>()

  for (let i = 0; i < fixture.samples.length; i += 1) {
    const s = fixture.samples[i] as Partial<MinuteSample>
    const codes: BoundaryCode[] = []

    if (typeof s.machineId !== 'string' || s.machineId === '' || !knownMachines.has(s.machineId)) {
      codes.push('UNKNOWN_MACHINE')
      fixtureInvalid = true
    }
    if (s.state === undefined) codes.push('MISSING_FIELD')
    else if (!STATES.has(s.state as string)) codes.push('MISSING_FIELD')

    if (!isSafeNonNegInteger(s.minuteIndex) || !isSafeNonNegInteger(s.minuteOfDay)) {
      codes.push('BAD_TIMESTAMP')
      fixtureInvalid = true
    } else {
      if (s.minuteIndex >= window) codes.push('BAD_TIMESTAMP')
      if (s.minuteOfDay !== HISTORY_START_MINUTE + s.minuteIndex) codes.push('MINUTE_INCONSISTENT')
      const last = lastMinuteByMachine.get(s.machineId as string)
      if (last !== undefined && s.minuteIndex <= last) codes.push('BAD_TIMESTAMP')
      lastMinuteByMachine.set(s.machineId as string, s.minuteIndex)
    }

    // 数值字段：有限非负，显式 null 允许（语义由字段决定）
    const flowOk = checkNum(s.flow, codes)
    const pressureOk = checkNum(s.pressure, codes)
    const powerOk = checkNum(s.power, codes)
    checkNum(s.stationTotalFlow, codes)
    if (flowOk && s.flow === null) codes.push('MISSING_FLOW')

    if (typeof s.machineId === 'string' && isSafeNonNegInteger(s.minuteIndex)) {
      const m = uniqueByMachineMinute.get(s.machineId) ?? new Map<number, number>()
      if (m.has(s.minuteIndex)) codes.push('DUPLICATE_SAMPLE')
      else m.set(s.minuteIndex, i)
      uniqueByMachineMinute.set(s.machineId, m)
    } else {
      fixtureInvalid = true
    }
    void flowOk
    void pressureOk
    void powerOk

    if (codes.length) {
      sampleIssues.push({
        sampleIndex: i,
        machineId: typeof s.machineId === 'string' ? s.machineId : null,
        minuteIndex: isSafeNonNegInteger(s.minuteIndex) ? s.minuteIndex : null,
        codes,
      })
    }
  }

  return {
    ok: sampleIssues.length === 0 && !fixtureInvalid,
    fixtureInvalid,
    fixtureReasons,
    sampleIssues,
    uniqueByMachineMinute,
    units,
  }
}

/** 有限非负有效数值（null/NaN/Infinity/负值均不算）。 */
export function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/** 某个 machineId 在桶内的唯一有效分钟集合（按 minuteIndex 去重）。 */
export function uniqueMinuteIndices(fixture: HistoryFixture, machineId: string, start: number, end: number): Set<number> {
  const set = new Set<number>()
  for (const s of fixture.samples) {
    if (s.machineId === machineId && isFiniteNonNegative(s.minuteIndex) && s.minuteIndex >= start && s.minuteIndex < end) {
      set.add(s.minuteIndex)
    }
  }
  return set
}
