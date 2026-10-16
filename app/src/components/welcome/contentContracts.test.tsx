import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WelcomePage from '../WelcomePage'
import ProcessStage from './ProcessStage'

/**
 * M4 内容合同（SSR 输出）。只校验展示层文案与结构合同：
 *  - flow-rail 四张缩略示意 + "流程示意，非运行状态"，不捏造数字/PASS；
 *  - ProcessStage 四步可读内容，桌面舞台与移动内联共享同一份；
 *  - 评审入口自然中文、三条 href 原样保留、不暴露技术说明、不误称故障；
 *  - 护照空态说明清楚 + 复用已有演示入口、不伪造记录。
 */

const wp = renderToStaticMarkup(<WelcomePage onEnter={() => {}} />)
const ps = renderToStaticMarkup(<ProcessStage />)

describe('M28 分别代表（设备系统体验 / 已封存成果）', () => {
  it('设备系统体验：真实可操作代表，标注演示库而非当前站机组', () => {
    expect(wp).toContain('设备系统体验')
    expect(wp).toContain('螺杆空压机')
    expect(wp).toContain('离心空压机')
    expect(wp).toContain('储气罐')
    expect(wp).toContain('演示库，不是当前站机组')
    expect(wp).toContain('data-boundary="unknown"')
    // 四类型各自形态（非同一 rotor）：每种设备一个 data-device 元素
    for (const d of ['screw', 'centrifugal', 'tank', 'dryer']) expect(wp).toContain(`data-device="${d}"`)
    expect(wp).toContain('查看该类型的资料与边界')
    // 默认选中螺杆→真实关联 AC-01/AC-02（非全部无数据）；tank/dryer 才走诚实空态分支
    expect(wp).toContain('device-real-units')
    expect(wp).toContain('AC-01')
    // 旧四同义流程节点已移除
    expect((wp.match(/class="qh-flow-shot"/g) || []).length).toBe(0)
    expect(wp).not.toContain('FROM INPUT TO DECISION')
  })

  it('已封存成果：真实护照或空态准备步骤，不预造记录', () => {
    // SSR 无本地存储 → 空态准备步骤 + 实际比较入口
    expect(wp).toContain('尚无已封存成果')
    expect(wp).toContain('进入方案比较')
    expect(wp).toContain('#/schedule/compare')
  })

  it('不填假数字、不写 PASS', () => {
    expect(wp).not.toMatch(/\bPASS\b/)
    expect(wp).not.toMatch(/\b(OK|FAIL)\b/)
  })
})

describe('M4 ProcessStage 可读内容', () => {
  const points = [
    '来源与口径可追溯',
    '单位与量纲统一',
    '时段与聚合窗口明确',
    '多候选并排比较',
    '能耗与启停取舍',
    '约束冲突显式列出',
    '容量与边界校核',
    '安全余量检查',
    '独立复验规则',
    '人工确认后才生效',
    '审批与合成执行分离',
    '权限边界与留痕',
  ]
  it('四步可读内容齐全且桌面/移动共享同一份（各出现两次）', () => {
    for (const p of points) {
      expect(ps, `缺少内容：${p}`).toContain(p)
      expect((ps.match(new RegExp(p, 'g')) || []).length, `未共享：${p}`).toBe(2)
    }
  })

  it('保留既有 data-*/rv 合同（不改滚动与 sticky 逻辑）', () => {
    expect(ps).toContain('data-node="INPUT"')
    expect(ps).toContain('data-node="APPROVAL"')
    expect(ps).toContain('data-proc-step="0"')
    expect(ps).toContain('data-proc-step="3"')
    expect(ps).toContain('data-media-step="0"')
    expect(ps).toContain('data-media-stage')
    expect(ps).toContain('rail-item rv')
    expect(ps).toContain('proc-sticky')
  })
})

describe('M4 评审入口', () => {
  it('自然中文入口，三条 href 原样保留', () => {
    expect(wp).toContain('查看候选方案与取舍')
    expect(wp).toContain('查看需求超界时如何拒绝')
    expect(wp).toContain('回看已封存的决策与证据')
    expect(wp).toContain('scenario=normal')
    expect(wp).toContain('scenario=surge')
    expect(wp).toContain('#/records/audit')
  })

  it('不再向读者暴露技术说明，也不把 surge 误称为故障', () => {
    expect(wp).not.toContain('（scenario=normal）')
    expect(wp).not.toContain('（scenario=surge）')
    expect(wp).not.toContain('候选方案与对比（')
    // surge（需求超界）不得被误称为故障；“故障”仅作为设备系统演示状态出现。
    expect(wp).not.toContain('需求超界时故障')
    expect(wp).toContain('故障（演示）')
    expect(wp).not.toContain('真实路由')
  })
})

describe('M4 护照空态', () => {
  it('空态说明 + 复用已有演示入口，不伪造记录', () => {
    expect(wp).toContain('尚无决策护照')
    expect(wp).toContain('生成并封存一次方案后')
    expect(wp).toContain('真实记录')
    // 演示入口存在（r45 A5：Hero 主入口 + 护照空态复用；末尾 CTA 大卡已删）
    expect((wp.match(/进入评审演示/g) || []).length).toBeGreaterThanOrEqual(2)
    // 无伪造护照字段
    expect(wp).not.toMatch(/护照 ID<\/span>/)
  })
})
