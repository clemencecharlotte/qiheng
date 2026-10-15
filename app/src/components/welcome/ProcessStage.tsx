/**
 * Process 固定舞台（R3）。桌面宽/正常高/非 reduced-motion 时由 welcome.css
 * 切为 sticky（左步骤列表 + 右媒体舞台，见 #qh-process[data-proc-index]）；
 * 其它条件自然流展示四步与各自的内联示意媒体。
 * 媒体为合成结构示意，不代表业务结果。状态完全由滚动位置决定（可逆）。
 *
 * M4：为四步线稿补上可读内容（输入依据 / 比较维度 / 复验约束 / 权限边界），
 * 桌面舞台（.pm-frame）与移动内联（.proc-media-inline）**共享同一份 points**；
 * 仍是结构示意，不改既有 data 属性 / rv / 滚动高度 / sticky 逻辑。
 */
const STEPS = [
  {
    node: 'INPUT',
    key: '01 / Ground',
    cn: '可信输入',
    desc: '来源、口径、时段先核清。',
    tag: 'INPUT',
    points: ['来源与口径可追溯', '单位与量纲统一', '时段与聚合窗口明确'],
  },
  {
    node: 'SOLVER',
    key: '02 / Compare',
    cn: '候选对比',
    desc: '比较组合，不只给答案。',
    tag: 'COMPARE',
    points: ['多候选并排比较', '能耗与启停取舍', '约束冲突显式列出'],
  },
  {
    node: 'VERIFY',
    key: '03 / Verify',
    cn: '独立复验',
    desc: '生成方案不等于可用。',
    tag: 'VERIFY',
    points: ['容量与边界校核', '安全余量检查', '独立复验规则'],
  },
  {
    node: 'APPROVAL',
    key: '04 / Approve',
    cn: '人审留痕',
    desc: '最后由人确认，全程可查。',
    tag: 'APPROVAL',
    points: ['人工确认后才生效', '审批与合成执行分离', '权限边界与留痕'],
  },
]

function FrameSvg({ step }: { step: number }) {
  if (step === 0)
    return (
      <svg viewBox="0 0 240 150" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M30 36h180M30 74h180M30 112h112" />
        <path d="M158 106l9 10 22-28" />
      </svg>
    )
  if (step === 1)
    return (
      <svg viewBox="0 0 240 150" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M48 120V52M120 120V22M192 120V76" />
        <path d="M20 20h200" strokeOpacity=".35" />
      </svg>
    )
  if (step === 2)
    return (
      <svg viewBox="0 0 240 150" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="46" y="26" width="52" height="52" rx="6" />
        <path d="M62 52l10 11 24-30" />
        <rect x="126" y="26" width="68" height="52" rx="6" strokeDasharray="6 7" />
      </svg>
    )
  return (
    <svg viewBox="0 0 240 150" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M40 96c26-36 52-36 78 0s52 36 78 0" />
      <circle cx="184" cy="58" r="26" strokeDasharray="5 6" />
      <path d="M172 58l8 8 16-18" />
    </svg>
  )
}

export default function ProcessStage() {
  return (
    <div className="proc-sticky">
      <div className="proc-stage">
        <ol className="proc-steps">
          {STEPS.map((s, i) => (
            <li key={s.node} className="rail-item rv" data-node={s.node} data-proc-step={i}>
              <span className="rail-key">{s.key}</span>
              <h3>{s.cn}</h3>
              <p>{s.desc}</p>
              <div className="proc-media-inline" data-media-step={i}>
                <div className="pmi-top">
                  <span className="pm-tag">{s.tag}</span>
                  <FrameSvg step={i} />
                </div>
                <ul className="pm-points">
                  {s.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
        <aside className="proc-media rv" data-media-stage aria-label="步骤预览：合成结构示意，不代表业务结果">
          {STEPS.map((s, i) => (
            <div className="pm-frame" data-media-step={i} key={s.node}>
              <span className="pm-tag">{s.tag}</span>
              <FrameSvg step={i} />
              <ul className="pm-points">
                {s.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </aside>
      </div>
    </div>
  )
}
