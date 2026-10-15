export interface IngestDescriptor {
  version: string
  status: 'disabled'
  formats: string[]
  requiredColumns: Array<{ name: string; unit: string; note: string }>
  permissions: {
    roles: string[]
    scopes: string[]
    notes: string[]
  }
  notInScopeThisRound: string
}

export const INGEST_DESCRIPTOR: IngestDescriptor = {
  version: 'v0-draft',
  status: 'disabled',
  formats: ['.csv', '.xlsx'],
  requiredColumns: [
    { name: 'machine_id', unit: '-', note: '设备唯一标识，需映射到档案' },
    { name: 'timestamp', unit: 'ISO-8601', note: '分钟级时间戳，允许秒级需向下取整' },
    { name: 'running_state', unit: '-', note: '仅接受 running/stopped/unknown' },
    { name: 'flow', unit: 'm³/min', note: '流量缺值留空，禁止填零' },
    { name: 'pressure', unit: 'MPa', note: '压力缺值留空，禁止填零' },
    { name: 'power', unit: 'kW', note: '功率缺值留空，禁止填零' },
    { name: 'station_total_flow', unit: 'm³/min', note: '站级总流量，用于流量恒等式' },
  ],
  permissions: {
    roles: ['数据管理员', '值班工程师'],
    scopes: ['history:import', 'history:read'],
    notes: [
      '导入需经数据管理员授权，且只写入回放夹具命名空间，不得进入调度候选。',
      '导入数据必须保留来源标记，禁止与合成数据混用。',
      '本轮不接入主办方原始 CSV/XLSX、真实设备档案或任何密钥。',
    ],
  },
  notInScopeThisRound:
    '本轮只定义接口契约与权限/格式说明，不实现真实文件读取，不请求或上传任何原始包。',
}

export interface IngestResult {
  ok: false
  reason: string
}

export interface HistoryIngestAdapter {
  readonly id: string
  describe(): IngestDescriptor
  validateBundle(bundle: unknown): IngestResult
  loadBundle(bundle: unknown): never
}

export function createDisabledIngestAdapter(): HistoryIngestAdapter {
  return {
    id: 'disabled-history-ingest',
    describe: () => INGEST_DESCRIPTOR,
    validateBundle: () => ({
      ok: false,
      reason: '本轮未启用真实数据接入：仅保留接口契约，不读取原始文件。',
    }),
    loadBundle: () => {
      throw new Error('本轮未实现真实数据接入，禁止读取原始包。')
    },
  }
}