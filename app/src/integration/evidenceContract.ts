/**
 * M12 r02 · R6/M13 关联证据数据合同与「有据对象」白名单说明（只读、无副作用）。
 *
 * 本文件仅声明 M13 将有据对象接入关联图所需的**类型合同**与**白名单**；
 * 不改变求解/独立复验/批准执行逻辑，不造在线事件，不新增业务路由。
 * 关联边只有在**两侧对象都有真实 ID 证据**时才建立；缺证据不连。
 */

import type { BatchSummary, GovernanceEvent, SourceState } from './contracts'

/** 有据对象类别白名单（M13 目标；本片只落 source/batch/event）。 */
export const RELATION_OBJECT_KINDS = [
  'source',
  'batch',
  'event',
  'device',
  'observation',
  'decision',
  'constraint',
  'verification',
  'approval',
  'execution',
  'anomaly',
] as const

export type RelationObjectKind = (typeof RELATION_OBJECT_KINDS)[number]

/**
 * 每一类对象的证据键（必须为真实 ID；不得由展示层生成）。
 * label 仅说明，不参与逻辑。
 */
export const RELATION_EVIDENCE_KEYS: Record<RelationObjectKind, { id: string; label: string; landed: boolean }> = {
  source: { id: 'sourceId', label: '只读来源', landed: true },
  batch: { id: 'batch.id', label: '离线批次', landed: true },
  event: { id: 'event.eventId', label: '治理事件', landed: true },
  device: { id: 'unit.id', label: '机组设备', landed: false },
  observation: { id: 'batch+metric+observedAt', label: '观测记录', landed: false },
  decision: { id: 'decision.id', label: '人审决定', landed: false },
  constraint: { id: 'constraint.code', label: '约束项', landed: false },
  verification: { id: 'verifier.ruleVersion', label: '独立复验', landed: false },
  approval: { id: 'decision.id', label: '批准状态', landed: false },
  execution: { id: 'execution.id', label: '合成执行', landed: false },
  anomaly: { id: 'event.eventId', label: '异常事件', landed: false },
}

/** M13 邻域/节点预算（确定性，不随机）。 */
export const RELATION_BUDGET = { maxNodes: 18, minDepth: 1, maxDepth: 2 } as const

/** 只读数据入参（与 relations.ts 一致）。 */
export interface EvidenceInput {
  sourceStates: SourceState[]
  batches: BatchSummary[]
  events: GovernanceEvent[]
}
