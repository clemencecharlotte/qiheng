import type { ReactNode } from 'react'
import {
  DATA_SOURCES,
  SCHEDULE_CENTRIFUGAL_EXCLUSION_NOTE,
  type SourceId,
} from '../domain/sources'
import { SCENARIOS } from '../domain/demand'
import type { ScenarioId } from '../domain/types'
import { Popover } from './ui/Disclosure'
import NoteRef from './console/NoteRef'

interface Props {
  sourceId: SourceId
  seed: number
  scenario: ScenarioId
  onScenarioChange: (id: ScenarioId) => void
  onRecompute: () => void
  safetyBlocked: boolean
  blockReasons: string[]
  modelEnabled: boolean
  /** 模式 / 夹具 / 偏好等紧凑控制，与来源控制同一行，不额外占块。 */
  modeControls?: ReactNode
  /** 实验模式不显示旧三示例场景选项。 */
  showScenarioTabs?: boolean
}

export default function SourceSafetyBar({
  sourceId,
  seed,
  scenario,
  onScenarioChange,
  onRecompute,
  safetyBlocked,
  blockReasons,
  modelEnabled,
  modeControls,
  showScenarioTabs = true,
}: Props) {
  const source = DATA_SOURCES[sourceId]
  const current = SCENARIOS.find((s) => s.id === scenario)

  return (
    <section className="source-bar" aria-label="数据来源与安全状态">
      <div className="source-bar-main">
        <span className={`tag ${safetyBlocked ? 'bad' : 'ok'}`}>
          {safetyBlocked ? '复验未通过 · 禁止批准/执行' : '复验通过 · 可人工评审'}
        </span>
        <NoteRef note="synthetic" />

        {modeControls}

        {showScenarioTabs ? (
          <div className="scenario-tabs source-bar-tabs" aria-label="合成场景">
            {SCENARIOS.map((s) => (
              <button
                type="button"
                key={s.id}
                aria-pressed={s.id === scenario}
                className={`scenario-tab${s.id === scenario ? ' active' : ''}`}
                onClick={() => onScenarioChange(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : null}
        <button type="button" className="btn ghost" onClick={onRecompute}>
          重新计算
        </button>

        <Popover label="来源详情" ariaLabel="来源 / 时段 / 种子 / 模型 / 边界详情">
          <div className="source-details-body">
            <p>
              当前场景：{current?.label ?? scenario}
              <NoteRef note="synthetic" />
            </p>
            <p className="hint">复验通过仅表示可进入人工评审；人工批准与另行 Start 分开，系统不自动执行、不自动授权下发。</p>
            <p>
              数据来源：{source.label} · 固定种子 {seed}
              <NoteRef note="data" />
            </p>
            <p>
              在线模型：
              {modelEnabled
                ? '已启用（服务端代理，仅解释，不修改审批 / 状态）'
                : '未启用（本轮问答为确定性规则解释，不写在线已接通）'}
            </p>
            <p>{SCHEDULE_CENTRIFUGAL_EXCLUSION_NOTE}</p>
            <p>
              {source.scope} · 机组：{source.units}
            </p>
            <p>{source.unitsNote}</p>
            <ul>
              {source.unverifiedBoundaries.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            {current ? <p>场景说明：{current.description}</p> : null}
          </div>
        </Popover>
      </div>

      {safetyBlocked ? (
        <div className="source-bar-block" role="status">
          <strong>不可批准原因：</strong>
          <ul>
            {blockReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}