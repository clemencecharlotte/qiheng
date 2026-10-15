import { useMemo } from 'react'
import { loadPassportStore } from '../domain/passport'

interface Props {
  onNavigateSub: (sub: string) => void
  /** 打开“记录 · 审计与决策”查看已封存护照（跨工作区；无则不显示入口）。 */
  onOpenRecords?: () => void
}

interface Step {
  id: string
  at: string
  title: string
  body: string
  action: 'compare' | 'evidence' | 'execution'
  actionLabel: string
}

const STEPS: Step[] = [
  {
    id: 'normal',
    at: '0:20',
    title: '候选：复算取舍',
    body: '先在场景栏选择常态，再看同条件基线与建议（切换次数 / 估算耗电）。',
    action: 'compare',
    actionLabel: '去看候选对比',
  },
  {
    id: 'boundary',
    at: '1:00',
    title: '未知与拒绝边界',
    body: '看未知 / 未验证项与不可行原因：KPI 真值缺失、喘振边界未核实等只标注“未验证”。',
    action: 'evidence',
    actionLabel: '去看证据与未知项',
  },
  {
    id: 'fault',
    at: '1:25',
    title: '故障：旧授权失效与新人审',
    body: '故障登记后父执行安全退休、旧批准 / Start 不可继续；子段重规划须人重新审查、显式批准与 Start。',
    action: 'execution',
    actionLabel: '去看故障退休与子段新人审',
  },
]

/**
 * M27 D · 最小三分钟评审路径（复用现有评审宿主与子路由，不新 lab / 不全页重排）。
 * 仅是人可点击的引导；不自动求解 / 批准 / Start。三分钟是理解路径，非计时承诺。
 */
export default function ReviewPathGuide({ onNavigateSub, onOpenRecords }: Props) {
  const hasPassport = useMemo(() => {
    try {
      return loadPassportStore().passports.length > 0
    } catch {
      return false
    }
  }, [])

  return (
    <section className="panel review-path-guide" aria-label="三分钟评审路径">
      <div className="panel-head">
        <h3>三分钟评审路径</h3>
      </div>
      <ol className="plain-list">
        {STEPS.map((s) => (
          <li key={s.id}>
            <strong>{s.title}</strong>：{s.body}{' '}
            {s.action === 'compare' ? (
              <button type="button" className="chip-btn" onClick={() => onNavigateSub(s.action)}>
                {s.actionLabel}
              </button>
            ) : null}
          </li>
        ))}
        <li>
          <strong>护照证据</strong>：
          {hasPassport ? (
            <>
              已有已封存护照，可打开查看候选复验与证据引用。{' '}
              {onOpenRecords ? (
                <button type="button" className="chip-btn" onClick={onOpenRecords}>
                  打开已封存护照
                </button>
              ) : null}
            </>
          ) : (
            <>暂无已封存护照：请先在前序流程完成一轮比较并封存，再回来看证据引用；不预造成功记录。</>
          )}
        </li>
      </ol>
      <p className="hint">
        三分钟是“理解路径”，不声称每次冷求解 / 逐桶都在三分钟内完成；不含自动求解、自动批准或自动 Start。
      </p>
    </section>
  )
}
