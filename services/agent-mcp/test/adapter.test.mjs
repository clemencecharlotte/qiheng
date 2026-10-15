import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotSchema } from '../src/domain.mjs';
import { buildScheduleSnapshot,buildHistorySnapshot } from '../browser/build-snapshot.mjs';
import { snapshot } from './fixture.mjs';

test('App adapter preserves units, missing plan, null and fault exclusion',()=>{
  const unit=snapshot().units[0];
  const run={allUnits:[unit],evaluation:{eligibility:[{unitId:'AC-01',eligible:true,reason:null}]},faultUnitId:'AC-01',
    series:{stepMinutes:15,points:[{index:0,minuteOfDay:0,demand:19.7},{index:1,minuteOfDay:15,demand:20}]},
    recommendation:{periods:[{index:0,supply:19.7,powerKw:132,energyKwh:33}]}};
  const result=buildScheduleSnapshot({run,scenario:'unit_failure',observationMinute:15});
  assert.equal(snapshotSchema.safeParse(result).success,true);assert.equal(result.units[0].eligible,false);
  assert.equal(result.points[0].energy,33);assert.equal(result.points[1].flow,null);assert.equal(result.points[1].power,null);
});
test('history adapter does not copy schedule values or fabricate energy',()=>{
  const fixture={stepMinutes:1,machines:[{id:'C-01',name:'History C-01',archiveRatedFlow:40,archiveRatedPower:250}],
    samples:[{machineId:'C-01',minuteIndex:0,minuteOfDay:480,flow:30,power:null}]};
  const result=buildHistorySnapshot({fixture,observationMinute:480});
  assert.equal(snapshotSchema.safeParse(result).success,true);assert.equal(result.units[0].eligible,false);
  assert.equal(result.points[0].demand,null);assert.equal(result.points[0].energy,null);assert.equal(result.points[0].power,null);
});
