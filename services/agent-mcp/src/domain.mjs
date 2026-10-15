import { z } from 'zod';
import { createHash } from 'node:crypto';

const id = z.string().min(1).max(100).regex(/^[\w:./-]+$/);
const quantity = z.number().finite().min(0).max(1e9).nullable();
const date = z.string().datetime({ offset: true });
const unitSchema = z.object({
  id, name: z.string().min(1).max(100), kind: z.enum(['screw','centrifugal']),
  ratedCapacity: quantity, ratedPower: quantity,
  minLoadRatio: z.number().finite().min(0).max(1).nullable(),
  minStartStopInterval: quantity,
  surgeBoundaryVerified: z.boolean(), eligible: z.boolean(),
  eligibilityReason: z.string().max(1000).nullable()
}).strict();
const pointSchema = z.object({
  index: z.number().int().min(0).max(1e7), minute: z.number().finite().min(0).max(1e7),
  unitId: id.nullable(), demand: quantity, flow: quantity, power: quantity, energy: quantity,
  timestamp: date.nullable(), quality: z.enum(['valid','unknown','isolated','rejected'])
}).strict();
const passportSchema = z.object({
  passportId: id, generatedAt: date, inputSource: z.string().min(1).max(100),
  status: z.string().min(1).max(60),
  summary: z.object({legal:z.number().int().min(0).max(10000),rejected:z.number().int().min(0).max(10000),notRun:z.number().int().min(0).max(10000)}).strict()
}).strict();
export const snapshotSchema = z.object({
  version: z.literal(1), contextId: id, capturedAt: date,
  source: z.enum(['synthetic_schedule','synthetic_history']),
  scenario: z.enum(['normal','surge','unit_failure']),
  observationMinute: z.number().finite().min(0).max(1e7), stepMinutes: z.number().int().min(1).max(1440),
  units: z.array(unitSchema).max(16), points: z.array(pointSchema).max(2048), passports: z.array(passportSchema).max(64)
}).strict().superRefine((s,ctx)=>{
  const allowed = s.source === 'synthetic_schedule' ? ['AC-01','AC-02','AC-03'] : ['C-01','C-02'];
  const ids=new Set();
  for (const u of s.units) {
    if (!allowed.includes(u.id) || ids.has(u.id)) ctx.addIssue({code:'custom',message:'Unknown or duplicate unit'});
    ids.add(u.id);
  }
  const points=new Set(); const last=new Map();
  for (const p of s.points) {
    if (p.unitId!==null && !ids.has(p.unitId)) ctx.addIssue({code:'custom',message:'Unknown point unit'});
    const key=`${p.unitId??'aggregate'}:${p.index}`;
    if (points.has(key)) ctx.addIssue({code:'custom',message:'Duplicate bucket'});
    points.add(key);
    const prev=last.get(p.unitId);
    if (prev && (p.index<=prev.index || p.minute<=prev.minute)) ctx.addIssue({code:'custom',message:'Unordered buckets'});
    last.set(p.unitId,p);
  }
  const passports=new Set();
  for(const p of s.passports){ if(passports.has(p.passportId)) ctx.addIssue({code:'custom',message:'Duplicate passport'}); passports.add(p.passportId); }
});
export const toolArgs = {
  get_device_constraints: z.object({unitId:id}).strict(),
  get_time_window: z.object({startMinute:z.number().finite().min(0),endMinute:z.number().finite().min(0),unitId:id.optional()}).strict()
    .refine(a=>a.endMinute>=a.startMinute && a.endMinute-a.startMinute<=10080,'Invalid window'),
  get_passport_evidence: z.object({passportId:id}).strict()
};
export const TOOL_NAMES=Object.freeze(Object.keys(toolArgs));
export const descriptions={get_device_constraints:'读取当前快照设备与资格约束；不批准、不启停',get_time_window:'读取同一来源时间窗原桶与缺值；不补零',get_passport_evidence:'读取用户本地护照摘要；非认证、无执行授权'};
export function envelope(snapshot, status, data=null, references=[]){
  return {status,data,references,provenance:{kind:'client_snapshot',certified:false,source:snapshot.source,capturedAt:snapshot.capturedAt,
    contextId:snapshot.contextId,snapshotHash:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    note:'来自当前用户提交的合成/本地快照；结构校验不构成独立复验、认证或生产证据'}};
}
export function executeTool(name, snapshot, args){
  if(!TOOL_NAMES.includes(name)) return envelope(snapshot,'denied');
  if(name==='get_device_constraints'){
    const u=snapshot.units.find(u=>u.id===args.unitId);
    if(!u) return envelope(snapshot,'not_found');
    const missing=[u.ratedCapacity,u.ratedPower,u.minLoadRatio,u.minStartStopInterval].some(v=>v===null);
    const eligible=u.eligible && !missing && (u.kind!=='centrifugal'||u.surgeBoundaryVerified);
    return envelope(snapshot,'ok',{...u,eligible,readOnly:true},[{kind:'device',id:u.id,source:snapshot.source,minute:snapshot.observationMinute}]);
  }
  if(name==='get_time_window'){
    if(args.unitId&&!snapshot.units.some(u=>u.id===args.unitId)) return envelope(snapshot,'not_found');
    const rows=snapshot.points.filter(p=>p.minute>=args.startMinute && p.minute<=args.endMinute && (!args.unitId||p.unitId===args.unitId));
    return envelope(snapshot,rows.length?'ok':'not_found',{rows,stepMinutes:snapshot.stepMinutes,units:{demand:'m³/min',flow:'m³/min',power:'kW',energy:'kWh'}},
      rows.length?[{kind:'window',source:snapshot.source,startMinute:args.startMinute,endMinute:args.endMinute,unitId:args.unitId??null}]:[]);
  }
  const p=snapshot.passports.find(p=>p.passportId===args.passportId);
  return p?envelope(snapshot,'ok',{...p,authorization:'none',certified:false},[{kind:'passport',id:p.passportId}]):envelope(snapshot,'not_found');
}
