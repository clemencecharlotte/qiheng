import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import NotesBar from './NotesBar'

describe('M10 r03 NotesBar context', () => {
  it('synthetic keeps fixed-seed wording', () => {
    const html = renderToStaticMarkup(<NotesBar sceneLabel="常态" />)
    expect(html).toContain('固定种子')
  })
  it('offline states real source, no synthetic fixed-seed claim; keeps device/approval boundary', () => {
    const html = renderToStaticMarkup(<NotesBar sceneLabel="离线批次 / 治理事件（只读，非实时）" context="offline" />)
    expect(html).toContain('离线 CSV / JSON 批次')
    expect(html).not.toContain('固定种子')
    expect(html).toContain('不连接真实 PLC/SCADA')
    expect(html).toContain('批准与执行只记录合成演示状态')
  })
})
