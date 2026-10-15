import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createGateway } from '../src/gateway.mjs';
import { snapshot } from './fixture.mjs';

test('HTTP gateway uses actual MCP; auth, origin, schema, body, missing model fail closed',async()=>{
  const token=randomBytes(32).toString('hex');const server=createGateway({token});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  try{
    assert.equal((await fetch(base+'/status')).status,401);
    assert.equal((await fetch(base+'/status',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
    const status=await (await fetch(base+'/status',{headers})).json();assert.equal(status.provider.state,'not_connected');
    const tools=await (await fetch(base+'/tools',{headers})).json();assert.equal(tools.tools.length,3);assert.equal(tools.protocol,'mcp-stdio');
    const docs=await (await fetch(base+'/resources',{headers})).json();assert.equal(docs.resources.length,3);
    const doc=await (await fetch(base+'/resource?uri='+encodeURIComponent('qiheng://docs/data'),{headers})).json();assert.match(doc.contents[0].text,/null/);
    assert.equal((await fetch(base+'/resource?uri='+encodeURIComponent('file:///C:/private'),{headers})).status,400);
    const query={name:'get_device_constraints',arguments:{unitId:'AC-01'},snapshot:snapshot()};
    const response=await (await fetch(base+'/query',{method:'POST',headers,body:JSON.stringify(query)})).json();
    assert.equal(response.status,'ok');assert.equal(response.protocol,'mcp-stdio');assert.ok(response.provenance.snapshotHash);assert.ok(response.requestId);
    assert.equal((await fetch(base+'/query',{method:'POST',headers,body:JSON.stringify({...query,role:'admin'})})).status,400);
    assert.equal((await fetch(base+'/query',{method:'POST',headers,body:JSON.stringify({...query,name:'Start'})})).status,400);
    assert.equal((await fetch(base+'/query',{method:'POST',headers,body:'x'.repeat(513*1024)})).status,413);
    const model=await (await fetch(base+'/model',{method:'POST',headers,body:JSON.stringify({question:'Explain AC-03'})})).json();assert.equal(model.status,'not_connected');
    assert.equal((await fetch(base+'/query',{method:'POST',headers,body:'{bad'})).status,400);
    assert.equal((await fetch(base+'/model',{method:'POST',headers,body:JSON.stringify({question:'x',model:'arbitrary'})})).status,400);
    assert.ok(!JSON.stringify(status).includes(token));assert.ok(!JSON.stringify(tools).includes(token));
  }finally{await new Promise(r=>server.close(r));}
});
