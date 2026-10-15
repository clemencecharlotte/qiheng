import { useEffect } from 'react'

export interface EvidenceFocus {
  workspace: string
  target: string
  nonce: number
}

export function useEvidenceFocus(
  focus: EvidenceFocus | null | undefined,
  onResolve?: (target: string) => void,
) {
  useEffect(() => {
    if (!focus || !focus.target) return
    onResolve?.(focus.target)
    const element = document.querySelector(
      `[data-evidence="${focus.target}"]`,
    )
    if (!element) return
    element.scrollIntoView({ block: 'center', behavior: 'smooth' })
    element.classList.add('evidence-flash')
    if (element instanceof HTMLElement) {
      element.focus({ preventScroll: true })
    }
    const timer = setTimeout(() => element.classList.remove('evidence-flash'), 1800)
    return () => clearTimeout(timer)
  }, [focus?.nonce])
}