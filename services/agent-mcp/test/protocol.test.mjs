import test from 'node:test';
import assert from 'node:assert/strict';
import { connectMcp } from '../src/client.mjs';
import { snapshot } from './fixture.mjs';

test('real subprocess initialize, tools/list, tools/call; three readonly tools',async()=>{
  const trace=[];const m=await connectMcp({onProtocol:x=>trace.push(x)});
  try{
    const tools=await m.client.listTools();
    assert.deepEqual(tools.tools.map(t=>t.name).sort(),['get_device_constraints','get_passport_evidence','get_time_window']);
    assert.ok(tools.tools.every(t=>t.annotations.readOnlyHint&&t.annotations.destructiveHint===false));
    const result=await m.client.callTool({name:'get_device_constraints',arguments:{snapshot:snapshot(),arguments:{unitId:'AC-03'}}});
    assert.equal(result.structuredContent.status,'ok');assert.equal(result.structuredContent.data.eligible,false);
    assert.equal(result.structuredContent.provenance.certified,false);
    assert.ok(trace.includes('initialize'));assert.ok(trace.includes('tools/list'));assert.ok(trace.includes('tools/call'));
    const docs=await m.client.listResources();assert.equal(docs.resources.length,3);
    const doc=await m.client.readResource({uri:'qiheng://docs/data'});assert.match(doc.contents[0].text,/null/);
  }finally{await m.close();}
});
test('unknown object, null conservation, sealed passport exact ID',async()=>{
  const m=await connectMcp();try{
    async function call(name,args){return (await m.client.callTool({name,arguments:{snapshot:snapshot(),arguments:args}})).structuredContent;}
    assert.equal((await call('get_device_constraints',{unitId:'AC-99'})).status,'not_found');
    const window=await call('get_time_window',{startMinute:0,endMinute:15});
    assert.equal(window.data.rows.length,2);assert.equal(window.data.rows[0].power,null);assert.equal(window.data.rows[0].energy,null);
    assert.equal((await call('get_passport_evidence',{passportId:'qp-test'})).data.authorization,'none');
    assert.equal((await call('get_passport_evidence',{passportId:'qp-absent'})).status,'not_found');
  }finally{await m.close();}
});
test('unknown control tool and invalid or mixed-source inputs cannot execute',async()=>{
  const m=await connectMcp();try{
    const blocked=await m.client.callTool({name:'approve',arguments:{}});
    assert.equal(blocked.isError,true);assert.equal(blocked.structuredContent,undefined);
    const invalid=await m.client.callTool({name:'get_time_window',arguments:{snapshot:snapshot(),arguments:{startMinute:40,endMinute:15}}});
    assert.equal(invalid.isError,true);
    const mixed=snapshot();mixed.source='synthetic_history';
    assert.equal((await m.client.callTool({name:'get_device_constraints',arguments:{snapshot:mixed,arguments:{unitId:'AC-01'}}})).isError,true);
    const extra=snapshot();extra.apiKey='must-not-be-forwarded';
    assert.equal((await m.client.callTool({name:'get_device_constraints',arguments:{snapshot:extra,arguments:{unitId:'AC-01'}}})).isError,true);
  }finally{await m.close();}
});
test('real SDK cancellation reaches server; no late successful result',async()=>{
  let errors='';const m=await connectMcp({testMode:true,testDelayMs:500,onStderr:x=>errors+=x});
  try{
    const c=new AbortController();const pending=m.client.callTool({name:'get_device_constraints',arguments:{snapshot:snapshot(),arguments:{unitId:'AC-01'}}},undefined,{signal:c.signal,timeout:2000});
    setTimeout(()=>c.abort(),100);await assert.rejects(pending);
    await new Promise(r=>setTimeout(r,100));assert.match(errors,/QH_TEST_CANCEL_OBSERVED/);
  }finally{await m.close();}
});
test('actual protocol timeout cancels delayed server handler',async()=>{
  let errors='';const m=await connectMcp({testMode:true,testDelayMs:500,onStderr:x=>errors+=x});
  try{
    await assert.rejects(m.client.callTool({name:'get_device_constraints',arguments:{snapshot:snapshot(),arguments:{unitId:'AC-01'}}},undefined,{timeout:100}),e=>e.code===-32001);
    await new Promise(r=>setTimeout(r,100));assert.match(errors,/QH_TEST_CANCEL_OBSERVED/);
  }finally{await m.close();}
});
