import { NOTES, type NoteKey } from './notes'

/**
 * M15 r01 · 真实脚注交叉引用角标（路由中立）。
 * 只派发 qh:note-open{detail.id}：由 NotesBar 展开后聚焦/滚动对应项（挂载后聚焦，latest-wins）。
 * 不改 hash/canonical/滚动与返回点。
 */
export default function NoteRef({ note, text }: { note: NoteKey; text?: string }) {
  const def = NOTES[note]
  return (
    <sup className="qh-note-ref">
      <button
        type="button"
        data-qh-note-ref={def.id}
        aria-label={`脚注 ${def.n}：${text ?? def.short}（跳到底部脚注）`}
        onClick={(e) => {
          e.preventDefault()
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('qh:note-open', { detail: { id: def.id } }))
          }
        }}
      >
        {def.n}
      </button>
    </sup>
  )
}
