import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import OriginDialog from './unified/OriginDialog'

export type CommandGroup = '设备' | '事件' | '证据' | '主题' | '播放'

export interface CommandItem {
  id: string
  group: CommandGroup
  label: string
  hint: string
  keywords: string
  run: () => void
}

const GROUP_ORDER: CommandGroup[] = ['设备', '事件', '证据', '主题', '播放']

/** 过滤/排序纯逻辑（可测）。 */
export function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase()
  const base = q
    ? items.filter((it) =>
        `${it.label} ${it.hint} ${it.keywords} ${it.group}`.toLowerCase().includes(q),
      )
    : items
  return [...base].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
}

export interface CommandSearchViewProps {
  items: CommandItem[]
  query: string
  active: number
  inputRef?: RefObject<HTMLInputElement | null>
  onQuery: (v: string) => void
  onActive: (i: number) => void
  onRun: (item: CommandItem) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
}

/** 纯展示视图（可 SSR 窄验）：真实 items / 空态 / 可见安全说明。 */
export function CommandSearchView({ items, query, active, inputRef, onQuery, onActive, onRun, onKeyDown }: CommandSearchViewProps) {
  return (
    <div className="cmd" onKeyDown={onKeyDown}>
      <div className="cmd-input-row">
        <input
          ref={inputRef}
          className="cmd-input"
          type="text"
          value={query}
          placeholder="搜索设备 / 事件 / 证据，或切换主题、播放暂停"
          aria-label="命令搜索"
          aria-controls="cmd-list"
          aria-activedescendant={items[active] ? `cmd-item-${items[active].id}` : undefined}
          onChange={(e) => onQuery(e.target.value)}
        />
        <kbd className="cmd-kbd">Esc</kbd>
      </div>

      <p className="cmd-note">
        仅能定位设备 / 事件 / 证据、切换主题、播放暂停；不能通过命令批准、驳回或执行设备。
      </p>

      <ul id="cmd-list" className="cmd-list" role="listbox">
        {items.length === 0 ? (
          <li className="cmd-empty">没有匹配的命令，试试「设备」「事件」「主题」等关键词。</li>
        ) : (
          items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                id={`cmd-item-${item.id}`}
                role="option"
                aria-selected={index === active}
                className={`cmd-item ${index === active ? 'active' : ''}`}
                onMouseEnter={() => onActive(index)}
                onClick={() => onRun(item)}
              >
                <span className="cmd-group">{item.group}</span>
                <span className="cmd-label">{item.label}</span>
                <span className="cmd-hint">{item.hint}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

interface Props {
  open: boolean
  onClose: () => void
  items: CommandItem[]
  /** 本次打开的真实来源（宿主在打开前捕获）；Ctrl+K 由宿主决定。 */
  originRef?: RefObject<HTMLElement | null>
  /** 来源消失时的回焦兜底（真实搜索触发按钮）。 */
  fallbackFocusRef?: RefObject<HTMLElement | null>
}

/**
 * M11 · 搜索命令面板（模态迁入 unified OriginDialog 原语）：
 * 保留真实 items / Arrow / Enter / 空态 / 可见安全说明（只能定位/只读/主题/播放，不能批准执行）；
 * 首次焦点到搜索输入；Esc/遮罩/关闭由 OriginDialog 统一；closing 期间正文/背景隔离到 settle，
 * onAfterClose 才清查询（不 open&&挂载直接截断）。
 */
export default function CommandPalette({ open, onClose, items, originRef, fallbackFocusRef }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => filterCommands(items, query), [items, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query])

  const run = (item: CommandItem | undefined) => {
    if (!item) return
    item.run()
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (filtered.length ? (i + 1) % filtered.length : 0))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      run(filtered[active])
      return
    }
  }

  return (
    <OriginDialog
      open={open}
      onClose={onClose}
      originRef={originRef}
      initialFocusRef={inputRef}
      fallbackFocusRef={fallbackFocusRef}
      onAfterClose={() => {
        setQuery('')
        setActive(0)
      }}
      title="搜索"
    >
      <CommandSearchView
        items={filtered}
        query={query}
        active={active}
        inputRef={inputRef}
        onQuery={setQuery}
        onActive={setActive}
        onRun={(it) => run(it)}
        onKeyDown={onKeyDown}
      />
    </OriginDialog>
  )
}
