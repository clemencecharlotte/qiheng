import { describe, expect, it } from 'vitest'
import { playResultAction } from './NativeDemoPlayer'

describe('M24 C · NativeDemoPlayer 播放请求身份（晚到 resolve/reject 不污染）', () => {
  it('resolved 匹配→生效；身份过期→pause-old（不重启旧实例）', () => {
    expect(playResultAction('resolved', 5, 5)).toBe('none')
    expect(playResultAction('resolved', 4, 5)).toBe('pause-old') // pause/src换入/他者抢后旧 resolve
  })
  it('rejected 过期→忽略；AbortError→忽略（用户取消）；其余→error', () => {
    expect(playResultAction('rejected', 4, 5, 'NotSupportedError')).toBe('none')
    expect(playResultAction('rejected', 5, 5, 'AbortError')).toBe('none')
    expect(playResultAction('rejected', 5, 5, 'NotSupportedError')).toBe('error')
    expect(playResultAction('rejected', 5, 5)).toBe('error')
  })
  it('latest-wins：play(it) 后被 pause 失效 → 该 play 晚到 resolve 判 pause-old', () => {
    let intent = 0
    const play = () => { intent += 1; return intent }
    const pauseBumps = () => { intent += 1 }
    const it1 = play()          // 请求 1
    pauseBumps()                // 用户/离屏/他者 → 失效
    const it2 = play()          // 请求 2（最新）
    expect(playResultAction('resolved', it1, intent)).toBe('pause-old') // 旧 promise 晚到
    expect(playResultAction('resolved', it2, intent)).toBe('none')      // 最新生效
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import NativeDemoPlayer from './NativeDemoPlayer'

describe('M25 · NativeDemoPlayer 自绘控件（seek/时间/字幕）', () => {
  it('含 后退/前进/重播/字幕开关 与 时间·进度', () => {
    const html = renderToStaticMarkup(
      createElement(NativeDemoPlayer, { assetId: 'ask', src: '/demo-assets/ask.webm', poster: '/demo-assets/ask-poster.png', captions: '/demo-assets/ask-zh.vtt', events: [], label: '设备总览' }),
    )
    expect(html).toContain('后退 5 秒')
    expect(html).toContain('前进 5 秒')
    expect(html).toContain('重播')
    expect(html).toContain('字幕')
    expect(html).toContain('进度')
    expect(html).toContain('<track')
  })
})
