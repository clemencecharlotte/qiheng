import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DataIngressWorkspace from './DataIngressWorkspace'
import GovernanceWorkspace from './GovernanceWorkspace'

describe('M10 离线子页工作区', () => {
  it('数据接入子页渲染面板（未配置时为空态）', () => {
    const html = renderToStaticMarkup(<DataIngressWorkspace />)
    expect(html).toContain('数据接入')
    expect(html).toContain('qh-data-ingress')
  })
  it('治理事件子页渲染面板', () => {
    const html = renderToStaticMarkup(<GovernanceWorkspace />)
    expect(html).toContain('治理事件')
    expect(html).toContain('qh-gov-events')
  })
})

describe('M10 r05 批次页受限返回', () => {
  it('无来源（直接深链）不提供“返回治理事件”', () => {
    const html = renderToStaticMarkup(<DataIngressWorkspace />)
    expect(html).not.toContain('data-testid="qdi-return-governance"')
  })
  it('真实治理来源存在时提供“返回治理事件”', () => {
    const html = renderToStaticMarkup(
      <DataIngressWorkspace
        governanceOrigin={{ sourceId: 'synth-air-2', eventId: 'e1', type: 'rows_rejected', severity: 'warn', offset: 20 }}
        onReturnToGovernance={() => {}}
      />,
    )
    expect(html).toContain('data-testid="qdi-return-governance"')
    expect(html).toContain('返回治理事件')
  })
})
