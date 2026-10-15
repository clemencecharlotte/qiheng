import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import OriginDialog from './OriginDialog'
import { AuthForm } from './AuthPreview'

describe('OriginDialog（SSR 结构窄验；WAAPI/焦点运行时未测）', () => {
  it('关闭态只渲染触发器，语义完整；portal 面板不泄漏进 SSR', () => {
    const html = renderToString(
      <OriginDialog triggerLabel="登录 / 注册" title="登录或注册（设计原型）">
        <p>内容</p>
      </OriginDialog>,
    )
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('登录 / 注册')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('u-dialog-scrim')
  })
})

describe('AuthPreview（SSR 结构窄验）', () => {
  it('诚实口径：未接入鉴权、提交不发送；含 autocomplete 语义与两个 tab', () => {
    const html = renderToString(<AuthForm />)
    expect(html).toContain('未接入鉴权')
    expect(html).toContain('提交不发送')
    expect(html).toContain('autoComplete="email"')
    expect(html).toContain('autoComplete="current-password"')
    const reg = renderToString(<AuthForm initialTab="register" />)
    expect(reg).toContain('autoComplete="new-password"')
    expect(reg).toContain('确认密码')
    expect(html).toContain('role="tab"')
    expect(html).not.toContain('登录成功')
    expect(html).not.toContain('欢迎回来')
  })
})
