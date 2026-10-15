import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import NotesBar from './NotesBar'
import NoteRef from './NoteRef'
import { NOTES } from './notes'

describe('M12 脚注与交叉引用', () => {
  it('NotesBar 输出稳定 qh-note-* id，合成/离线口径不同', () => {
    const syn = renderToStaticMarkup(<NotesBar sceneLabel="常态" />)
    expect(syn).toContain('id="qh-note-synthetic"')
    expect(syn).toContain('id="qh-note-readonly"')
    expect(syn).toContain('id="qh-note-approval"')
    expect(syn).toContain('id="qh-note-data"')
    expect(syn).toContain('非生产审计存证')
    const off = renderToStaticMarkup(<NotesBar sceneLabel="离线批次" context="offline" />)
    expect(off).toContain('id="qh-note-offline"')
    expect(off).toContain('非实时连接')
  })

  it('NoteRef 是路由中立按钮（不改 hash）+ 可读 aria-label；脚注有回链', () => {
    const html = renderToStaticMarkup(<NoteRef note="synthetic" />)
    expect(html).toContain('data-qh-note-ref="qh-note-synthetic"')
    expect(html).toContain(`aria-label="脚注 ${NOTES.synthetic.n}：合成演示与设备边界（跳到底部脚注）"`)
    // 路由中立：不得用 href="#qh-note-*"（会被 hash router 当业务路由）
    expect(html).not.toContain('href="#qh-note-synthetic"')
    expect(html).toContain('<button')
    const bar = renderToStaticMarkup(<NotesBar sceneLabel="常态" />)
    expect(bar).toContain('data-qh-note-back="qh-note-synthetic"')
  })
})

describe('M13 r05 页末注释默认折叠', () => {
  it('默认折叠：正文 hidden，角标按钮存在；id 仍在（供角标锚定）', () => {
    const html = renderToStaticMarkup(<NotesBar sceneLabel="常态" />)
    expect(html).toContain('app-footer-toggle')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('app-footer-notes-body')
    expect(html).toContain('hidden')
    expect(html).toContain('id="qh-note-synthetic"')
  })
})
