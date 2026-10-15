import { useSyncExternalStore } from 'react'
import { consoleDataBus } from '../../integration/consoleDataBus'
import { describeAge } from '../../integration/state'
import { Popover } from '../ui/Disclosure'

const LABEL: Record<string, string> = {
  unconfigured: '未配置',
  loading: '读取中',
  error: '错误',
  offline: '离线',
  ready: '已加载',
}

function stamp(iso: string | null | undefined, now: number): string {
  if (!iso) return '未知'
  return `${iso}（${describeAge(now, iso)}）`
}

/**
 * M14 r01 · 移动端顶栏紧凑连接状态角标。
 * 顶栏默认收齐时仍**就近可见**动态安全状态（未配置/读取中/错误/离线/已加载）；
 * 不作在线/账号声明。M28 r01：ready 原因从原生 title 移入真实浮层（含来源/三时间/更新范围），
 * hover/focus 短提示、点击/触屏固定长文、Esc 回本次入口；error/offline/unconfigured 就近短风险保留。
 */
export default function ConnectionBadge() {
  const snap = useSyncExternalStore(consoleDataBus.subscribe, consoleDataBus.get, () => null)
  const status = snap?.status ?? 'loading'
  const now = Date.now()
  const s = snap?.sourceState ?? null
  const loaded = status === 'ready'
  const latestBatch = snap?.batches?.[0]

  return (
    <Popover
      label={<span className={`topbar-status-chip topbar-status-${status}`}>{LABEL[status] ?? status}</span>}
      ariaLabel={`只读数据服务：${LABEL[status] ?? status}（点开查看来源与时间）`}
    >
      <div className="topbar-conn-loaded">
        <p>{snap?.reason ?? '只读数据服务状态未知'}</p>
        {loaded ? (
          <>
            <p>来源 {s?.sourceId ?? '未知'}</p>
            <p className="topbar-conn-times">
              观测 {stamp(s?.sourceObservedAt, now)} · 接收 {stamp(s?.receivedAt, now)} · 心跳 {stamp(s?.heartbeatAt, now)}
            </p>
            <p>
              更新范围：离线批次 {snap?.batches?.length ?? 0} 批
              {latestBatch ? ` · 最近 ${latestBatch.entity} · ${latestBatch.totalRows} 行（有效 ${latestBatch.validRows}）· ${latestBatch.receivedAt}` : ' · 暂无批次'}
            </p>
            <p className="hint">离线批次非实时，不视为在线连接。</p>
          </>
        ) : null}
      </div>
    </Popover>
  )
}
