import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommandSearchView, filterCommands, type CommandItem } from './CommandPalette'
import OriginDialog from './unified/OriginDialog'
import { AuthForm } from './unified/AuthPreview'

const ITEMS: CommandItem[] = [
  { id: 'd1', group: '设备', label: '设备 AC-01', hint: '跳到设备证据', keywords: 'AC-01', run: () => {} },
  { id: 't1', group: '主题', label: '主题：深色', hint: '切换显示主题', keywords: 'dark', run: () => {} },
  { id: 'p1', group: '播放', label: '播放当前来源运输', hint: '合成调度运输', keywords: 'play', run: () => {} },
]

describe('M11 搜索面板（unified 原语适配）', () => {
  it('filterCommands：空查询按组序；关键词过滤；无匹配为空', () => {
    expect(filterCommands(ITEMS, '').map((i) => i.group)).toEqual(['设备', '事件', '证据', '主题', '播放'].filter((g) => ITEMS.some((i) => i.group === g)))
    expect(filterCommands(ITEMS, 'dark').map((i) => i.id)).toEqual(['t1'])
    expect(filterCommands(ITEMS, 'zzz')).toEqual([])
  })

  it('视图保留真实 items 与可见安全说明；空态明确', () => {
    const html = renderToStaticMarkup(
      <CommandSearchView items={ITEMS} query="" active={0} onQuery={() => {}} onActive={() => {}} onRun={() => {}} />,
    )
    expect(html).toContain('设备 AC-01')
    expect(html).toContain('不能通过命令批准、驳回或执行设备')
    expect(html).toContain('aria-label="命令搜索"')
    const empty = renderToStaticMarkup(
      <CommandSearchView items={[]} query="zzz" active={0} onQuery={() => {}} onActive={() => {}} onRun={() => {}} />,
    )
    expect(empty).toContain('没有匹配的命令')
  })
})

describe('M11 统一登录/注册（未接入鉴权）', () => {
  it('受控 OriginDialog 关闭态不渲染触发器也不渲染面板（portal 无泄漏）', () => {
    const html = renderToStaticMarkup(
      <OriginDialog open={false} onClose={() => {}} title="登录或注册（设计原型）">
        <AuthForm />
      </OriginDialog>,
    )
    expect(html).not.toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('u-dialog-scrim')
  })
  it('AuthForm 诚实口径：未接入鉴权/提交不发送、登录注册切换、无伪造成功', () => {
    const login = renderToStaticMarkup(<AuthForm />)
    expect(login).toContain('未接入鉴权')
    expect(login).toContain('提交不发送')
    expect(login).toContain('role="tab"')
    expect(login).not.toContain('登录成功')
    const reg = renderToStaticMarkup(<AuthForm initialTab="register" />)
    expect(reg).toContain('确认密码')
    expect(reg).toContain('new-password')
  })
})
