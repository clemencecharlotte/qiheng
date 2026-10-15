import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DeviceArtwork from './DeviceArtwork'
import { MECH_PERIOD } from './deviceKinematics'

/**
 * r41 · 三时刻快照契约：每类在 t=0 / P/3 / 2P/3 的 SSR 渲染两两不同（外观与原理双层），
 * 证明机构几何真的随共享相位推进；证据包的多时刻 SVG/PNG 由同一渲染路径导出。
 */
const TYPES = ['screw', 'centrifugal', 'piston', 'tank', 'dryer', 'adsorber', 'filter', 'valve'] as const

describe('r41 three-moment snapshots per type and mode', () => {
  for (const mode of ['shell', 'principle'] as const) {
    it(`${mode}: eight types differ across three clock moments`, () => {
      for (const t of TYPES) {
        const P = MECH_PERIOD[t]
        const m = [0, P / 3, (2 * P) / 3].map((ph) => renderToStaticMarkup(<DeviceArtwork typeId={t} phase={ph} mode={mode} />))
        expect(m[0], `${t} t0!=t1`).not.toBe(m[1])
        expect(m[1], `${t} t1!=t2`).not.toBe(m[2])
        expect(m[0], `${t} t0!=t2`).not.toBe(m[2])
      }
    })
  }
  it('seek determinism: rendering at a host-seek phase repeats exactly', () => {
    const a = renderToStaticMarkup(<DeviceArtwork typeId="adsorber" phase={4.8} />)
    const b = renderToStaticMarkup(<DeviceArtwork typeId="adsorber" phase={4.8} />)
    expect(a).toBe(b)
  })
})
