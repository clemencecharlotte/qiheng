import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import App from '../App'
import AppNav, { WORKSPACES } from '../components/AppNav'

describe('控制台信息层级', () => {
  it('八个一级工作区分两组：决策与系统 / 数据与证据', () => {
    const html = renderToString(<AppNav value="schedule" onChange={() => {}} />)
    expect(WORKSPACES.map((w) => w.id)).toEqual(['schedule', 'device', 'map', 'agent', 'data', 'events', 'history', 'assistant'])
    expect(html.match(/<button/g)).toHaveLength(8)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toContain('aria-label="决策与系统"')
    expect(html).toContain('aria-label="数据与证据"')
  })

  it('总览先呈现结论，再查看设备，不增加总览批准按钮', () => {
    const html = renderToString(<App />)
    const brief = html.indexOf('class="panel console-decision-brief"')
    const stage = html.indexOf('class="panel stage-panel"')
    expect(brief).toBeGreaterThan(-1)
    expect(stage).toBeGreaterThan(brief)
    expect(html.match(/id="overview-next-compare"/g)).toHaveLength(1)
    expect(html.match(/id="overview-next-review"/g)).toHaveLength(1)
    expect(html.match(/id="overview-next-evidence"/g)).toHaveLength(1)
    expect(html).toContain('同源快照')
    expect(html).toContain('总览不直接批准')
    expect(html).not.toContain('data-action="approve"')
  })
})
