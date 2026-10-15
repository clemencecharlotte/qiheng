import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createDataClient, DataApiError, type DataClient } from '../integration/client'
import { readEnv } from '../integration/env'
import { createIngressSelection, type DetailStatus } from '../integration/ingressSelection'
import { CONNECTION_LABEL, deriveConnection, describeAge } from '../integration/state'
import type {
  BatchSummary,
  ConnectionStatus,
  Observation,
  QualityReport,
  SourceState,
} from '../integration/contracts'
import NoteRef from './console/NoteRef'
import './DataIngressPanel.css'

const DEFAULT_STALE_MS = 15 * 60 * 1000
const OBS_PREVIEW = 8

const TEMPLATE_CSV =
  'sourceId,entity,metric,value,unit,observedAt\n' +
  'synth-air-1,compressor-A3,power,118.5,kW,2026-10-07T08:15:00+08:00\n'
const SAMPLE_CSV =
  'sourceId,entity,metric,value,unit,observedAt\n' +
  'synth-air-1,compressor-A3,power,118.5,kW,2026-10-07T08:15:00+08:00\n' +
  'synth-air-1,compressor-A3,power,119.1,kW,2026-10-07T08:30:00+08:00\n' +
  'synth-air-1,compressor-A3,discharge_pressure,0.72,MPa,2026-10-07T08:15:00+08:00\n' +
  'synth-air-1,compressor-A3,energy,36.9,kWh,2026-10-07T08:00:00+08:00\n'

/** 浏览器侧下载文本（不依赖服务器文件）。 */
function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export interface IngressSelection {
  batch: BatchSummary
  quality: QualityReport | null
  observations: Observation[]
}

export interface DataIngressViewProps {
  enabled: boolean
  status: ConnectionStatus
  statusReason: string
  busy: boolean
  errorText: string | null
  importMsg: string | null
  batches: BatchSummary[]
  selected: IngressSelection | null
  detailStatus?: DetailStatus
  detailError?: string | null
  sourceState: SourceState | null
  sourceLabel: string
  now: number
  staleMs: number
  onPickFile: (file: File) => void
  onSelectBatch: (id: string) => void
  onRetry: () => void
  onRetryDetail?: () => void
  onDownloadTemplate: () => void
  onDownloadSample: () => void
  onOpenEvents?: (sourceId: string) => void
}

function stamp(iso: string | null, now: number): string {
  if (!iso) return '—'
  return `${iso}（${describeAge(now, iso)}）`
}

/** 纯展示视图（可在无副作用环境下 SSR 测试）。 */
export function DataIngressView(props: DataIngressViewProps) {
  const {
    enabled, status, statusReason, busy, errorText, importMsg, batches, selected, sourceState, sourceLabel, now,
    onPickFile, onSelectBatch, onRetry, onDownloadTemplate, onDownloadSample, onOpenEvents,
  } = props
  const detailStatus: DetailStatus = props.detailStatus ?? (selected ? 'ready' : 'idle')

  return (
    <section className="qh-data-ingress" id="qh-data-ingress" aria-labelledby="qh-data-ingress-h" data-connection={status}>
      <header className="qdi-hd">
        <div>
          <p className="qdi-eyebrow">Readonly data ingress / 只读数据接入</p>
          <h3 id="qh-data-ingress-h" tabIndex={-1}>离线批次导入与治理</h3>
        </div>
        <span className={`qdi-status qdi-status-${status}`} role="status">
          {CONNECTION_LABEL[status]} · {statusReason}
        </span>
      </header>

      {!enabled ? (
        <p className="qdi-empty" data-testid="qdi-empty">
          只读数据服务未配置。设置 <code>VITE_QH_DATA_BASE</code> 并启动
          <code> services/readonly-data</code> 后，这里才显示导入与批次查询。
        </p>
      ) : (
        <>
          <div className="qdi-actions">
            <label className="qdi-file">
              <span>选择 CSV / JSON 文件</span>
              <input
                type="file"
                accept=".csv,.json,text/csv,application/json"
                data-testid="qdi-file"
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0]
                  if (f) onPickFile(f)
                  e.currentTarget.value = ''
                }}
              />
            </label>
            <button type="button" className="qdi-retry" onClick={onRetry} disabled={busy} data-testid="qdi-retry">
              {busy ? '处理中…' : '刷新'}
            </button>
            <button type="button" className="qdi-link" onClick={onDownloadTemplate} data-testid="qdi-template">
              下载字段模板 CSV
            </button>
            <button type="button" className="qdi-link" onClick={onDownloadSample} data-testid="qdi-sample">
              下载示例批次 CSV
            </button>
          </div>

          {importMsg ? <p className="qdi-importmsg" data-testid="qdi-importmsg">{importMsg}</p> : null}
          {errorText ? (
            <p className="qdi-error" role="alert" data-testid="qdi-error">{errorText}</p>
          ) : null}

          <div className="qdi-grid">
            <div className="qdi-batches">
              <h4>批次（{batches.length}）</h4>
              {batches.length === 0 ? (
                <p className="qdi-muted">暂无批次。导入一个离线文件后显示。</p>
              ) : (
                <ul className="qdi-batchlist">
                  {batches.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        className={selected && selected.batch.id === b.id ? 'qdi-batch active' : 'qdi-batch'}
                        onClick={() => onSelectBatch(b.id)}
                        data-testid="qdi-batch"
                      >
                        <span className="qdi-batch-src">{b.sourceId}</span>
                        <span className="qdi-batch-meta">
                          {b.format.toUpperCase()} · 有效 {b.validRows} / 隔离 {b.isolatedRows} / 拒绝 {b.rejectedRows}
                        </span>
                        <span className="qdi-batch-time">{b.receivedAt}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="qdi-detail">
              <h4>批次详情与质量</h4>
              {detailStatus === 'loading' ? (
                <p className="qdi-muted" data-testid="qdi-detail-loading">批次详情加载中…</p>
              ) : detailStatus === 'error' ? (
                <p className="qdi-error" role="alert" data-testid="qdi-detail-error">
                  {props.detailError ?? '批次详情加载失败。'}
                  {props.onRetryDetail ? (
                    <button type="button" onClick={props.onRetryDetail} data-testid="qdi-detail-retry">重试</button>
                  ) : null}
                </p>
              ) : !selected ? (
                <p className="qdi-muted">选择左侧批次，查看记录级质量与观测。</p>
              ) : (
                <>
                  <ul className="qdi-counts">
                    <li><b>{selected.batch.totalRows}</b><span>总行</span></li>
                    <li><b>{selected.batch.validRows}</b><span>有效</span></li>
                    <li><b>{selected.batch.isolatedRows}</b><span>隔离</span></li>
                    <li><b>{selected.batch.rejectedRows}</b><span>拒绝</span></li>
                  </ul>
                  <p className="qdi-muted">规则版本 {selected.batch.ruleVersion}；{selected.batch.note}</p>
                  {onOpenEvents ? (
                    <button
                      type="button"
                      className="qdi-link"
                      data-testid="qdi-open-events"
                      onClick={() => onOpenEvents(selected.batch.sourceId)}
                    >
                      查看本源相关事件
                    </button>
                  ) : null}
                  {selected.quality && selected.quality.rejections.length > 0 ? (
                    <details className="qdi-reasons">
                      <summary>拒绝原因（按需展开，{selected.quality.rejections.length}）</summary>
                      <ul>
                        {selected.quality.rejections.map((r) => (
                          <li key={`${r.rowIndex}-${r.reason}`}>
                            行 {r.rowIndex}：<b>{r.reason}</b>
                            {r.raw ? <code>{r.raw.slice(0, 80)}</code> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {selected.observations.length > 0 ? (
                    <table className="qdi-obs">
                      <thead>
                        <tr><th>metric</th><th>value</th><th>unit</th><th>observedAt</th><th>quality</th></tr>
                      </thead>
                      <tbody>
                        {selected.observations.slice(0, OBS_PREVIEW).map((o) => (
                          <tr key={o.id}>
                            <td>{o.metric}</td><td>{o.value}</td><td>{o.unit}</td>
                            <td>{o.observedAt}</td><td>{o.quality}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <p className="qdi-src-label" data-testid="qdi-src-label">时间来源：{sourceLabel}</p>
          <dl className="qdi-times">
            <div><dt>来源观察时间</dt><dd>{stamp(sourceState?.sourceObservedAt ?? null, now)}</dd></div>
            <div><dt>批次接收时间（服务生成）</dt><dd>{stamp(sourceState?.receivedAt ?? null, now)}</dd></div>
            <div><dt>服务心跳（服务生成）</dt><dd>{stamp(sourceState?.heartbeatAt ?? null, now)}</dd></div>
          </dl>

          <p className="qdi-note">
            导入为<strong>离线批次</strong>，不标记为实时（live）；质量结果为<strong>记录级校验</strong>，
            不等同官方 15 分钟质量门。面板只读<NoteRef note="offline" />。
          </p>
        </>
      )}
    </section>
  )
}

export interface DataIngressPanelProps {
  client?: DataClient
  enabled?: boolean
  staleMs?: number
  clock?: () => number
  /** 受控对象定位：URL batchId（bounded）。 */
  initialBatchId?: string | null
  /** 选择变化回写 URL（供浏览器前后退）。 */
  onLocate?: (batchId: string | null) => void
  /** 导入成功薄桥：请求壳层/搜索/消息只读刷新（不重复 POST）。 */
  onImported?: () => void
  /** 打开本源相关治理事件（batch→events）。 */
  onOpenEvents?: (sourceId: string) => void
}

export default function DataIngressPanel({ client, enabled, staleMs = DEFAULT_STALE_MS, clock = Date.now, initialBatchId = null, onLocate, onImported, onOpenEvents }: DataIngressPanelProps) {
  const env = readEnv()
  const baseUrl = env.VITE_QH_DATA_BASE
  const isEnabled = enabled ?? (env.VITE_QH_DATA_ENABLED !== '0' && Boolean(baseUrl))
  const dataClient = useMemo(
    () => client ?? createDataClient({ baseUrl: baseUrl ?? '/api/qh-data' }),
    [client, baseUrl],
  )

  const [status, setStatus] = useState<ConnectionStatus>(isEnabled ? 'connecting' : 'unconfigured')
  const [statusReason, setStatusReason] = useState(isEnabled ? '正在连接只读数据服务' : '只读数据服务未配置')
  const [busy, setBusy] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [sourceState, setSourceState] = useState<SourceState | null>(null)
  const busySeq = useRef(0)
  const initialBatchIdRef = useRef(initialBatchId)
  initialBatchIdRef.current = initialBatchId

  const [selection, setSelection] = useState<ReturnType<typeof createIngressSelection>>(() => createIngressSelection(dataClient))
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const detail = useSyncExternalStore(selection.subscribe, selection.get, selection.get)

  // 选中来源时间：按当前所选 batch.sourceId 与选择代次取（latest-wins；旧源晚答不覆盖新源）。
  const [activeSource, setActiveSource] = useState<SourceState | null>(null)
  const srcGen = useRef(0)
  const selectedSourceId = detail.status === 'ready' && detail.batch ? detail.batch.sourceId : null
  useEffect(() => {
    if (!selectedSourceId) { setActiveSource(null); return }
    const my = ++srcGen.current
    dataClient.getSourceState(selectedSourceId)
      .then((st) => { if (my === srcGen.current) setActiveSource(st) })
      .catch(() => { if (my === srcGen.current) setActiveSource(null) })
  }, [selectedSourceId, dataClient])
  const displaySource = selectedSourceId ? activeSource : sourceState
  const sourceLabel = selectedSourceId ? '当前选择来源' : '最近加载来源'

  const now = clock()

  const refresh = useCallback(async () => {
    selectionRef.current.clear() // 新查询：立即失效旧选择与旧读
    if (!isEnabled) {
      setStatus('unconfigured')
      setStatusReason('只读数据服务未配置')
      return
    }
    const my = ++busySeq.current
    setBusy(true)
    setErrorText(null)
    try {
      await dataClient.health()
      const list = await dataClient.listBatches()
      let src: SourceState | null = null
      if (list.items.length > 0) src = await dataClient.getSourceState(list.items[0].sourceId)
      if (my !== busySeq.current) return // latest-wins：旧刷新不写回
      setBatches(list.items)
      // refresh 会 clear 选择；若有 URL 目标，列表就绪后恢复该目标（深链/重放不落空）。
      if (initialBatchIdRef.current) selectionRef.current.select(initialBatchIdRef.current)
      setSourceState(src)
      const derived = deriveConnection({ enabled: true, sourceState: src, staleMs, now: clock() })
      setStatus(derived.status)
      setStatusReason(derived.reason)
    } catch (e) {
      if (my !== busySeq.current) return
      const err = e as DataApiError
      const network = err instanceof DataApiError && err.status === 0
      setErrorText(network ? '无法连接只读数据服务（后端未启用或不可达）。' : `只读数据服务返回错误：${err.code ?? 'unknown'}`)
      const derived = deriveConnection({ enabled: true, networkError: network, apiError: !network, staleMs, now: clock() })
      setStatus(derived.status)
      setStatusReason(derived.reason)
    } finally {
      if (my === busySeq.current) setBusy(false) // 旧请求不清新 busy
    }
  }, [dataClient, isEnabled, staleMs, clock])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // StrictMode 可重入：每次 setup 新建控制器，cleanup 递增 busySeq 使在途回写永久失效。
  useEffect(() => {
    const s = createIngressSelection(dataClient)
    selectionRef.current = s
    setSelection(s)
    void refreshRef.current()
    return () => {
      busySeq.current += 1
      s.dispose()
    }
  }, [dataClient, isEnabled])

  // URL 受控对象定位：batchId 变化时选中对应批次；无 batchId 时清空详情（返回列表不留旧证据）。
  useEffect(() => {
    const s = selectionRef.current
    if (initialBatchId) {
      if (initialBatchId !== s.get().batchId) s.select(initialBatchId)
    } else if (s.get().batchId) {
      s.clear()
    }
  }, [initialBatchId])

  const onPickFile = useCallback(
    async (file: File) => {
      const my = ++busySeq.current // 上传即失效旧读/旧选择（写已开始，不假装取消）
      selectionRef.current.clear()
      setBusy(true)
      setImportMsg(null)
      setErrorText(null)
      try {
        const text = await file.text()
        const format: 'csv' | 'json' = /\.csv$/i.test(file.name) ? 'csv' : 'json'
        const result = await dataClient.importBatch(text, { format, filename: file.name })
        if (my !== busySeq.current) return
        setImportMsg(
          `${result.idempotent ? '幂等命中（已存在）' : '已导入'}：有效 ${result.counts.valid} / 隔离 ${result.counts.isolated} / 拒绝 ${result.counts.rejected} 行`,
        )
        onImported?.()
      } catch (e) {
        if (my !== busySeq.current) return
        const err = e as DataApiError
        const network = err instanceof DataApiError && err.status === 0
        setErrorText(network ? '导入失败：无法连接只读数据服务。' : `导入失败：${err.code ?? 'unknown'}`)
      } finally {
        if (my === busySeq.current) setBusy(false)
      }
      await refresh()
    },
    [dataClient, refresh],
  )

  const viewProps: DataIngressViewProps = {
    enabled: isEnabled,
    status,
    statusReason,
    busy,
    errorText,
    importMsg,
    batches,
    selected: detail.status === 'ready' && detail.batch
      ? { batch: detail.batch, quality: detail.quality, observations: detail.observations }
      : null,
    detailStatus: detail.status,
    detailError: detail.error,
    sourceState: displaySource,
    sourceLabel,
    now,
    staleMs,
    onPickFile: (f) => void onPickFile(f),
    onSelectBatch: (id) => { selectionRef.current.select(id); onLocate?.(id) },
    onRetry: () => void refresh(),
    onRetryDetail: () => selectionRef.current.retry(),
    onDownloadTemplate: () => downloadText('qh-data-template.csv', TEMPLATE_CSV),
    onDownloadSample: () => downloadText('qh-data-sample-batch.csv', SAMPLE_CSV),
    onOpenEvents,
  }
  return <DataIngressView {...viewProps} />
}
