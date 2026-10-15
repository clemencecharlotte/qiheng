export function snapshot(){return {
  version:1,contextId:'context-test',capturedAt:'2026-10-14T00:00:00Z',source:'synthetic_schedule',scenario:'normal',observationMinute:15,stepMinutes:15,
  units:[{id:'AC-01',name:'Test screw',kind:'screw',ratedCapacity:20,ratedPower:132,minLoadRatio:0.4,minStartStopInterval:10,surgeBoundaryVerified:true,eligible:true,eligibilityReason:null},
    {id:'AC-03',name:'Test centrifugal',kind:'centrifugal',ratedCapacity:40,ratedPower:250,minLoadRatio:0.7,minStartStopInterval:20,surgeBoundaryVerified:false,eligible:true,eligibilityReason:'Unknown boundary'}],
  points:[{index:0,minute:0,unitId:null,demand:19.7,flow:19.7,power:null,energy:null,timestamp:null,quality:'unknown'},
    {index:1,minute:15,unitId:null,demand:20,flow:20,power:132,energy:33,timestamp:null,quality:'valid'}],
  passports:[{passportId:'qp-test',generatedAt:'2026-10-14T00:00:00Z',inputSource:'synthetic-development',status:'complete',summary:{legal:1,rejected:0,notRun:0}}]
};}
