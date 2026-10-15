import type { AgentViewSnapshot } from './evidenceReturn'
export interface AgentWindowProvenance { startMinute:number; endMinute:number; snapshotHash?:string }
/** Only the completed tool's immutable reference, never later edited input fields. */
export function agentWindowProvenance(view:AgentViewSnapshot | undefined, runIdentity:string):AgentWindowProvenance | undefined {
  if (!view || view.runIdentity!==runIdentity) return
  const result=view.result as {state?:string;name?:string;snapshotHash?:string;refs?:Array<{kind?:string;source?:string;startMinute?:number;endMinute?:number}>} | null
  if(result?.state!=='ok' || result.name!=='get_time_window') return
  const ref=result.refs?.find(r=>r.kind==='window' && r.source==='synthetic_history')
  if(!ref || !Number.isFinite(ref.startMinute) || !Number.isFinite(ref.endMinute) || ref.endMinute!<ref.startMinute!) return
  return {startMinute:ref.startMinute!,endMinute:ref.endMinute!,snapshotHash:result.snapshotHash}
}
