/**
 * 气衡 M06 · 只读数据接入契约（typed）。
 * 这些类型对应 services/readonly-data 的 JSON 响应（camelCase）。
 */

export type BatchStatus = 'ok' | 'partial'
export type ObservationQuality = 'valid' | 'isolated'
export type ConnectionStatus =
  | 'unconfigured'
  | 'connecting'
  | 'live'
  | 'stale'
  | 'offline'
  | 'error'

export interface BatchSummary {
  id: string
  sourceId: string
  entity: string
  format: string
  filename: string
  ruleVersion: string
  receivedAt: string
  totalRows: number
  validRows: number
  isolatedRows: number
  rejectedRows: number
  status: BatchStatus
  unordered: boolean
  note: string
}

export interface Observation {
  id: number
  batchId: string
  sourceId: string
  entity: string
  metric: string
  value: number
  unit: string
  observedAt: string
  receivedAt: string
  quality: ObservationQuality
  reason: string | null
}

export interface ReasonCount {
  reason: string
  c: number
}

export interface RejectionRow {
  rowIndex: number
  reason: string
  raw: string | null
}

export interface QualityReport {
  batchId: string
  ruleVersion: string
  status: BatchStatus
  unordered: boolean
  note: string
  counts: { total: number; valid: number; isolated: number; rejected: number }
  rejectReasons: ReasonCount[]
  isolateReasons: ReasonCount[]
  rejections: RejectionRow[]
}

export interface SourceState {
  sourceId: string
  configured: boolean
  sourceObservedAt: string | null
  receivedAt: string | null
  heartbeatAt: string | null
  status: string
  observationCount: number
  ruleVersion: string | null
}

export interface HealthInfo {
  status: string
  service: string
  schemaVersion: number
  time: string
  ruleVersion: string
}

export interface ImportResult {
  batchId: string
  idempotent: boolean
  status: BatchStatus
  counts: { total: number; valid: number; isolated: number; rejected: number }
  unordered: boolean
  receivedAt: string
  ruleVersion: string
}

export interface BatchList {
  items: BatchSummary[]
  total: number
}

export interface ObservationList {
  items: Observation[]
  total: number
}

/* ── M07 治理事件 ── */
export type GovernanceEventType =
  | 'import_completed'
  | 'rows_isolated'
  | 'rows_rejected'
  | 'service_error'
export type EventSeverity = 'info' | 'warn' | 'error'

export interface GovernanceEvent {
  eventId: string
  sourceId: string | null
  batchId: string | null
  type: GovernanceEventType
  severity: EventSeverity
  occurredAt: string
  receivedAt: string
  ruleVersion: string | null
  reasons: ReasonCount[] | null
  detail: string | null
}

export interface EventList {
  items: GovernanceEvent[]
  total: number
  limit: number
  offset: number
}

export interface EventQuery {
  limit?: number
  offset?: number
  sourceId?: string
  type?: GovernanceEventType
  severity?: EventSeverity
  since?: string
  until?: string
}
