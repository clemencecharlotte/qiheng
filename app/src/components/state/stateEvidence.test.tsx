import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import StateEvidence, { retryDisabledFor, type ConnectionStateKind, type GovernanceMessage, type SourceTimes } from './StateEvidence'

const FULL_SOURCE: SourceTimes = {
  sourceId: 'src-gw-prod-north-01',
  sourceObservedAt: '2026-10-08T09:15:00Z',
  receivedAt: '2026-10-08T09:15:02.480Z',
  heartbeatAt: '2026-10-08T09:14:58Z',
}

const MESSAGES: GovernanceMessage[] = [
  { id: 'gv-1', severity: 'info', text: '来源登记已通过核验。', at: '2026-10-08T09:15:02Z' },
]

describe('StateEvidence · 五态 label 合同（真实接线合同映射）', () => {
  const cases: Array<[ConnectionStateKind, string]> = [
    ['unconfigured', '未配置'],
    ['loading', '读取中'],
    ['error', '错误'],
    ['offline', '离线'],
    ['ready', '已加载'],
  ]
  it.each(cases)('%s → %s', (state, label) => {
    const html = renderToString(<StateEvidence state={state} />)
    expect(html).toContain(label)
  })

  it('「已加载」恒为最近批次，任何状态下都不宣称在线/live', () => {
    const ready = renderToString(<StateEvidence state="ready" />)
    expect(ready).toContain('最近批次')
    for (const s of ['unconfigured', 'loading', 'error', 'offline', 'ready'] as const) {
      const html = renderToString(<StateEvidence state={s} />)
      expect(html).not.toMatch(/在线<\/span>|live<\/span>/i)
      expect(html).not.toContain('u-sev__live')
    }
  })
})

describe('StateEvidence · retry 禁用合同', () => {
  it('unconfigured/loading 禁用；error/offline/ready 可用', () => {
    expect(retryDisabledFor('unconfigured')).toBe(true)
    expect(retryDisabledFor('loading')).toBe(true)
    expect(retryDisabledFor('error')).toBe(false)
    expect(retryDisabledFor('offline')).toBe(false)
    expect(retryDisabledFor('ready')).toBe(false)
  })
  it('渲染 disabled 属性与 aria-disabled 只出现在禁用态', () => {
    const blocked = renderToString(<StateEvidence state="unconfigured" onRetry={() => {}} />)
    expect(blocked).toContain('disabled=""')
    expect(blocked).toContain('aria-disabled="true"')
    const open = renderToString(<StateEvidence state="offline" onRetry={() => {}} />)
    expect(open).not.toContain('disabled=""')
    expect(open).not.toContain('aria-disabled')
  })
})

describe('StateEvidence · 来源三时间与未知呈现', () => {
  it('三时间分别呈现且原样输出（不格式化、不造日期）', () => {
    const html = renderToString(<StateEvidence state="ready" source={FULL_SOURCE} />)
    expect(html).toContain('来源观测')
    expect(html).toContain('接收时间')
    expect(html).toContain('心跳时间')
    expect(html).toContain('2026-10-08T09:15:00Z')
    expect(html).toContain('2026-10-08T09:15:02.480Z')
    expect(html).toContain('2026-10-08T09:14:58Z')
  })

  it('null 时间 → 「未知」，不造 0、不造时间戳', () => {
    const html = renderToString(
      <StateEvidence state="ready" source={{ sourceId: 's1', sourceObservedAt: null, receivedAt: null, heartbeatAt: null }} />,
    )
    expect((html.match(/未知/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(html).not.toContain('1970')
    expect(html).not.toContain('>0<')
  })

  it('陈旧观测/时效未知为宿主判定输入，以文字标注（不只靠颜色）', () => {
    const stale = renderToString(<StateEvidence state="ready" source={FULL_SOURCE} sourceFreshness="stale" />)
    expect(stale).toContain('陈旧观测')
    const unknown = renderToString(<StateEvidence state="ready" source={FULL_SOURCE} sourceFreshness="unknown" />)
    expect(unknown).toContain('时效未知')
    const fresh = renderToString(<StateEvidence state="ready" source={FULL_SOURCE} sourceFreshness="fresh" />)
    expect(fresh).not.toContain('陈旧观测')
  })
})

describe('StateEvidence · 动态错误/拒绝不藏 details', () => {
  const reason = '上游治理服务拒绝本次读取：签名不一致（evidence-ref #GV-2026-1008-042）。'
  it('错误 reason 在 summary 之前的 details 外层渲染', () => {
    const html = renderToString(<StateEvidence state="error" reason={reason} />)
    const atReason = html.indexOf(reason)
    const atDetails = html.indexOf('<details')
    expect(atReason).toBeGreaterThan(-1)
    expect(atReason).toBeLessThan(atDetails)
  })

  it('长中文拒绝原文完整呈现（不被截断、不造省略内容）', () => {
    const long = '上游治理服务拒绝本次读取：' + '工作区绑定签名与来源登记不一致，'.repeat(8) + '请核对授权后重试。'
    const html = renderToString(<StateEvidence state="error" reason={long} />)
    expect(html).toContain(long)
  })

  it('消息读取失败同样在 details 外，且不造未读红点/人数', () => {
    const html = renderToString(<StateEvidence state="ready" messagesStatus="error" />)
    const atMsgErr = html.indexOf('治理事件读取失败')
    const atDetails = html.indexOf('<details')
    expect(atMsgErr).toBeGreaterThan(-1)
    expect(atMsgErr).toBeLessThan(atDetails)
    expect(html).not.toContain('未读')
    expect(html).not.toContain('条新')
  })
})

describe('StateEvidence · 治理事件四态与克制 aria', () => {
  it('空态/读取中如实；不造未读红点/人数', () => {
    expect(renderToString(<StateEvidence state="ready" messagesStatus="empty" />)).toContain('暂无治理事件')
    expect(renderToString(<StateEvidence state="ready" messagesStatus="loading" />)).toContain('治理事件读取中')
    const html = renderToString(<StateEvidence state="ready" messages={MESSAGES} messagesStatus="ready" />)
    expect(html).toContain('来源登记已通过核验')
    expect(html).not.toContain('未读')
  })

  it('aria-live=polite 仅状态行；无 assertive、无对话框语义', () => {
    const html = renderToString(<StateEvidence state="error" reason="x" />)
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toContain('aria-live="assertive"')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('aria-modal')
  })

  it('dense 工具条密度：无 details 明细区；retry 保留禁用合同', () => {
    const html = renderToString(<StateEvidence state="error" reason="拒绝" dense onRetry={() => {}} />)
    expect(html).not.toContain('<details')
    expect(html).toContain('u-sev--dense')
    const blocked = renderToString(<StateEvidence state="loading" dense onRetry={() => {}} />)
    expect(blocked).toContain('disabled=""')
  })

  it('静态声明由 footnote 承载（最近来源非全部来源）', () => {
    const html = renderToString(
      <StateEvidence state="ready" source={FULL_SOURCE} footnote="仅最近来源，非全部来源" />,
    )
    expect(html).toContain('仅最近来源，非全部来源')
  })
})

describe('StateEvidence r02 · inline 重试同合同（治理读取失败不可绕过禁用）', () => {
  it('unconfigured + messagesStatus=error → 「重试读取」disabled+aria-disabled', () => {
    const html = renderToString(<StateEvidence state="unconfigured" messagesStatus="error" onRetry={() => {}} />)
    const btn = html.slice(html.indexOf('重试读取') - 400, html.indexOf('重试读取'))
    expect(btn).toContain('disabled=""')
    expect(btn).toContain('aria-disabled="true"')
  })

  it('loading + messagesStatus=error → inline 重试同样禁用', () => {
    const html = renderToString(<StateEvidence state="loading" messagesStatus="error" onRetry={() => {}} />)
    const btn = html.slice(html.indexOf('重试读取') - 400, html.indexOf('重试读取'))
    expect(btn).toContain('disabled=""')
  })

  it('error/offline + messagesStatus=error → inline 重试可用', () => {
    for (const s of ['error', 'offline'] as const) {
      const html = renderToString(<StateEvidence state={s} messagesStatus="error" onRetry={() => {}} />)
      const btn = html.slice(html.indexOf('重试读取') - 400, html.indexOf('重试读取'))
      expect(btn).not.toContain('disabled=""')
    }
  })

  it('dense + messagesStatus=error：治理读取失败在折叠外可见（不静默隐藏），inline 同禁用', () => {
    const html = renderToString(<StateEvidence state="unconfigured" messagesStatus="error" dense onRetry={() => {}} />)
    expect(html).toContain('治理事件读取失败')
    expect(html).not.toContain('<details')
    const btn = html.slice(html.indexOf('重试读取') - 400, html.indexOf('重试读取'))
    expect(btn).toContain('disabled=""')
  })
})

describe('StateEvidence r02 · dense reason 第二行完整可见（桌面不截断）', () => {
  const longReason =
    '上游治理服务拒绝本次读取：' + '工作区绑定签名与来源登记不一致，'.repeat(8) + '请核对授权后重试。'
  it('dense 长拒绝全文渲染，无 title 属性兜底依赖、无 details 收纳', () => {
    const html = renderToString(<StateEvidence state="error" reason={longReason} dense onRetry={() => {}} />)
    expect(html).toContain(longReason)
    expect(html).not.toContain('<details')
    expect(html).not.toContain(`title="${longReason.slice(0, 20)}`)
    // reason 独立于状态行元素（第二行结构），不再是 line 内 span
    expect(html).toContain('u-sev__reason-inline')
    expect(html).not.toContain('<span class="u-sev__reason-inline"')
  })
})
