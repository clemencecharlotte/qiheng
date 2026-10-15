import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createProvider } from '../src/provider.mjs';

test('provider default is disconnected; HTTP, missing approval, and redirects cannot silently enable it',async()=>{
  const p=createProvider({});assert.equal(p.status().state,'not_connected');assert.equal((await p.ask('x')).status,'not_connected');
  const q=createProvider({approved:true,protocol:'openai-compatible',endpoint:'http://evil.example',modelId:'x',apiKey:'secret'});
  assert.equal(q.status().state,'not_connected');
});
test('provider actual request uses fixed configured ID, cancels timeout and redacts errors',async()=>{
  let payload;const server=http.createServer((req,res)=>{
    let text='';req.on('data',c=>text+=c);req.on('end',()=>{payload=JSON.parse(text);
      if(payload.messages[1].content==='error'){res.writeHead(500);res.end('private api-key=secret');}
      else if(payload.messages[1].content==='slow'){setTimeout(()=>res.end('{}'),150);}
      else res.end(JSON.stringify({choices:[{message:{content:'Verified fixture answer'}}]}));});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const p=createProvider({approved:true,protocol:'openai-compatible',endpoint:`http://127.0.0.1:${server.address().port}`,apiKey:'test-only-secret',modelId:'test-deepseek-id'},{allowHttpForTests:true,timeoutMs:50});
  try{
    assert.equal((await p.ask('test')).status,'ok');assert.equal(payload.model,'test-deepseek-id');assert.equal(payload.max_tokens,512);
    const error=await p.ask('error');assert.equal(error.status,'failed');assert.ok(!JSON.stringify(error).includes('secret'));
    assert.equal((await p.ask('slow')).status,'timeout');
    const aborted=new AbortController();aborted.abort();assert.equal((await p.ask('test',{signal:aborted.signal})).status,'cancelled');
  }finally{await new Promise(r=>server.close(r));}
});
