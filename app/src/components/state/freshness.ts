/**
 * M12 r02 · 来源观测时效判定（诚实性修复）。
 * 必须用 **来源观测时间 sourceObservedAt** 判定观测新鲜度；
 * 服务心跳 heartbeatAt 只反映服务状态，不能冒充观测新鲜。
 * null / 非法 / 明显未来 → unknown（未知，不假装 fresh）。
 */
export type SourceFreshness = 'fresh' | 'stale' | 'unknown'

/** 允许的轻微时钟偏差（观测时间略超 now 仍按实际处理，不误判为未来）。 */
export const FUTURE_SKEW_MS = 60_000

export function deriveSourceFreshness(
  sourceObservedAt: string | null | undefined,
  now: number,
  staleMs: number,
): SourceFreshness {
  if (!sourceObservedAt) return 'unknown'
  const t = Date.parse(sourceObservedAt)
  if (!Number.isFinite(t)) return 'unknown'
  if (t > now + FUTURE_SKEW_MS) return 'unknown'
  return now - t > staleMs ? 'stale' : 'fresh'
}
