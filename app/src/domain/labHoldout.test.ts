import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { runLabHoldout } from './labHoldout'

/**
 * 一次性留出评估：把完整事实写入根文件 qiheng-polish2-holdout.json。
 * 仅断言结构数量，不迫使 36 个方案全部成功；失败与 null 原样保留。
 */
describe('lab-v1 留出评估导出', () => {
  it('执行一次评估并导出完整 JSON 事实', () => {
    const payload = runLabHoldout()
    writeFileSync('qiheng-polish2-holdout.json', JSON.stringify(payload, null, 2))
    expect(payload.cases).toHaveLength(18)
    expect(payload.manifest.schema).toBe('qiheng-lab-holdout-v1')
    expect(payload.manifest.planCount).toBe(36)
  })
})
