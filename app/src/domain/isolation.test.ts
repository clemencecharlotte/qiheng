import { describe, expect, it } from 'vitest'
import { runScenario } from './engine'
import { buildHistoryFixture, HISTORY_MACHINES } from './history'
import { evaluateUnits } from './engine'
import { DATA_SOURCES, SCHEDULE_CENTRIFUGAL_EXCLUSION_NOTE } from './sources'
import { createDisabledIngestAdapter, INGEST_DESCRIPTOR } from './ingest'
import { UNITS } from './units'

describe('来源隔离', () => {
  it('调度机组与回放夹具机组完全分开', () => {
    const scheduleIds = new Set(UNITS.map((u) => u.id))
    for (const machine of HISTORY_MACHINES) {
      expect(scheduleIds.has(machine.id)).toBe(false)
    }
    expect(UNITS.map((u) => u.id)).toEqual(['AC-01', 'AC-02', 'AC-03'])
    expect(HISTORY_MACHINES.map((m) => m.id)).toEqual(['C-01', 'C-02'])
  })

  it('回放夹具为只读且标注非主办方数据', () => {
    const fixture = buildHistoryFixture('fx_baseline')
    expect(fixture.readOnly).toBe(true)
    expect(fixture.note).toContain('不是主办方数据')
    expect(DATA_SOURCES.synthetic_history.readOnly).toBe(true)
    expect(DATA_SOURCES.synthetic_history.unitsNote).toContain('绝不进入调度候选')
  })

  it('离心机永不进入自动调度候选', () => {
    for (const scenario of ['normal', 'surge', 'unit_failure'] as const) {
      const run = runScenario(scenario)
      expect(run.evaluation.candidates.every((u) => u.kind === 'screw')).toBe(true)
    }
    const evaluation = evaluateUnits(UNITS, 'normal')
    expect(evaluation.candidates.map((u) => u.id)).toEqual(['AC-01', 'AC-02'])
    const ac03 = evaluation.eligibility.find((e) => e.unitId === 'AC-03')
    expect(ac03?.reason).toContain('喘振')
  })

  it('排除说明覆盖调度与回放两侧离心机', () => {
    expect(SCHEDULE_CENTRIFUGAL_EXCLUSION_NOTE).toContain('C-01')
    expect(SCHEDULE_CENTRIFUGAL_EXCLUSION_NOTE).toContain('AC-03')
  })

  it('未来数据接入接口为禁用状态且声明权限与格式', () => {
    const adapter = createDisabledIngestAdapter()
    expect(adapter.describe().status).toBe('disabled')
    expect(INGEST_DESCRIPTOR.formats).toContain('.csv')
    expect(INGEST_DESCRIPTOR.permissions.scopes).toContain('history:import')
    expect(INGEST_DESCRIPTOR.requiredColumns.map((c) => c.unit)).toContain('m³/min')
    expect(adapter.validateBundle({}).ok).toBe(false)
    expect(() => adapter.loadBundle({})).toThrow()
  })

  it('回放夹具不携带任何启停指令字段', () => {
    const fixture = buildHistoryFixture('fx_baseline')
    for (const sample of fixture.samples) {
      expect(Object.keys(sample)).not.toContain('command')
      expect(Object.keys(sample)).not.toContain('setpoint')
    }
  })
})