import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createDataClient } from '../../integration/client'
import { createConsoleData } from '../../integration/consoleData'
import { consoleDataBus } from '../../integration/consoleDataBus'
import { readEnv } from '../../integration/env'
import { describeAge } from '../../integration/state'
import StatusBadge from './StatusBadge'
import { Popover } from '../ui/Disclosure'

/**
 * M10 · 控制台连接/新鲜度状态（壳层）。
 * 诚实显示：unconfigured/loading/error/offline/ready；sourceId 与三时间分离；
 * 本地钟仅本地；未知不填 0；可点击重试。离线批次不标 live。
 * StrictMode 可重入：每次 setup 新建控制器。
 */
function stamp(iso: string | null | undefined, now: number): string {
  if (!iso) return '—'
  return `${iso}（${describeAge(now, iso)}）`
}

export default function ConnectionState() {
  const env = readEnv()
  const baseUrl = env.VITE_QH_DATA_BASE
  const enabled = env.VITE_QH_DATA_ENABLED !== '0' && Boolean(baseUrl)
  const client = useMemo(() => createDataClient({ baseUrl: baseUrl ?? '/api/qh-data' }), [baseUrl])

  const [ctl, setCtl] = useState(() => createConsoleData(client))
  const state = useSyncExternalStore(ctl.subscribe, ctl.get, ctl.get)
  const refreshRef = useRef(ctl.load)
  refreshRef.current = ctl.load

  useEffect(() => {
    const c = createConsoleData(client)
    setCtl(c)
    if (enabled) void c.load()
    return () => c.dispose()
  }, [client, enabled])

  // 发布快照给命令面板/消息弹层：禁用时归一化为明确的 unconfigured（不被默认 loading 覆盖）。
  const snap = useSyncExternalStore(ctl.subscribe, ctl.get, ctl.get)
  useEffect(() => {
    consoleDataBus.publish(
      enabled ? snap : { ...snap, status: 'unconfigured', reason: '只读数据服务未配置', error: null },
    )
  }, [snap, enabled])
  // 注册“导入成功等写操作后的只读刷新”薄桥（POST 仍只发一次）；禁用时不请求。
  useEffect(() => {
    const unregister = consoleDataBus.registerRefresh(() => { if (enabled) void ctl.load() })
    return () => { unregister() }
  }, [ctl, enabled])

  const now = Date.now()
  const s = state.sourceState
  const rawStatus = enabled ? state.status : 'unconfigured'
  const label =
    !enabled ? '未配置'
      : state.status === 'loading' ? '读取中'
        : state.status === 'error' ? '错误'
          : state.status === 'offline' ? '离线'
            : '已加载'
  const tone = enabled
    ? state.status === 'ready' ? 'normal' : state.status === 'error' ? 'severe' : state.status === 'offline' ? 'disconnected' : 'idle'
    : 'disabled'
  const reason = enabled ? state.reason : '只读数据服务未配置'
  const loaded = enabled && state.status === 'ready'
  const latestBatch = state.batches[0]

  // D1：ready 的“仅离线批次（非实时）”从常驻正文移入「已加载」语义浮层（真实 sourceId/三时间/更新范围）。
  if (loaded) {
    return (
      <div className="topbar-conn" data-status={rawStatus}>
        <Popover
          label={<StatusBadge tone={tone} label={label} className="topbar-conn-badge topbar-conn-ready" />}
          ariaLabel="只读数据服务：已加载，点开查看来源与时间"
        >
          <div className="topbar-conn-loaded">
            <p>{reason || '已加载'}</p>
            <p>来源 {s?.sourceId ?? '未知'}</p>
            <p className="topbar-conn-times">
              观测 {stamp(s?.sourceObservedAt, now)} · 接收 {stamp(s?.receivedAt, now)} · 心跳 {stamp(s?.heartbeatAt, now)}
            </p>
            <p>
              更新范围：离线批次 {state.batches.length} 批
              {latestBatch ? ` · 最近 ${latestBatch.entity} · ${latestBatch.totalRows} 行（有效 ${latestBatch.validRows}）· ${latestBatch.receivedAt}` : ' · 暂无批次'}
            </p>
            <p className="hint">离线批次非实时，不视为在线连接。</p>
          </div>
        </Popover>
      </div>
    )
  }

  return (
    <div className="topbar-conn" data-status={rawStatus}>
      <StatusBadge
        tone={tone}
        label={label}
        className={`topbar-conn-badge topbar-conn-${rawStatus}`}
      />
      <span className="topbar-conn-reason">{reason}</span>
      {enabled && (state.status === 'error' || state.status === 'offline') ? (
        <button type="button" className="topbar-conn-retry" onClick={() => void refreshRef.current()}>
          重试
        </button>
      ) : null}
    </div>
  )
}
