/**
 * B05a 入口识别（最小、独立）：只识别空 hash 与精确 #/welcome 为欢迎页，
 * 其余一律交回既有业务 router 白名单，不改变 business router 合同。
 */

export const WELCOME_HASH = '#/welcome'

export type EntryView = 'welcome' | 'business'

/** 仅空 hash（'' / '#' / '#/'）与精确 '#/welcome' 视为欢迎；带参数/其他路径不匹配。 */
export function isWelcomeHash(hash: string | null | undefined): boolean {
  const h = (hash ?? '').trim()
  return h === '' || h === '#' || h === '#/' || h === WELCOME_HASH
}

export function entryViewFromHash(hash: string | null | undefined): EntryView {
  return isWelcomeHash(hash) ? 'welcome' : 'business'
}
