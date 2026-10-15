import { describe, expect, it, vi } from 'vitest'
import { shouldCloseOnScrimPress, trapModalTab } from './modalFocus'

/** 真实围栏算法合同（纯函数级）；浏览器端焦点测量的运行时行为仍属未测项。 */

function makePanel() {
  return { contains: (node: unknown) => node !== 'outside' && node !== null }
}

function stub() {
  return { focus: vi.fn() }
}

function tabEvent(shift = false) {
  return { key: 'Tab', shiftKey: shift, preventDefault: vi.fn() }
}

describe('trapModalTab · 模态焦点围栏合同', () => {
  const panel = makePanel()
  const first = stub()
  const mid = stub()
  const last = stub()
  const list = [first, mid, last]

  it('初始焦点在 panel 本体：Tab 进首、Shift+Tab 进尾', () => {
    const e = tabEvent()
    trapModalTab(e, panel, panel, list)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(first.focus).toHaveBeenCalled()

    const e2 = tabEvent(true)
    trapModalTab(e2, panel, panel, list)
    expect(e2.preventDefault).toHaveBeenCalled()
    expect(last.focus).toHaveBeenCalled()
  })

  it('在首按 Shift+Tab → 尾；在尾按 Tab → 首；中间不拦', () => {
    const e1 = tabEvent(true)
    trapModalTab(e1, panel, first, list)
    expect(e1.preventDefault).toHaveBeenCalled()
    expect(last.focus).toHaveBeenCalled()

    const e2 = tabEvent()
    trapModalTab(e2, panel, last, list)
    expect(e2.preventDefault).toHaveBeenCalled()
    expect(first.focus).toHaveBeenCalled()

    const e3 = tabEvent()
    trapModalTab(e3, panel, mid, list)
    expect(e3.preventDefault).not.toHaveBeenCalled()
  })

  it('焦点异常落在面板外（背景元素）：Tab/Shift+Tab 均拉回栏内', () => {
    const e1 = tabEvent()
    trapModalTab(e1, panel, 'outside', list)
    expect(e1.preventDefault).toHaveBeenCalled()
    expect(first.focus).toHaveBeenCalled()

    const e2 = tabEvent(true)
    trapModalTab(e2, panel, null, list)
    expect(e2.preventDefault).toHaveBeenCalled()
    expect(last.focus).toHaveBeenCalled()
  })

  it('零可聚焦子项：焦点钉在面板本体，双向都不逃', () => {
    const e1 = tabEvent()
    trapModalTab(e1, panel, panel, [])
    expect(e1.preventDefault).toHaveBeenCalled()

    const e2 = tabEvent(true)
    trapModalTab(e2, panel, panel, [])
    expect(e2.preventDefault).toHaveBeenCalled()
  })

  it('非 Tab 键不处理', () => {
    const e = { key: 'Escape', shiftKey: false, preventDefault: vi.fn() }
    trapModalTab(e, panel, first, list)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })
})

describe('shouldCloseOnScrimPress · 遮罩按压回焦合同（D05-r02）', () => {
  it('按在遮罩本体：返回 true 且先 preventDefault（抑制默认焦点转移到 body）', () => {
    const pd = vi.fn()
    const e = { target: 'scrim', currentTarget: 'scrim', preventDefault: pd }
    expect(shouldCloseOnScrimPress(e)).toBe(true)
    expect(pd).toHaveBeenCalled()
  })

  it('按在面板内部（target≠currentTarget）：返回 false 且不 preventDefault，文本选择照常', () => {
    const pd = vi.fn()
    const e = { target: 'panel-child', currentTarget: 'scrim', preventDefault: pd }
    expect(shouldCloseOnScrimPress(e)).toBe(false)
    expect(pd).not.toHaveBeenCalled()
  })
})
