/**
 * M24 B · 证据定位返回上下文（最小内存 snapshot，不编 URL/不改业务）。
 *
 * 目标：总览/来源页 → 关联证据（候选 filter）→ 本页定位对象 → **返回来源** 应回到
 * **本次来源**（原 route/query/关系 filter/selected/depth/scroll/可见 focus），而非上次 goBack；
 * 同页定位（route 未变）也更新 snapshot（返回 = 回到本次进入证据前的状态）。
 * 浏览器后退与显式返回一致：显式返回先消费 snapshot，非证据定位才用旧 goBack。
 */
import type { RelationKind } from './relations'
import type { RouteState } from '../domain/router'
import type { NarratedAnswer } from '../domain/narrator'

/**
 * M27 B · 已完成 QA 视图的临时 UI 快照（仅内存，随唯一会话 entry 保存）。
 * 返回来源时同 commit 恢复该视图，使本次 qa-ref 证据按钮真实存在后再回焦；
 * 恢复不重新 askQuestion/narrateAnswer（不产生第二次审计 / 模型调用）。
 * runIdentity 不一致（场景/代次变更、新会话/失效 entry）即废弃。
 */
export interface QaViewSnapshot {
  input: string
  answer: NarratedAnswer | null
  runIdentity: string
  /** Conversation UI only; never replays a query or changes business state. */
  messages?: ChatMessageSnapshot[]
  chatId?: string
  draft?: string
  scrollTop?: number
}

export interface ChatMessageSnapshot {
  id: number
  role: 'user' | 'assistant'
  text?: string
  answer?: NarratedAnswer | null
  error?: string
  evidenceOpen?: boolean
}

/** M29 · 序幕设备体验入口快照（仅内存，随唯一会话 entry）。 */
export interface PrologueViewSnapshot {
  deviceId: string
  demoState: string
  runIdentity: string
}

/** M29 r17 · 智能体会话快照（仅内存，随唯一会话 entry）。 */
export interface AgentViewSnapshot {
  result: unknown | null
  frozenSnapshot: unknown | null
  sourceMode?: 'schedule' | 'history'
  deviceId: string
  winStart: number
  winEnd: number
  passportId: string
  resourceUri: string | null
  /** M29 r34 · 资料正文与标题独立保存（不把 URI 当正文）。 */
  resourceTitle?: string | null
  resourceText?: string | null
  runIdentity: string
}

export interface EvidenceReturnSnapshot {
  directory?: { query: string; filter: 'all' | 'eligible' | 'excluded' }
  /** 进入证据前的来源 route（含 query/mode/scenario/normalizedHash）。 */
  route: RouteState
  /** 关系筛选（'all' | kind）。 */
  filter: 'all' | RelationKind
  /** 关系选中对象 id。 */
  selected: string | null
  /** 对象上下文联动 id。 */
  linked: string | null
  /** 关系邻域深度。 */
  depth: 1 | 2
  /** 来源页滚动位置。 */
  scrollY: number
  /** 来源页可见焦点元素 id（可空）。 */
  focusId: string | null
  /** M27 B · 已完成 QA 视图临时快照（仅内存）。 */
  qaView?: QaViewSnapshot
  /** M29 · 序幕设备体验入口快照（仅内存）。 */
  prologueView?: PrologueViewSnapshot
  /** M29 · 智能体会话快照（仅内存）。 */
  agentView?: AgentViewSnapshot
  /** M29 r27 · MAP 视角（随唯一 entry 保持，避免卸载丢）。 */
  mapView?: 'site' | 'data' | 'decision'
}

export interface EvidenceReturnStore {
  capture(s: EvidenceReturnSnapshot): void
  peek(): EvidenceReturnSnapshot | null
  consume(): EvidenceReturnSnapshot | null
  clear(): void
}

export function createEvidenceReturnStore(): EvidenceReturnStore {
  let snap: EvidenceReturnSnapshot | null = null
  return {
    capture: (s) => { snap = s },
    peek: () => snap,
    consume: () => { const s = snap; snap = null; return s },
    clear: () => { snap = null },
  }
}
