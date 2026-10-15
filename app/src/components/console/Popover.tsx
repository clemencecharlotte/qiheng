import { useRef, useState, type ReactNode } from 'react'
import OriginDialog from '../unified/OriginDialog'

/**
 * S1 工具层弹层（M11 统一原语适配）：
 * 保留原有 `label/title/children/renderContent(close)` API 与真实内容，
 * 弹层本体改用 unified OriginDialog（同一 portal/背景隔离/滚动锁/焦点围栏/Esc/遮罩/反转/回焦）。
 * renderContent(close) 的 close 仍请求关闭；关闭动画结束后 OriginDialog 统一回焦本次触发按钮。
 */
export default function Popover({ label, title, children, renderContent }: { label: string; title: string; children?: ReactNode; renderContent?: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const close = () => setOpen(false)

  return (
    <div className="topbar-pop">
      <button
        type="button"
        ref={triggerRef}
        className="btn topbar-pop-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <OriginDialog
        open={open}
        onClose={close}
        originRef={triggerRef}
        title={title}
      >
        {renderContent ? renderContent(close) : children}
      </OriginDialog>
    </div>
  )
}
