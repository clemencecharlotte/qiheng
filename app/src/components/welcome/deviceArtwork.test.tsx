import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DeviceArtwork, { DEVICE_FRAMES_R41, DEVICE_RESID_R41 } from './DeviceArtwork'

/**
 * r41 · 设备图集机构契约（窄测，DOM 结构层）：
 * - 八类外观层只渲染一次已批准 atlas；原理层零 atlas、带原理标签与相位注记；
 * - 每类携带自己的真实机构部件（部件名即机制语义，r41 真差异化）；
 * - 居中契约：viewBox == 测量 reframe（连通域证据 atlas-bbox-r41.json）、
 *   preserveAspectRatio=xMidYMid meet、残差整组补偿 transform 存在；
 * - 相位确定性：同相位 markup 恒等、异相位 markup 不同（纯函数烘焙）；
 * - 旧像素裁切旋转层（叠影来源）不得回归；同树多实例 clip id 唯一。
 * 本测试不冒充浏览器视觉验收（见 r41 证据包多时刻渲染件）。
 */
const TYPES = ['screw', 'centrifugal', 'piston', 'tank', 'dryer', 'adsorber', 'filter', 'valve'] as const
const MECH_CONTRACT: Record<string, string[]> = {
  screw: ['mech-cw', 'mech-ccw', 'chamber'],
  centrifugal: ['mech-cw', 'vane'],
  piston: ['mech-piston', 'mech-crank', 'mech-valve'],
  tank: ['mech-gauge', 'mech-needle', 'particle', 'mech-drain'],
  dryer: ['mech-refrig', 'mech-sep', 'mech-drain'],
  adsorber: ['mech-tower-a', 'mech-tower-b', 'mech-stage'],
  filter: ['mech-pleat', 'mech-dp', 'trapped'],
  valve: ['mech-ball', 'bore', 'branch'],
}

describe('r41 device artwork mechanism contract', () => {
  it('shell mode renders the approved atlas exactly once inside its measured frame clip', () => {
    for (const t of TYPES) {
      const html = renderToStaticMarkup(<DeviceArtwork typeId={t} mode="shell" />)
      expect(html, `${t} atlas href`).toContain('/assets/devices/device-family-r01.png')
      expect(html.match(/device-family-r01\.png/g)?.length, `${t} atlas drawn once`).toBe(1)
      expect(html, `${t} type class`).toContain(`art-${t}`)
      expect(html, `${t} mechanism layer`).toContain('qh-mech')
      expect(html, `${t} mechanism window`).toContain('mech-window')
    }
  })
  it('each type carries its own real mechanism parts, not generic decoration', () => {
    for (const t of TYPES) {
      const html = renderToStaticMarkup(<DeviceArtwork typeId={t} phase={1.3} mode="shell" />)
      for (const cls of MECH_CONTRACT[t]) expect(html, `${t} missing ${cls}`).toContain(cls)
    }
  })
  it('principle mode drops the atlas and carries labels plus a phase note', () => {
    for (const t of TYPES) {
      const html = renderToStaticMarkup(<DeviceArtwork typeId={t} phase={2.1} mode="principle" />)
      expect(html, `${t} principle has no atlas`).not.toContain('device-family-r01.png')
      expect(html, `${t} principle labels`).toContain('mech-label')
      expect(html, `${t} phase note`).toContain('mech-phase')
      expect(html, `${t} principle class`).toContain('is-principle')
    }
  })
  it('centering contract: measured viewBox + meet + whole-group residual compensation', () => {
    for (const t of TYPES) {
      const html = renderToStaticMarkup(<DeviceArtwork typeId={t} mode="shell" />)
      expect(html, `${t} viewBox`).toContain(`viewBox="${DEVICE_FRAMES_R41[t].join(' ')}"`)
      expect(html, `${t} preserveAspectRatio`).toContain('preserveAspectRatio="xMidYMid meet"')
      const [rx, ry] = DEVICE_RESID_R41[t]
      expect(html, `${t} residual compensation`).toContain(`translate(${(-rx).toFixed(2)} ${(-ry).toFixed(2)})`)
    }
  })
  it('phase is deterministic: same phase identical markup, different phases differ', () => {
    for (const t of TYPES) {
      const a = renderToStaticMarkup(<DeviceArtwork typeId={t} phase={1.7} />)
      const a2 = renderToStaticMarkup(<DeviceArtwork typeId={t} phase={1.7} />)
      const b = renderToStaticMarkup(<DeviceArtwork typeId={t} phase={4.9} />)
      expect(a, `${t} pure`).toBe(a2)
      expect(a, `${t} phase moves geometry`).not.toBe(b)
    }
  })
  it('the pixel-crop moving layer (ghosting source) never returns', () => {
    for (const t of TYPES) {
      const html = renderToStaticMarkup(<DeviceArtwork typeId={t} mode="shell" />)
      expect(html, `${t} pixel part`).not.toContain('art-mechanical-part')
      expect(html, `${t} nested svg crop`).not.toContain('<svg x=')
    }
  })
  it('two instances in one tree never share clip ids', () => {
    const html = renderToStaticMarkup(<><DeviceArtwork typeId="tank" mode="shell" /><DeviceArtwork typeId="tank" mode="shell" /></>)
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThanOrEqual(2)
    expect(new Set(ids).size, 'all ids unique').toBe(ids.length)
  })
  it('shell frame clip is referenced by url(#id) per instance', () => {
    const html = renderToStaticMarkup(<DeviceArtwork typeId="adsorber" mode="shell" />)
    const clip = html.match(/clipPath id="([^"]+)"/)?.[1]
    expect(clip, 'frame clip id').toBeTruthy()
    expect(html).toContain(`url(#${clip})`)
  })
  it('r45 · rig is the default demo view: layered 2.5D machine, no atlas sticker', () => {
    for (const t of TYPES) {
      const html = renderToStaticMarkup(<DeviceArtwork typeId={t} phase={0.7} />)
      expect(html, `${t} rig layer`).toContain('qh-machine-rig')
      expect(html, `${t} rig has no atlas`).not.toContain('device-family-r01.png')
      expect(html, `${t} rig cutaway`).toContain('rig-cut')
    }
    const a = renderToStaticMarkup(<DeviceArtwork typeId="screw" phase={0.4} />)
    const b = renderToStaticMarkup(<DeviceArtwork typeId="screw" phase={0.8} />)
    expect(a, 'rig phase moves geometry').not.toBe(b)
  })
})
