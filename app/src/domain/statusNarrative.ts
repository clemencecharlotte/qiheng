/**
 * M27 C · 执行 / 重规划状态的确定性中文口径（纯映射，无副作用）。
 * UI 必须消费真实公开状态给就近短风险说明；不得为说明恢复权限、不得编造精确原因。
 * 未收录状态原样返回 label，risk 为 null（不冒结论）。
 */

export interface StatusNarrative {
  label: string
  /** 就近短风险说明；无需提示时为 null。 */
  risk: string | null
}

const EXECUTION: Record<string, StatusNarrative> = {
  verified: { label: '待人工评审', risk: null },
  approved: { label: '已批准（待 Start）', risk: '人工批准即授权合成执行，但不自动 Start；须由人另行显式 Start。' },
  rejected: { label: '已驳回', risk: '该执行已被人工驳回，旧授权不可继续；调整后需重新送交复验。' },
  executing: { label: '执行中（人工逐桶）', risk: null },
  paused: { label: '已暂停', risk: null },
  completed: { label: '已完成（不自动积分）', risk: null },
  retired: { label: '已永久退休', risk: '当前执行链已安全退休，旧授权不再有效、不可继续；需重新审查并以新 epoch 重送。' },
}

const SUFFIX: Record<string, StatusNarrative> = {
  pending: { label: '待求解', risk: null },
  ok: { label: '成功（未执行）', risk: null },
  no_remaining: { label: '无剩余时段', risk: null },
  canceled: { label: '已取消', risk: '本次求解已被取消，未采用其结果；可显式重试生成。' },
  infeasible: { label: '无可行解（非超时）', risk: '在当前故障集与约束下无可行解；需调整机组或约束后重试。' },
  timeout: { label: '求解超时（watchdog 终止）', risk: '本次求解在 watchdog 期限内未获得或未采用可行解；该失败尝试已保留，不隐藏，可显式重试生成。' },
  no_primal: { label: '未获得可行解', risk: '求解结束但未得到可行解；该失败尝试已保留，可显式重试生成。' },
  invalid: { label: '结果无效', risk: '求解结果未通过校验，不可作为计划；可显式重试生成。' },
  worker_error: { label: '求解器错误', risk: '求解器返回错误，未产生可用计划；该失败尝试已保留，可显式重试生成。' },
  terminated: { label: '已安全终止', risk: '当前子段已安全终止，旧授权不可继续；需重新审查，不继承旧批准。' },
  retired: { label: '已永久退休', risk: '当前父执行已安全退休，旧授权不可继续；子段须基于新审查重建。' },
  verified: { label: '待人工评审', risk: null },
  approved: { label: '已批准（待 Start）', risk: '人工批准即授权合成执行，但不自动 Start；须由人另行显式 Start。' },
  rejected: { label: '已驳回', risk: null },
  executing: { label: '执行中（人工逐桶）', risk: null },
  completed: { label: '已完成（不自动积分）', risk: null },
}

export function executionStatusText(status: string): StatusNarrative {
  return EXECUTION[status] ?? { label: status, risk: null }
}

export function suffixStatusText(status: string): StatusNarrative {
  return SUFFIX[status] ?? { label: status, risk: null }
}

/**
 * 求解尝试口径：明确是否超时、是否获得可用计划、以及可显式重试。
 * 不推断具体原因，只陈述 attempt 已公开的事实。
 */
export function attemptNarrative(state: string, hasPlan: boolean, reason: string | null): string {
  const base = suffixStatusText(state)
  const parts = [base.risk, hasPlan ? '本次已获得可用计划（未执行）。' : '本次未获得可用计划。']
  if (!(state === 'ok' && hasPlan)) parts.push('可显式重试生成，失败尝试保留。')
  if (reason) parts.push(`公开原因：${reason}。`)
  return `${base.label}：${parts.filter(Boolean).join('')}`
}
