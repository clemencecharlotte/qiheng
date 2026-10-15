import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AppearanceDock from './AppearanceDock'

const noop = () => {}

function render() {
  return renderToStaticMarkup(
    <AppearanceDock
      environmentPosition={2}
      onEnvironmentPositionChange={noop}
      glassIntensity={0.4}
      onGlassIntensityChange={noop}
      appearanceMode="system"
      onAppearanceModeChange={noop}
      followLocalTime={false}
      onFollowLocalTimeChange={noop}
      onReset={noop}
    />,
  )
}

describe('M13 外观入口渲染合同', () => {
  it('关闭态只渲染入口按钮（dialog 语义），不渲染浮层', () => {
    const html = render()
    expect(html).toContain('data-testid="appearance-open"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('日间') // 默认场景名
    expect(html).not.toContain('data-testid="appearance-pop"')
  })
})
