import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestCoordinator } from '../browser/request-coordinator.mjs';
import { snapshot } from './fixture.mjs';

test('browser request freezes context and suppresses old and cancelled late results',async()=>{
  const pending=[];const requests=[];
  const coordinator=new RequestCoordinator({fetchImpl:(url,opts)=>{requests.push(JSON.parse(opts.body));return new Promise(r=>pending.push(r));}});
  const context=snapshot();const one=coordinator.query('get_device_constraints',{unitId:'AC-01'},context);
  context.observationMinute=90;
  const two=coordinator.query('get_device_constraints',{unitId:'AC-03'},context);
  assert.equal(requests[0].snapshot.observationMinute,15);assert.equal(requests[1].snapshot.observationMinute,90);
  pending[1]({status:200,json:async()=>({status:'ok',value:2})});assert.equal((await two).result.value,2);
  pending[0]({status:200,json:async()=>({status:'ok',value:1})});assert.equal((await one).status,'superseded');
  const three=coordinator.query('get_device_constraints',{unitId:'AC-01'},context);coordinator.cancel();
  pending[2]({status:200,json:async()=>({status:'ok'})});assert.equal((await three).status,'superseded');
});

test('browser reports safe network and non-JSON failures without copying server bodies',async()=>{
  const network=new RequestCoordinator({fetchImpl:async()=>{throw new Error('private server details');}});
  const failed=await network.query('get_device_constraints',{unitId:'AC-01'},snapshot());
  assert.equal(failed.result.code,'NETWORK');assert.ok(!JSON.stringify(failed).includes('private server details'));
  const html=new RequestCoordinator({fetchImpl:async()=>({status:502,json:async()=>{throw new SyntaxError('<private HTML>');}})});
  const bad=await html.query('get_device_constraints',{unitId:'AC-01'},snapshot());
  assert.equal(bad.httpStatus,502);assert.equal(bad.result.code,'RESPONSE_FORMAT');
  assert.ok(!JSON.stringify(bad).includes('<private HTML>'));
});

test('browser never accepts an HTTP denial as success and retains safe diagnostic code',async()=>{
  for(const [httpStatus,status] of [[400,'invalid'],[401,'denied'],[403,'denied'],[413,'invalid'],[429,'denied'],[504,'timeout'],[502,'failed']]){
    const c=new RequestCoordinator({fetchImpl:async()=>({status:httpStatus,json:async()=>({status:'ok',code:'QUERY_SCHEMA',secret:'not returned'})})});
    const result=await c.query('get_device_constraints',{unitId:'AC-01'},snapshot());
    assert.equal(result.status,status);assert.equal(result.result.code,'QUERY_SCHEMA');assert.equal(result.httpStatus,httpStatus);
    assert.ok(!JSON.stringify(result).includes('not returned'));
  }
});

test('nonserializable input and malformed response remain explicit failures',async()=>{
  let calls=0;const c=new RequestCoordinator({fetchImpl:async()=>{calls++;return {status:200,json:async()=>null};}});
  const input=snapshot();input.circular=input;
  assert.equal((await c.query('get_device_constraints',{unitId:'AC-01'},input)).result.code,'SNAPSHOT_SERIALIZE');
  assert.equal(calls,0);assert.equal(c.controller,null);
  assert.equal((await c.query('get_device_constraints',{unitId:'AC-01'},snapshot())).result.code,'RESPONSE_FORMAT');
});

test('fetch is called without the coordinator receiver (native browser brand check)',async()=>{
  const c=new RequestCoordinator({fetchImpl:async function(){
    if(this!==undefined)throw new TypeError('Illegal invocation');
    return {status:200,json:async()=>({status:'ok',protocol:'mcp-stdio'})};
  }});
  assert.equal((await c.query('get_device_constraints',{unitId:'AC-01'},snapshot())).status,'ok');
});
