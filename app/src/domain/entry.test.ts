import { describe, expect, it } from 'vitest'
import { WELCOME_HASH, entryViewFromHash, isWelcomeHash } from './entry'

describe('B05a entry 识别（仅空 hash / 精确 #/welcome）', () => {
  it('空 hash 与 #/welcome 为欢迎', () => {
    for (const h of ['', '   ', '#', '#/', WELCOME_HASH]) {
      expect(isWelcomeHash(h), h).toBe(true)
      expect(entryViewFromHash(h)).toBe('welcome')
    }
  })

  it('有效业务深链与带参数/其他路径不是欢迎', () => {
    for (const h of [
      '#/welcome?x=1',
      '#/schedule/overview?mode=legacy&scenario=normal',
      '#/schedule/execution?mode=legacy&scenario=normal',
      '#/events/list',
      '#/history/trend',
      '#/records/audit',
    ]) {
      expect(isWelcomeHash(h), h).toBe(false)
      expect(entryViewFromHash(h)).toBe('business')
    }
  })
})
