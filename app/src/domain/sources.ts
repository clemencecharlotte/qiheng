export type SourceId = 'synthetic_schedule' | 'synthetic_history'

export type SourceScope = 'schedule' | 'history' | 'both'

export function sourceIdsForScope(scope: SourceScope): SourceId[] {
  if (scope === 'schedule') return ['synthetic_schedule']
  if (scope === 'history') return ['synthetic_history']
  return ['synthetic_schedule', 'synthetic_history']
}

export interface DataSourceMeta {
  id: SourceId
  label: string
  kind: '调度示例（合成）' | '回放夹具（合成）'
  synthetic: true
  scope: string
  units: string
  unitsNote: string
  unverifiedBoundaries: string[]
  readOnly: boolean
}

export const DATA_SOURCES: Record<SourceId, DataSourceMeta> = {
  synthetic_schedule: {
    id: 'synthetic_schedule',
    label: '合成调度示例',
    kind: '调度示例（合成）',
    synthetic: true,
    scope: '24h × 15min 需求序列与 3 台机组（两螺杆 + 一离心）',
    units: 'AC-01 螺杆、AC-02 螺杆、AC-03 离心',
    unitsNote:
      '调度示例的机组档案与回放夹具完全分开；AC-03 离心因喘振边界未核实被排除出自动调度候选。',
    unverifiedBoundaries: [
      '压力合格率、喘振预警率、节能率、停机下降率：未验证',
      '估算耗电为模型推算，非现场实测能耗',
      '不连接真实 PLC/SCADA',
    ],
    readOnly: false,
  },
  synthetic_history: {
    id: 'synthetic_history',
    label: '合成回放夹具',
    kind: '回放夹具（合成）',
    synthetic: true,
    scope: '两台离心机只读分钟数据与 15 分钟聚合',
    units: 'C-01 离心（档案）、C-02 离心（档案）',
    unitsNote:
      '合成回放夹具，不是主办方数据或现场实测；与调度示例的两螺杆 + 一离心完全分开。只读回放，绝不进入调度候选或产生启停指令。',
    unverifiedBoundaries: [
      '官方两台离心机喘振边界与启停边界未核实，故 C-01/C-02 只读回放',
      '质量分级仅对合成夹具内建异常规则，不代表现场数据质量水平',
      '历史功率积分为合成积算，非结算口径',
    ],
    readOnly: true,
  },
}

export const SCHEDULE_CENTRIFUGAL_EXCLUSION_NOTE =
  '离心机喘振边界未经核实：同步调度侧 AC-03，回放侧 C-01/C-02，均不得进入调度候选或产生启停指令。'