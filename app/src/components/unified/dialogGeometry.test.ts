import { describe, expect, it } from 'vitest'
import {
  centeredPanelRect,
  chooseClosingTarget,
  chooseOpeningFrom,
  clampProgress,
  flipFromAnchor,
  identityPose,
  isUsableRect,
  lerpPose,
  vanishedPose,
} from './dialogGeometry'

describe('dialogGeometry · FLIP 位姿纯函数', () => {
  it('flipFromAnchor：面板从触发器中心展开（x/y=中心差，scale=宽比带下限）', () => {
    const anchor = { left: 300, top: 12, width: 120, height: 44 } // 触发按钮
    const panel = centeredPanelRect(1440, 900, 380, 320) // 最终居中 (530,290)
    const pose = flipFromAnchor(anchor, panel)
    expect(pose.x).toBeCloseTo(360 - 720, 5) // anchorCx 360 → panelCx 720
    expect(pose.y).toBeCloseTo(34 - 450, 5)
    expect(pose.scale).toBe(0.4) // 下限 0.4（120/380=0.316 触底）
    expect(pose.opacity).toBe(0.4)
  })

  it('触发器过宽时 scale 封顶为 1，过窄时下限 0.4', () => {
    const panel = centeredPanelRect(1440, 900, 380, 320)
    const wide = flipFromAnchor({ left: 0, top: 0, width: 900, height: 44 }, panel)
    expect(wide.scale).toBe(1)
    const narrow = flipFromAnchor({ left: 0, top: 0, width: 8, height: 8 }, panel)
    expect(narrow.scale).toBe(0.4)
  })

  it('本位位姿恒等；消失触发器=就地短淡出（无角飞）', () => {
    expect(identityPose()).toEqual({ x: 0, y: 0, scale: 1, opacity: 1 })
    const v = vanishedPose()
    expect(v).toEqual({ x: 0, y: 0, scale: 0.97, opacity: 0 })
  })

  it('lerpPose 沿进度连续插值（快速中途关/重开合同）', () => {
    const a = { x: -200, y: 100, scale: 0.5, opacity: 0.4 }
    const b = identityPose()
    const half = lerpPose(a, b, 0.5)
    expect(half.x).toBeCloseTo(-100, 5)
    expect(half.y).toBeCloseTo(50, 5)
    expect(half.scale).toBeCloseTo(0.75, 5)
    expect(half.opacity).toBeCloseTo(0.7, 5)
    expect(lerpPose(a, b, -1)).toEqual(lerpPose(a, b, 0))
    expect(lerpPose(a, b, 2)).toEqual(lerpPose(a, b, 1))
  })

  it('isUsableRect 拒绝非有限/零尺寸矩形（来源消失判定）', () => {
    expect(isUsableRect({ left: 0, top: 0, width: 10, height: 10 })).toBe(true)
    expect(isUsableRect({ left: 0, top: 0, width: 0, height: 10 })).toBe(false)
    expect(isUsableRect(null)).toBe(false)
  })

  it('clampProgress 截断 [0,1]', () => {
    expect(clampProgress(-0.2)).toBe(0)
    expect(clampProgress(0.5)).toBe(0.5)
    expect(clampProgress(1.4)).toBe(1)
  })
})

describe('chooseOpeningFrom · 组件 startOpen/layout-effect 实际调用的 from 决策（r03 残留1）', () => {
  const panel = centeredPanelRect(1440, 900, 380, 320)
  const anchor = { left: 300, top: 12, width: 120, height: 44 }
  // r03 实测：重开前 closing 中途位姿 scale≈.540348 / translate(-349.619,187.538)
  const midClose = { x: -349.619, y: 187.538, scale: 0.540348, opacity: 0.7 }

  it('反转（closing→open）：优先本次采样位姿（含 opacity），绝不回锚点 FLIP', () => {
    const from = chooseOpeningFrom({ reversal: true, sampled: midClose, anchor, originConnected: true, panelFinal: panel })
    expect(from).toEqual(midClose) // 不是 flipFromAnchor(anchor) 的 -456/244/.4
    expect(from.x).not.toBeCloseTo(-456.37, 1)
    expect(from.scale).not.toBeCloseTo(0.4, 3)
  })

  it('反转且采样缺失 → 就地短淡出兜底（无 identity 突跳、无锚点飞入）', () => {
    expect(chooseOpeningFrom({ reversal: true, sampled: null, anchor, originConnected: true, panelFinal: panel })).toEqual(vanishedPose())
  })

  it('完整 closed→open + 来源有效 → 才用本次来源 FLIP（与 flipFromAnchor 一致）', () => {
    const from = chooseOpeningFrom({ reversal: false, sampled: midClose, anchor, originConnected: true, panelFinal: panel })
    expect(from).toEqual(flipFromAnchor(anchor, panel))
  })

  it('完整 open + 来源无效 → 采样兜底→消失淡出；无采样同效', () => {
    const withSample = chooseOpeningFrom({ reversal: false, sampled: midClose, anchor: null, originConnected: false, panelFinal: panel })
    expect(withSample).toEqual(midClose)
    const none = chooseOpeningFrom({ reversal: false, sampled: null, anchor: null, originConnected: false, panelFinal: panel })
    expect(none).toEqual(vanishedPose())
    // 缓存的旧 anchor 也必须被拒绝（isUsableRect=false 的矩形不产生 FLIP）
    const stale = chooseOpeningFrom({ reversal: false, sampled: null, anchor: { left: -456.37, top: 244.8, width: 0, height: 0 }, originConnected: true, panelFinal: panel })
    expect(stale).toEqual(vanishedPose())
  })
})

describe('chooseClosingTarget · 组件 startClose 实际调用的 target 决策（r03 残留2）', () => {
  const panel = centeredPanelRect(1440, 900, 380, 320)
  const pose = { x: -349.619, y: 187.538, scale: 0.540348, opacity: 1 }

  it('来源有效（startClose 重测后的新 anchor）→ 未变换布局 rect 的 FLIP 终点', () => {
    const anchor = { left: 300, top: 12, width: 120, height: 44 }
    const target = chooseClosingTarget({ anchor, pose, panelFinal: panel })
    expect(target).toEqual(flipFromAnchor(anchor, panel))
    expect(target.x).toBeCloseTo(360 - 720, 5)
  })

  it('来源隐藏/移除（重测返回 null）→ 当前位置仅 opacity 淡出：保留 pose.x/y，不 identity、不飞旧坐标', () => {
    const target = chooseClosingTarget({ anchor: null, pose, panelFinal: panel })
    expect(target.x).toBe(-349.619)
    expect(target.y).toBe(187.538)
    expect(target.scale).toBe(0.540348)
    expect(target.opacity).toBe(0)
    expect(target).not.toEqual(identityPose())
  })

  it('旧缓存坐标不是合法输入通道：即使误传零矩形也按无效处理（就地淡出）', () => {
    const stale = { left: -456.37, top: 244.8, width: 0, height: 0 }
    const target = chooseClosingTarget({ anchor: stale, pose, panelFinal: panel })
    expect(target.x).toBe(-349.619)
    expect(target.opacity).toBe(0)
  })
})
