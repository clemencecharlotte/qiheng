import { useEffect, useRef } from 'react'
import UnitRoster from '../components/UnitRoster'
import DemoFleet from '../components/welcome/DemoFleet'
import { DEMO_DEVICE_TYPES, DeviceGlyph } from '../components/welcome/DeviceSystemExperience'
import type { Unit, UnitEligibility } from '../domain/types'

/**
 * M29 · 设备 一级工作区（真实宿主，非 slot 页）。
 * 真实候选机组列表（状态/资格/约束/来源时刻）+ 定位到关联证据；
 * 演示设备库属序幕二级视图，不与真实机组混成（不造“很多机器”）。
 */
interface Props {
  demoTarget?: string | null
  onDemoTargetHandled?: () => void
  units: Unit[]
  eligibility: UnitEligibility[]
  onOpenEvidence: (unitId: string) => void
  onOpenMap?: () => void
  clockLabel?: string
  onInspectDemo?: (typeId: string, state: string) => void
}

export default function DeviceWorkspace({ units, eligibility, onOpenEvidence, onOpenMap, clockLabel, onInspectDemo, demoTarget, onDemoTargetHandled }: Props) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!demoTarget || !DEMO_DEVICE_TYPES.some(t => t.id === demoTarget)) return
    const frame = requestAnimationFrame(() => {
      const card = [...(root.current?.querySelectorAll<HTMLElement>("[data-instance]") ?? [])].find(el => el.dataset.device === demoTarget)
      if (!card) return
      card.tabIndex = -1; card.classList.add("qh-fleet-target"); card.scrollIntoView({block:"center",behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"}); card.focus({preventScroll:true})
      card.addEventListener("blur", () => card.classList.remove("qh-fleet-target"), {once:true})
      onDemoTargetHandled?.()
    })
    return () => cancelAnimationFrame(frame)
  }, [demoTarget, onDemoTargetHandled])
  return (
    <div ref={root} className="workspace device-workspace" data-page="units">
      <section className="page-head" aria-label="设备机组">
        <h2 tabIndex={-1}>设备</h2>
        <details><summary>设备来源与口径</summary><span className="hint">
          真实候选机组（合成调度）；状态/资格/约束/可用数据/来源时刻{clockLabel ? ` · 观察时刻 ${clockLabel}` : ''}。
        </span></details>
        {onOpenMap ? (
          <button type="button" className="btn ghost" onClick={onOpenMap}>在关系MAP中查看</button>
        ) : null}
      </section>
      <UnitRoster units={units} eligibility={eligibility} onOpenEvidence={onOpenEvidence} />

      {/* M29 r30 · 真实机组与演示设备库明确分组；演示库复用同一 DEMO_DEVICE_TYPES/DeviceGlyph/DemoFleet，不另造时钟/假机组。 */}
      <DemoFleet
        targetType={demoTarget}
        types={DEMO_DEVICE_TYPES}
        renderGlyph={(typeId, phase) => <DeviceGlyph id={typeId} phase={phase} />}
        onInspect={onInspectDemo}
      />
    </div>
  )
}
