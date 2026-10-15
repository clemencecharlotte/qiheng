import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DataIngressPanel, { DataIngressView, type DataIngressViewProps } from './DataIngressPanel'
import type { BatchSummary, Observation, QualityReport, SourceState } from '../integration/contracts'

const noop = () => {}

const BATCH: BatchSummary = {
  id: 'b1', sourceId: 'synth-air-1', entity: 'compressor-A3', format: 'csv', filename: 's.csv',
  ruleVersion: 'qh-readonly-validate/1', receivedAt: '2026-10-07T04:00:00.000Z',
  totalRows: 4, validRows: 2, isolatedRows: 1, rejectedRows: 1, status: 'partial', unordered: false, note: '记录级校验',
}
const QUALITY: QualityReport = {
  batchId: 'b1', ruleVersion: 'qh-readonly-validate/1', status: 'partial', unordered: false, note: '非官方质量门',
  counts: { total: 4, valid: 2, isolated: 1, rejected: 1 },
  rejectReasons: [{ reason: 'non_finite_value', c: 1 }], isolateReasons: [{ reason: 'duplicate_key', c: 1 }],
  rejections: [{ rowIndex: 2, reason: 'non_finite_value', raw: '{...}' }],
}
const OBS: Observation[] = [
  { id: 1, batchId: 'b1', sourceId: 'synth-air-1', entity: 'compressor-A3', metric: 'power', value: 118.5, unit: 'kW', observedAt: '2026-10-07T00:15:00.000Z', receivedAt: '2026-10-07T04:00:00.000Z', quality: 'valid', reason: null },
]
const SRC: SourceState = {
  sourceId: 'synth-air-1', configured: true, sourceObservedAt: '2026-10-07T00:15:00.000Z',
  receivedAt: '2026-10-07T04:00:00.000Z', heartbeatAt: '2026-10-07T04:00:05.000Z',
  status: 'unconfigured', observationCount: 2, ruleVersion: 'qh-readonly-validate/1',
}

function view(over: Partial<DataIngressViewProps> = {}) {
  return renderToStaticMarkup(
    <DataIngressView
      enabled
      status="offline"
      statusReason="仅有离线批次，无实时连接"
      busy={false}
      errorText={null}
      importMsg={null}
      batches={[]}
      selected={null}
      sourceState={null}
      sourceLabel="最近加载来源"
      now={Date.UTC(2026, 9, 7, 12, 0, 0)}
      staleMs={15 * 60 * 1000}
      onPickFile={noop}
      onSelectBatch={noop}
      onRetry={noop}
      onDownloadTemplate={noop}
      onDownloadSample={noop}
      {...over}
    />,
  )
}

describe('M06 DataIngressView (SSR states)', () => {
  it('disabled -> unconfigured empty state, no file input', () => {
    const html = view({ enabled: false, status: 'unconfigured', statusReason: '只读数据服务未配置' })
    expect(html).toContain('只读数据服务未配置')
    expect(html).toContain('data-testid="qdi-empty"')
    expect(html).not.toContain('data-testid="qdi-file"')
  })

  it('enabled empty -> file input + retry + offline note + separated timestamps', () => {
    const html = view()
    expect(html).toContain('data-testid="qdi-file"')
    expect(html).toContain('data-testid="qdi-retry"')
    expect(html).toContain('来源观察时间')
    expect(html).toContain('批次接收时间（服务生成）')
    expect(html).toContain('服务心跳（服务生成）')
    expect(html).toContain('离线批次')
    expect(html).not.toContain('>实时<')
  })

  it('provides local template/sample downloads and a stable anchor', () => {
    const html = view()
    expect(html).toContain('data-testid="qdi-template"')
    expect(html).toContain('data-testid="qdi-sample"')
    expect(html).toContain('id="qh-data-ingress"')
    expect(html).toContain('id="qh-data-ingress-h"')
  })

  it('detail loading/error are explicit distinct states', () => {
    expect(view({ detailStatus: 'loading' })).toContain('data-testid="qdi-detail-loading"')
    const err = view({ detailStatus: 'error', detailError: '批次详情加载失败', onRetryDetail: noop })
    expect(err).toContain('data-testid="qdi-detail-error"')
    expect(err).toContain('data-testid="qdi-detail-retry"')
  })

  it('renders no literal markdown asterisks', () => {
    expect(view()).not.toContain('**')
  })

  it('selected batch -> counts, reject reasons, observation rows, no fabricated value', () => {
    const html = view({ batches: [BATCH], selected: { batch: BATCH, quality: QUALITY, observations: OBS }, sourceState: SRC })
    expect(html).toContain('118.5')
    expect(html).toContain('non_finite_value')
    expect(html).toContain('拒绝原因')
    // 计数来自真实数据，不伪造 0 补齐
    expect(html).toContain('<b>2</b>')
    expect(html).toContain('<b>1</b>')
  })

  it('error -> alert + retry', () => {
    const html = view({ errorText: '无法连接只读数据服务（后端未启用或不可达）。' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('无法连接只读数据服务')
    expect(html).toContain('data-testid="qdi-retry"')
  })

  it('status pill never claims live for offline data', () => {
    expect(view({ status: 'offline' })).toContain('离线')
    expect(view({ status: 'stale' })).toContain('陈旧')
  })
})

describe('M06 DataIngressPanel (default, no env)', () => {
  it('renders unconfigured empty state without network', () => {
    const html = renderToStaticMarkup(<DataIngressPanel />)
    expect(html).toContain('只读数据服务未配置')
    expect(html).toContain('services/readonly-data')
  })
})
