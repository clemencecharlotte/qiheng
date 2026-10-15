/** Display projection only. Never changes source rows, clock, solver or totals. */
export function replayWindow(count: number, index: number, dynamic: boolean, size = 16): [number, number] {
  if (!Number.isFinite(count) || count <= 0) return [0, 0]
  count = Math.floor(count)
  if (!dynamic) return [0, count]
  const end = Math.min(count, Math.max(0, Math.floor(Number.isFinite(index) ? index : 0)) + 1)
  return [Math.max(0, end - Math.max(1, Math.floor(size))), end]
}
