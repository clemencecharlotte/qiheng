/**
 * 前景流程缩略示意（M4 内容补齐）。
 *
 * 四张 54px 缩略框里的精炼语义线稿 —— 纯装饰，不代表运行状态、不含数字/PASS。
 * 语义：来源·单位·时段 / 多候选·能耗·启停取舍 / 容量·边界·余量检查 / 人工确认·
 * 审批与合成执行分离。配合 .qh-flow-shot 的静止外框与 ::after 对焦框使用。
 */
export default function FlowShot({ step }: { step: number }) {
  if (step === 0)
    return (
      <svg viewBox="0 0 120 54" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        {/* 输入依据：来源行 · 单位 · 时段刻度 */}
        <path d="M14 14h92M14 24h92M14 34h58" />
        <path d="M14 44h92" strokeOpacity=".28" />
        <path d="M96 28v12M92 35l4 4 4-4" />
        <circle cx="8" cy="14" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="8" cy="24" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="8" cy="34" r="1.6" fill="currentColor" stroke="none" />
      </svg>
    )
  if (step === 1)
    return (
      <svg viewBox="0 0 120 54" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        {/* 比较维度：多候选取舍 + 天平 */}
        <path d="M16 46V28M34 46V18M52 46V34" />
        <path d="M12 46h48" />
        <path d="M78 22h30M93 22v18M86 40h14" />
        <path d="M80 22l5-6M106 22l-5-6" strokeOpacity=".5" />
      </svg>
    )
  if (step === 2)
    return (
      <svg viewBox="0 0 120 54" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        {/* 复验约束：检查项 + 边界/余量标尺 */}
        <path d="M16 15l5 5 9-11M38 17h42" />
        <path d="M16 29l5 5 9-11M38 31h36" />
        <path d="M16 43l5 5 9-11M38 45h28" />
        <path d="M94 12v30M94 42h16" strokeDasharray="3 3" />
      </svg>
    )
  return (
    <svg viewBox="0 0 120 54" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      {/* 权限边界：人工确认 → 审批/合成执行分离 */}
      <circle cx="26" cy="20" r="8" />
      <path d="M12 45c0-8.5 6-13 14-13s14 4.5 14 13" />
      <path d="M58 27h12M64 21l6 6-6 6" />
      <path d="M80 16v22" strokeDasharray="3 3" />
      <rect x="88" y="20" width="22" height="14" rx="3" />
      <path d="M93 27l3 3 6-7" />
    </svg>
  )
}
