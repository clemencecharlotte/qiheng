import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import Popover from './Popover'

describe('S1 Popover（SSR 窄验）', () => {
  it('关闭态只渲染触发器，带 haspopup 语义', () => {
    const html = renderToString(<Popover label="消息" title="消息"><p>内容</p></Popover>)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('消息')
    expect(html).not.toContain('topbar-pop-panel')
  })

  it('打开态输出 dialog 面板与遮罩（焦点/Esc/回焦在浏览器端 effect 实现）', () => {
    const html = renderToString(<Popover label="游客" title="账号"><p>游客模式。</p></Popover>)
    expect(html).not.toContain('topbar-pop-panel') // SSR 初始为关闭；portal 面板仅浏览器端
    expect(html).not.toContain('aria-modal="true"')
    expect(html).toContain('游客')
  })
})
