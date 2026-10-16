// @vitest-environment jsdom
import { agentWindowProvenance } from '../integration/agentWindowProvenance'
import type { AgentViewSnapshot } from '../integration/evidenceReturn'
// Isolated jsdom is provided by the established project setup.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import ConsoleTour from './ConsoleTour'
import App from '../App'
import ObservationTransport from './ObservationTransport'
import SupplyDemandTrend from './SupplyDemandTrend'
import HistoryTrend from './HistoryTrend'
import { replayWindow } from './replayWindow'
import { runScenario } from '../domain/engine'
import type { ObservationClockApi } from './useObservationClock'

const api = (index: number) => ({ effectiveIndex:index, hoverIndex:null, range:null, state:{brushStart:null} } as ObservationClockApi)
let root: Root | undefined
afterEach(() => { if (root) { act(() => root!.unmount()); root = undefined }; document.body.innerHTML = ''; localStorage.removeItem('qiheng.console-tour.v1'); localStorage.removeItem('qiheng.tour.v3.schedule'); localStorage.removeItem('qiheng.tour.v3.map'); vi.restoreAllMocks() })
describe('same-clock display projection', () => {
  it('never invents a prefix or combines loop laps', () => {
    expect(replayWindow(96,0,true)).toEqual([0,1])
    expect(replayWindow(96,48,true)).toEqual([33,49])
    expect(replayWindow(96,95,true)).toEqual([80,96])
    expect(replayWindow(96,0,true)).toEqual([0,1])
  })
  it('supports full comparison, invalid index and empty data', () => {
    expect(replayWindow(96,48,false)).toEqual([0,96])
    expect(replayWindow(0,10,true)).toEqual([0,0])
    expect(replayWindow(96,NaN,true)).toEqual([0,1])
  })
  it('real supply path changes with observation, not just marker x', () => {
    const run = runScenario('normal')
    const markup = (index:number) => renderToStaticMarkup(<SupplyDemandTrend run={run} plan={run.recommendation} planLabel="建议" activeUnitId={null} activeHasBranch={false} api={api(index)} />)
    const path = (html:string) => html.match(/class="series demand" d="([^"]+)/)?.[1]
    expect(path(markup(48))).toBeTruthy()
    expect(path(markup(48))).not.toBe(path(markup(49)))
  })
  it('history bar heights change while nulls remain explicit and rows stay untouched', () => {
    const points = Array.from({length:32},(_,i)=>({label:`${i}`,value:i===12?null:i+1,grade:'pass' as const}))
    const before = JSON.stringify(points)
    const markup = (index:number) => renderToStaticMarkup(<HistoryTrend points={points} unit="kWh" metricLabel="能量" api={api(index)} />)
    expect(markup(20)).not.toEqual(markup(21))
    expect(markup(20)).toContain('missing-tick')
    expect(JSON.stringify(points)).toBe(before)
  })
})
describe('real Driver component lifecycle', () => {
  function mount() {
    Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
    window.requestAnimationFrame = cb => window.setTimeout(() => cb(performance.now()), 0)
    Object.assign(globalThis, {requestAnimationFrame:window.requestAnimationFrame.bind(window)})
    window.cancelAnimationFrame = id => window.clearTimeout(id)
    window.matchMedia = vi.fn().mockReturnValue({matches:true,addEventListener(){},removeEventListener(){}})
    HTMLElement.prototype.scrollIntoView = vi.fn()
    document.body.innerHTML='<header class="app-topbar"></header><nav class="app-nav"></nav><div id="test-root"></div>'
    root=createRoot(document.getElementById('test-root')!)
    act(()=>root!.render(<ConsoleTour routeKey="schedule/overview" />))
  }
  it('invites once, postpones without business-data side effects and supports replay', () => {
    localStorage.setItem('user-passports','untouched')
    mount()
    const later=[...document.querySelectorAll('button')].find(b=>b.textContent==='跳过')!
    act(()=>later.click())
    expect(document.querySelector('.tour-invite')).toBeNull()
    expect(localStorage.getItem('user-passports')).toBe('untouched')
    // r45 ⑥ · 重开入口由宿主（App 左导航工具行）提供，ConsoleTour 自身不再渲染游离按钮。
    expect(document.querySelector('.tour-replay')).toBeNull()
    localStorage.removeItem('user-passports')
  })
  it('starts actual overlay and cleans it on route change', async () => {
    mount()
    await act(async()=>{ [...document.querySelectorAll('button')].find(b=>b.textContent==='开始导览')!.click(); await new Promise(r=>setTimeout(r,20)) })
    expect(document.querySelector('.driver-overlay')).toBeTruthy()
    expect(document.querySelector('.driver-popover-title')?.textContent).toBe('工作区页头')
    act(()=>root!.render(<ConsoleTour routeKey="map/topology" />))
    expect(document.querySelector('.driver-overlay')).toBeNull()
  })
  it('cleans actual engine overlay on component unmount', async () => {
    mount()
    await act(async()=>{ [...document.querySelectorAll('button')].find(b=>b.textContent==='开始导览')!.click(); await new Promise(r=>setTimeout(r,20)) })
    expect(document.querySelector('.driver-overlay')).toBeTruthy()
    act(()=>root!.unmount()); root=undefined
    expect(document.querySelector('.driver-overlay')).toBeNull()
  })
})



describe('actual App tour integration', () => {
  it('a first console entry offers guide without auth, and later skips do not repeat', async () => {
    Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
    window.history.replaceState(null,'','#/schedule/overview?mode=legacy&scenario=normal')
    window.matchMedia = vi.fn().mockReturnValue({matches:false,addEventListener(){},removeEventListener(){}})
    document.body.innerHTML='<div id="test-root"></div>'
    root=createRoot(document.getElementById('test-root')!)
    await act(async()=>{ root!.render(<App />); await new Promise(r=>setTimeout(r,40)) })
    expect(document.querySelector('.app-shell')).toBeTruthy()
    expect(document.querySelector('.tour-invite')).toBeTruthy()
    act(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='跳过')!.click())
    act(()=>root!.unmount()); root=createRoot(document.getElementById('test-root')!)
    await act(async()=>{ root!.render(<App />); await new Promise(r=>setTimeout(r,40)) })
    expect(document.querySelector('.tour-invite')).toBeNull()
    expect(document.querySelector('[data-testid="rail-guide-btn"]')).toBeTruthy()
  })
})


describe('immutable query provenance', () => {
  const view = {runIdentity:'r',winStart:600,winEnd:700,result:{name:'get_time_window',state:'ok',refs:[{kind:'window',source:'synthetic_history',startMinute:480,endMinute:525}]}} as AgentViewSnapshot
  it('uses result reference, not later edited input',()=>expect(agentWindowProvenance(view,'r')).toMatchObject({startMinute:480,endMinute:525}))
  it('rejects stale entry or non-success',()=>{expect(agentWindowProvenance(view,'other')).toBeUndefined();expect(agentWindowProvenance({...view,result:{state:'failed'}},'r')).toBeUndefined()})
})


describe('saved ranges do not turn dynamic replay off',()=>{
 it('still changes real bar heights while preserving selection semantics',()=>{
  const points=Array.from({length:32},(_,i)=>({label:String(i),value:i+1,grade:'pass' as const}))
  const html=(i:number)=>renderToStaticMarkup(<HistoryTrend points={points} unit="kWh" metricLabel="能量" api={{...api(i),range:[0,3]} as ObservationClockApi}/>)
  expect(html(20).match(/height="[\d.]+"/g)).not.toEqual(html(21).match(/height="[\d.]+"/g))
 })
})


describe('explicit follow playback action',()=>{
 it('does not start a visually frozen locked preview',()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  document.body.innerHTML='<div id="test-root"></div>';root=createRoot(document.getElementById('test-root')!)
  const follow=vi.fn(),toggle=vi.fn()
  const clock={sourceId:'synthetic_schedule',startMinute:0,stepMinutes:15,count:96}
  const contract={...api(48),clock,locked:true,newBuckets:0,observationLabel:'12:00',looping:true,setLooping:()=>{},state:{playing:false,speed:1,brushStart:null},follow,toggle} as unknown as ObservationClockApi
  act(()=>root!.render(<ObservationTransport api={contract} sourceLabel="调度" onFullWindow={()=>{}} onLastHour={()=>{}} rangeSummary={null} outOfRange={null}/>))
  const play=document.querySelector<HTMLButtonElement>('.transport-play')!
  expect(play.textContent).toBe('跟随播放');act(()=>play.click());expect(follow).toHaveBeenCalledTimes(1);expect(toggle).toHaveBeenCalledTimes(1)
 })
})
