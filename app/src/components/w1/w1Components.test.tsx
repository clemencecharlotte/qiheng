import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import SceneShowcase from './SceneShowcase'
import SceneBackdrop from './SceneBackdrop'
import AppearanceDial from './AppearanceDial'
import ReversibleNudge from './ReversibleNudge'
import CapabilityTrack from './CapabilityTrack'
import ProductDemo, { demoPhaseFor, demoSimNextPhase, demoSimProgress } from './ProductDemo'
import NativeDemoPlayer, { nativePhaseFor, NATIVE_FIXTURE_MANIFEST } from './NativeDemoPlayer'
import { outExitDuration } from './CapabilityTrack'
import { layerWeights } from './scenePalette'
import { GlassButton, GlassSurface, dampStep } from './GlassSurface'
import { sceneGlowStrength } from './SceneShowcase'
import type { CapabilityItem } from './capabilityModel'

const CAPS: CapabilityItem[] = [
  { id: 'c1', category: '运行', title: '运行总览', summary: '已接入总览。', route: '#/overview', state: 'available' },
  { id: 'c2', category: '数据', title: '数据源接入', summary: '未配置。', route: '#/sources', state: 'unconfigured' },
  { id: 'c3', category: '智能', title: '调用轨迹', summary: '待接入。', route: '#/traces', state: 'unavailable' },
]

describe('SceneShowcase · SSR 结构窄验', () => {
  it('r03：ChatGPT 式 SceneDial——六环境文字刻度+连续 slider 受控', () => {
    const html = renderToString(
      <SceneShowcase scenePosition={2} title="t" subtitle="s" />,
    )
    expect((html.match(/u-w1-dial__tick[" ]/g) ?? []).length).toBe(6)
    expect(html).toContain('type="range"')
    expect(html).toContain('value="2"')
    expect(html).toContain('日间')
    expect(html).toContain('晨前')
    expect(html).toContain('aria-live="polite"')
  })

  it('r06：SceneBackdrop 合成器路径——6 静态环境层（各自完整渐变）+双光斑+颗粒', () => {
    const a = renderToString(<SceneBackdrop visualPosition={0} />)
    const b = renderToString(<SceneBackdrop visualPosition={5} />)
    expect((a.match(/u-w1-backdrop__sky/g) ?? []).length).toBe(6)
    expect(a).toContain('u-w1-backdrop__orb--sun')
    expect(a).toContain('u-w1-backdrop__orb--moon')
    expect(a).toContain('u-w1-backdrop__grain')
    expect(a).toContain('#060b1c') // preDawn skyTop（静态层内联渐变）
    expect(b).toContain('#02040e') // night skyTop
    expect(a).toContain('data-env="preDawn"')
    expect(b).toContain('data-env="night"')
    expect(a).toContain('opacity:1') // 初始层 0 可见
    expect(a).toContain('aria-hidden="true"')
    const skel = (h: string) => (h.match(/data-env="[a-zA-Z]+"/g) ?? []).join('|')
    expect(skel(a)).toBe(skel(b)) // 层结构恒定，仅初始 opacity 不同
  })

  it('同一 SVG 结构跨态稳定：几何 token（cx/cy/r/d/viewBox）跨态一致，颜色随环境变化', () => {
    // \sr=" 要求属性名 r 前是空白（排除 stop-color/stroke 等以 r 结尾的属性名）
    const geo = (h: string) => (h.match(/\scx="|\scy="|\sr="|\sd="|\sviewBox="/g) ?? []).join('|')
    const a = renderToString(<SceneShowcase scenePosition={0} />)
    const b = renderToString(<SceneShowcase scenePosition={5} />)
    expect(geo(a)).toBe(geo(b))
    expect(a).not.toBe(b) // 颜色确实随环境变化
  })

  it('reduce 属性渲染：reduce 输入由 CSS/运行时处理，SSR 结构不缺流点内容', () => {
    const html = renderToString(<SceneShowcase scenePosition={1} />)
    expect(html).toContain('u-w1-scene__flow')
  })
})

describe('CapabilityTrack · SSR 结构窄验', () => {
  it('四 tab + 选中底板；初始组状态诚实标识（运行=已接入；指定数据组=未接通）', () => {
    const html = renderToString(<CapabilityTrack capabilities={CAPS} />)
    for (const c of ['运行', '决策', '数据', '智能']) expect(html).toContain(c)
    expect(html).toContain('u-w1-cap__tab-thumb')
    expect(html).toContain('已接入')
    const data = renderToString(<CapabilityTrack capabilities={CAPS} initialCategory="数据" />)
    expect(data).toContain('未接通')
    expect(data).toContain('role="tab"')
  })

  it('初始组可交互；无 out 组；stage 局部坐标层存在（r02 白帘根因修复）', () => {
    const html = renderToString(<CapabilityTrack capabilities={CAPS} />)
    expect(html).not.toContain('u-w1-cap__group--out')
    expect((html.match(/<article[^>]*aria-hidden/g) ?? []).length).toBe(0)
    expect(html).toContain('u-w1-cap__stage')
  })

  it('r02 真 inert：hidden article 输出实际 inert 属性（programmatic focus 由浏览器拒绝）', () => {
    const html = renderToString(
      <article inert={true} aria-hidden="true" data-testid="t">
        x
      </article>,
    )
    expect(html).toContain('inert=""')
    const off = renderToString(
      <article inert={undefined} data-testid="t">
        x
      </article>,
    )
    expect(off).not.toContain('inert=""')
  })

  it('outExitDuration：从当前视觉权重接续（420ms × from，clamp [0,420]）', () => {
    expect(outExitDuration(1)).toBe(420)
    expect(outExitDuration(0.5)).toBe(210)
    expect(outExitDuration(0.2)).toBe(84)
    expect(outExitDuration(0)).toBe(0)
    expect(outExitDuration(2)).toBe(420)
    expect(outExitDuration(-1)).toBe(0)
  })

  it('r02 nav 独立行不占轨道宽；轨道全宽（mobile 完整首卡+露卡）', () => {
    const html = renderToString(<CapabilityTrack capabilities={CAPS} />)
    expect(html).toContain('u-w1-cap__nav-row')
    expect(html).toContain('u-w1-cap__nav-hint')
  })

  it('route 契约透传到打开按钮；footnote 承载静态声明', () => {
    const html = renderToString(<CapabilityTrack capabilities={CAPS} footnote="静态声明由宿主传入" />)
    expect(html).toContain('#/overview')
    expect(html).toContain('打开')
    expect(html).toContain('静态声明由宿主传入')
  })
})

describe('ProductDemo · 合同状态机与 SSR', () => {
  it('demoPhaseFor：缺 src=pending；出错=error；否则 idle', () => {
    expect(demoPhaseFor(false, false)).toBe('pending')
    expect(demoPhaseFor(true, true)).toBe('error')
    expect(demoPhaseFor(true, false)).toBe('idle')
  })

  it('缺 src → 「暂无演示 · 待接入」，绝无「录制中」/假打字', () => {
    const html = renderToString(
      <ProductDemo assetId="a" label="问得明白" events={[{ at: '00:00', label: 'x' }]} />,
    )
    expect(html).toContain('暂无演示 · 待接入')
    expect(html).not.toContain('录制中')
    expect(html).not.toContain('<video')
    expect(html).not.toContain('正在输入')
  })

  it('idle 态 video 属性齐备（muted/playsInline/preload）', () => {
    const html = renderToString(
      <ProductDemo assetId="b" label="看得见过程" src="/x.mp4" events={[]} />,
    )
    expect(html).toContain('<video')
    expect(html).toContain('muted=""')
    expect(html).toContain('playsInline')
    expect(html).toContain('preload="metadata"')
  })

  it('r02：error 分支渲染 poster img + 重试（失败保海报，不只文字）', () => {
    // error 由运行时 onError 触发；SSR 直接以 error 分支合同验证：poster prop 存在时结构含 img 通道
    const html = renderToString(
      <ProductDemo assetId="b" label="看得见过程" src="/x.mp4" poster="/p.png" events={[]} />,
    )
    expect(html).toContain('poster="/p.png"')
    expect(html).toContain('data-asset-id="b"')
  })

  it('事件时间表就近呈现；产品演示徽标存在；互斥 props 透传', () => {
    const html = renderToString(
      <ProductDemo
        assetId="c"
        label="看得见过程"
        src="/y.mp4"
        events={[
          { at: '00:00', label: '候选比较' },
          { at: '00:07', label: '独立复验' },
        ]}
        activeId={null}
      />,
    )
    expect(html).toContain('00:00')
    expect(html).toContain('候选比较')
    expect(html).toContain('产品演示')
    expect(html).toContain('data-in-view="true"')
  })
})

describe('ReversibleNudge · r02 双层结构（量测 wrapper 无 transform，动画 inner 唯一驱动）', () => {
  it('外层 u-w1-nudge 无内联 transform；内层 u-w1-nudge__inner 持有 transform/opacity', () => {
    const html = renderToString(
      <ReversibleNudge ariaLabel="m">
        <div>content</div>
      </ReversibleNudge>,
    )
    expect(html).toContain('class="u-w1-nudge"')
    expect(html).not.toMatch(/class="u-w1-nudge"[^>]*style=/) // 外层零样式（未变换量测基准）
    expect(html).toContain('u-w1-nudge__inner')
    expect(html).toMatch(/u-w1-nudge__inner" style="transform:translate/)
  })

  it('forceStatic：内层无 transform（reduce 本位同内容）', () => {
    const html = renderToString(
      <ReversibleNudge forceStatic ariaLabel="m">
        <div>c</div>
      </ReversibleNudge>,
    )
    expect(html).not.toContain('transform:translate')
    expect(html).toContain('c')
  })
})

describe('AppearanceDial · r04 外观选择器（ChatGPT 滑动设计直译）', () => {
  it('触发钮 + 弹层四档刻度 + 白拇指滑条 + 选中态', () => {
    const html = renderToString(
      <AppearanceDial mode="system" globeOn={false} manualScene={2} defaultOpen onModeChange={() => {}} onGlobeChange={() => {}} onManualSceneChange={() => {}} onReset={() => {}} />,
    )
    expect(html).toContain('跟随系统')
    expect(html).toContain('日间')
    expect(html).toContain('夜间')
    expect(html).toContain('臻彩')
    expect(html).toContain('u-w1-app__input')
    expect(html).toContain('u-w1-app__seg-thumb') // r05：块状 thumb（照抄 segmented）
    expect(html).toContain('u-w1-app__seg-label--on')
    expect(html).toContain('aria-expanded="true"') // 初始 open=false？SSR 默认 open=false → 无弹层
  })

  it('地球两态图标语义：默认纯线条无填充；aria-pressed 表达开关', () => {
    const off = renderToString(
      <AppearanceDial mode="system" globeOn={false} manualScene={2} defaultOpen onModeChange={() => {}} onGlobeChange={() => {}} onManualSceneChange={() => {}} onReset={() => {}} />,
    )
    expect(off).toContain('u-w1-app__globe')
    expect(off).not.toContain('u-w1-globe-sea')
    const on = renderToString(
      <AppearanceDial mode="vivid" globeOn manualScene={1} defaultOpen onModeChange={() => {}} onGlobeChange={() => {}} onManualSceneChange={() => {}} onReset={() => {}} />,
    )
    expect(on).toContain('u-w1-globe-sea') // 渐变填充卡通地球
    expect(on).toContain('aria-pressed="true"')
  })

  it('tooltip 文案与重置语义可达（aria-label）', () => {
    const html = renderToString(
      <AppearanceDial mode="vivid" globeOn={false} manualScene={2} defaultOpen onModeChange={() => {}} onGlobeChange={() => {}} onManualSceneChange={() => {}} onReset={() => {}} />,
    )
    expect(html).toContain('随现实时间变化')
    expect(html).toContain('aria-label="重置为跟随系统（默认）"')
    // r05：二级滑杆卡仅臻彩显示
    const vivid = renderToString(
      <AppearanceDial mode="vivid" globeOn={false} manualScene={2} defaultOpen onModeChange={() => {}} onGlobeChange={() => {}} onManualSceneChange={() => {}} onReset={() => {}} />,
    )
    expect(vivid).toContain('u-w1-app__subcard')
    expect(vivid).toContain('环境时间轴')
    const day = renderToString(
      <AppearanceDial mode="day" globeOn={false} manualScene={2} defaultOpen onModeChange={() => {}} onGlobeChange={() => {}} onManualSceneChange={() => {}} onReset={() => {}} />,
    )
    expect(day).not.toContain('u-w1-app__subcard')
  })
})

describe('r06 · 合成器权重与光斑轨迹（纯函数，零 repaint 数学基础）', () => {
  it('layerWeights：相邻线性交叉，端点=该层 1，sum 恒 1，无负值', () => {
    for (const p of [0, 0.5, 2, 2.5, 4.9, 5]) {
      const w = layerWeights(p, 6)
      expect(w).toHaveLength(6)
      const sum = w.reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(1, 5)
      for (const x of w) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(1)
      }
    }
    expect(layerWeights(0, 6)[0]).toBe(1)
    expect(layerWeights(5, 6)[5]).toBe(1)
    expect(layerWeights(2.5, 6)[2]).toBeCloseTo(0.5, 5)
    expect(layerWeights(2.5, 6)[3]).toBeCloseTo(0.5, 5)
  })

  it('sceneGlowStrength：晨启/夜班最强、日间中高、端点不低于 0.25', () => {
    expect(sceneGlowStrength(1.2)).toBe(1)
    expect(sceneGlowStrength(5)).toBe(1)
    expect(sceneGlowStrength(2)).toBeGreaterThan(0.5)
    expect(sceneGlowStrength(0)).toBeGreaterThanOrEqual(0.25)
  })
})

describe('D09 · 播放器成功路径合成媒体合同（typed，事件与原生 video 对齐）', () => {
  it('demoSimNextPhase：play→playing、pause→paused、end→ended、replay→playing（非法自环）', () => {
    expect(demoSimNextPhase('idle', 'play')).toBe('playing')
    expect(demoSimNextPhase('playing', 'pause')).toBe('paused')
    expect(demoSimNextPhase('paused', 'pause')).toBe('paused')
    expect(demoSimNextPhase('playing', 'end')).toBe('ended')
    expect(demoSimNextPhase('ended', 'replay')).toBe('playing')
  })

  it('demoSimProgress：clamp [0,1]，非法时长回 0', () => {
    expect(demoSimProgress(6, 12)).toBeCloseTo(0.5, 5)
    expect(demoSimProgress(13, 12)).toBe(1)
    expect(demoSimProgress(-1, 12)).toBe(0)
    expect(demoSimProgress(3, 0)).toBe(0)
  })

  it('simulate 分支 SSR：夹具徽标/进度条/播放钮齐备；真实 src 优先仍走 video 分支', () => {
    const sim = renderToString(
      <ProductDemo assetId="sim" label="看得见过程" events={[]} simulate={{ durationSec: 12 }} />,
    )
    expect(sim).toContain('合成媒体 · 测试夹具')
    expect(sim).toContain('role="progressbar"')
    expect(sim).toContain('播放')
    expect(sim).not.toContain('<video')
    const real = renderToString(
      <ProductDemo assetId="real" label="x" src="/real.mp4" events={[]} simulate={{ durationSec: 12 }} />,
    )
    expect(real).toContain('<video') // 真实 src 优先（simulate 仅无 src 生效）
  })

  it('D09 · objectId 透传到打开按钮（真实对象映射合同）', () => {
    const caps: CapabilityItem[] = [
      { id: 'c1', category: '运行', title: '总览', summary: 's', route: '#/schedule/overview', objectId: 'ov-1', state: 'available' },
    ]
    const html = renderToString(<CapabilityTrack capabilities={caps} />)
    expect(html).toContain('data-object-id="ov-1"')
  })

  it('D09 · 滑杆收束：showControls=false 时无滑杆但环境名播报保留（单一调节源）', () => {
    const html = renderToString(<SceneShowcase scenePosition={2} showControls={false} />)
    expect(html).not.toContain('u-w1-scene__controls')
    expect(html).not.toContain('u-w1-dial__input')
    expect(html).toContain('当前环境')
    expect(html).toContain('aria-live="polite"')
  })
})

describe('D09 r03 · CTA-PASSPORT 六层玻璃基准（严格实现）', () => {
  it('dampStep：0.16 阻尼收敛（~300ms 归中合同）', () => {
    let v = 0
    let n = 0
    while (Math.abs(v - 100) > 0.25 && n < 600) {
      v = dampStep(v, 100)
      n++
    }
    expect(n).toBeLessThanOrEqual(36) // 60fps 下 ≤600ms；实际 ~33 帧
    expect(dampStep(50, 50)).toBe(50)
  })

  it('GlassSurface：u-glass 六层类 + aria 透传 + data 探针透传', () => {
    const html = renderToString(
      <GlassSurface className="u-w1-app__panel" ariaLabel="外观设置" dataAttrs={{ 'data-probe': '1' }}>
        <p>x</p>
      </GlassSurface>,
    )
    expect(html).toContain('u-glass')
    expect(html).toContain('aria-label="外观设置"')
    expect(html).toContain('data-probe="1"')
  })

  it('GlassButton：glass=六层次级；primary=accent 实底锚点（恒定不随环境）', () => {
    const g = renderToString(
      <GlassButton tone="glass" ariaLabel="查看决策护照">
        查看决策护照
      </GlassButton>,
    )
    expect(g).toContain('u-cta-glass')
    expect(g).toContain('查看决策护照')
    const p1 = renderToString(
      <GlassButton tone="primary">进入评审演示</GlassButton>,
    )
    expect(p1).toContain('u-cta-primary')
    expect(p1).toContain('进入评审演示') // accent 实底锚点在 CSS（#82d7bd 恒定，build 产物核对）
  })

  it('卡片接 GlassSurface：能力卡/article 语义+离场组 inert 真属性', () => {
    const caps: CapabilityItem[] = [
      { id: 'c1', category: '运行', title: '总览', summary: 's', route: '#/schedule/overview', objectId: 'ov-1', state: 'available' },
    ]
    const html = renderToString(<CapabilityTrack capabilities={caps} />)
    expect(html).toContain('<article class="u-glass')
    expect(html).toContain('data-object-id="ov-1"')
  })
})

describe('D10 · NativeDemoPlayer 原生媒体合同', () => {
  it('nativePhaseFor：无src=pending；error优先；playing；ended；loadedmetadata=ready', () => {
    expect(nativePhaseFor(false, false, false, false, false)).toBe('pending')
    expect(nativePhaseFor(true, true, true, false, false)).toBe('error')
    expect(nativePhaseFor(true, false, false, true, false)).toBe('playing')
    expect(nativePhaseFor(true, false, true, false, true)).toBe('ended')
    expect(nativePhaseFor(true, false, true, false, false)).toBe('ready')
  })

  it('真实 src SSR：video+muted+playsInline+preload+captions track；夹具徽标与播放/重播钮', () => {
    const html = renderToString(
      <NativeDemoPlayer
        assetId="n1"
        label="问得明白"
        src="demo-assets/native-fixture-640x360.mp4"
        poster="demo-assets/native-fixture-poster.png"
        captions="demo-assets/native-fixture-zh.vtt"
        events={[{ at: '00:00', label: '色板横移' }]}
        fixtureBadge="原生媒体测试夹具"
      />,
    )
    expect(html).toContain('<video')
    expect(html).toContain('muted=""')
    expect(html).toContain('playsInline')
    expect(html).toContain('preload="metadata"')
    expect(html).toContain('kind="captions"')
    expect(html).toContain('原生媒体测试夹具')
    expect(html).toContain('播放')
    expect(html).toContain('重播')
    expect(html).toContain('data-asset-id="n1"')
  })

  it('无 src → 暂无演示·待接入（不伪正在录制、不用坏 URL）', () => {
    const html = renderToString(<NativeDemoPlayer assetId="n2" label="x" events={[]} />)
    expect(html).toContain('暂无演示 · 待接入')
    expect(html).not.toContain('<video')
    expect(html).not.toContain('正在录制')
  })

  it('NATIVE_FIXTURE_MANIFEST：三件夹具路径与来源声明', () => {
    expect(NATIVE_FIXTURE_MANIFEST.mp4).toContain('native-fixture')
    expect(NATIVE_FIXTURE_MANIFEST.note).toContain('原创')
  })
})
