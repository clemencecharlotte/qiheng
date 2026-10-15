// Normalize the real App run captured at submission. No new data generation or independent solver.
const quantity=v=>Number.isFinite(v)&&v>=0?v:null;
const passportsFrom=passports=>passports.map(p=>({passportId:p.passportId,generatedAt:p.generatedAt,inputSource:p.inputSource,status:p.status,
  summary:{legal:p.summary.legal,rejected:p.summary.rejected,notRun:p.summary.notRun}}));
export function buildScheduleSnapshot({run,scenario,observationMinute,passports=[],contextId=crypto.randomUUID(),capturedAt=new Date().toISOString()}){
  const eligibility=new Map(run.evaluation.eligibility.map(e=>[e.unitId,e]));
  const periods=new Map(run.recommendation.periods.map(p=>[p.index,p]));
  return {
    version:1,contextId,capturedAt,source:'synthetic_schedule',scenario,observationMinute,stepMinutes:run.series.stepMinutes,
    units:run.allUnits.map(u=>({id:u.id,name:u.name,kind:u.kind,ratedCapacity:quantity(u.ratedCapacity),ratedPower:quantity(u.ratedPower),
      minLoadRatio:quantity(u.minLoadRatio),minStartStopInterval:quantity(u.minStartStopInterval),surgeBoundaryVerified:u.surgeBoundaryVerified===true,
      eligible:eligibility.get(u.id)?.eligible===true&&u.id!==run.faultUnitId,eligibilityReason:eligibility.get(u.id)?.reason??null})),
    points:run.series.points.map(p=>{const plan=periods.get(p.index);return {index:p.index,minute:p.minuteOfDay,unitId:null,demand:quantity(p.demand),
      flow:quantity(plan?.supply),power:quantity(plan?.powerKw),energy:quantity(plan?.energyKwh),timestamp:null,quality:plan?'valid':'unknown'};}),
    passports:passportsFrom(passports)
  };
}
export function buildHistorySnapshot({fixture,scenario='normal',observationMinute,passports=[],contextId=crypto.randomUUID(),capturedAt=new Date().toISOString()}){
  return {version:1,contextId,capturedAt,source:'synthetic_history',scenario,observationMinute,stepMinutes:fixture.stepMinutes,
    units:fixture.machines.map(u=>({id:u.id,name:u.name,kind:'centrifugal',ratedCapacity:quantity(u.archiveRatedFlow),ratedPower:quantity(u.archiveRatedPower),
      minLoadRatio:null,minStartStopInterval:null,surgeBoundaryVerified:false,eligible:false,eligibilityReason:'历史回放，不纳入调度'})),
    points:fixture.samples.map(p=>({index:p.minuteIndex,minute:p.minuteOfDay,unitId:p.machineId,demand:null,flow:quantity(p.flow),power:quantity(p.power),
      energy:null,timestamp:null,quality:p.flow===null||p.power===null?'unknown':'valid'})),passports:passportsFrom(passports)};
}
