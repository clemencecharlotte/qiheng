import http from 'node:http';
import { timingSafeEqual,randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { snapshotSchema,toolArgs,TOOL_NAMES } from './domain.mjs';
import { connectMcp } from './client.mjs';
import { providerFromEnv } from './provider.mjs';
import { resources } from './resources.mjs';

const MAX_BODY=512*1024;
const querySchema=z.object({name:z.enum(TOOL_NAMES),arguments:z.record(z.string(),z.unknown()),snapshot:snapshotSchema}).strict();
function sameToken(a,b){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
function reply(res,status,data){if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}}
async function readBody(req){return new Promise((resolve,reject)=>{
  let length=0;const chunks=[];let done=false;
  function fail(status){if(done)return;done=true;const e=new Error('Invalid request body');e.status=status;chunks.length=0;reject(e);}
  req.on('data',chunk=>{if(done)return;length+=chunk.length;if(length>MAX_BODY){fail(413);return;}chunks.push(chunk);});
  req.once('end',()=>{if(done)return;try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));done=true;resolve(body);}catch{fail(400);}});
  req.once('error',()=>fail(400));req.once('aborted',()=>fail(400));
});}
export function createGateway({token,allowedOrigins=[],provider=providerFromEnv(),toolTimeoutMs=5000}={}){
  if(typeof token!=='string'||token.length<32) throw new Error('Require server-only QH_AGENT_TOKEN with at least 32 characters');
  let active=0; const rate=new Map();
  const server=http.createServer(async(req,res)=>{
    let host;try{host=new URL(`http://${req.headers.host}`).hostname;}catch{}
    if(!['127.0.0.1','localhost'].includes(host)){reply(res,403,{status:'denied',code:'HOST'});return;}
    if(req.headers.origin&&!allowedOrigins.includes(req.headers.origin)){reply(res,403,{status:'denied',code:'ORIGIN'});return;}
    const auth=req.headers.authorization??'';
    if(!sameToken(auth,`Bearer ${token}`)){reply(res,401,{status:'denied',code:'AUTH'});return;}
    const now=Date.now(),address=req.socket.remoteAddress??'local'; const count=rate.get(address);
    if(count&&now-count.since<60000&&count.total>=60){reply(res,429,{status:'denied',code:'RATE_LIMIT'});return;}
    if(!count||now-count.since>=60000) rate.set(address,{since:now,total:1});else count.total++;
    const path=(req.url??'').split('?')[0];
    if(Number(req.headers['content-length']??0)>MAX_BODY){req.resume();reply(res,413,{status:'invalid',code:'BODY_SIZE'});return;}
    if(req.method==='GET'&&path==='/status'){reply(res,200,{status:'ok',protocol:'mcp-stdio',mcp:{state:'available',verifiedByThisRequest:false},provider:provider.status()});return;}
    if(active>=4){reply(res,429,{status:'denied',code:'CONCURRENCY'});return;}
    active++; let connection; const cancelled=new AbortController();
    const abort=()=>cancelled.abort(); req.once('aborted',abort); res.once('close',()=>{if(!res.writableEnded)abort();});
    try{
      if(req.method==='GET'&&path==='/tools'){
        connection=await connectMcp(); if(cancelled.signal.aborted)return;
        const tools=await connection.client.listTools({}, {signal:cancelled.signal,timeout:toolTimeoutMs});
        reply(res,200,{status:'ok',protocol:'mcp-stdio',tools:tools.tools});return;
      }
      if(req.method==='GET'&&(path==='/resources'||path==='/resource')){
        const uri=new URL(req.url,'http://127.0.0.1').searchParams.get('uri');
        if(path==='/resource'&&!Object.hasOwn(resources,uri)){reply(res,400,{status:'invalid',code:'RESOURCE_URI'});return;}
        connection=await connectMcp();if(cancelled.signal.aborted)return;
        const result=path==='/resources'?await connection.client.listResources({}, {signal:cancelled.signal,timeout:toolTimeoutMs})
          :await connection.client.readResource({uri},{signal:cancelled.signal,timeout:toolTimeoutMs});
        reply(res,200,{status:'ok',protocol:'mcp-stdio',...result});return;
      }
      if(req.method==='POST'&&path==='/query'){
        const parsed=querySchema.safeParse(await readBody(req));
        if(!parsed.success){reply(res,400,{status:'invalid',code:'QUERY_SCHEMA'});return;}
        const q=parsed.data, args=toolArgs[q.name].safeParse(q.arguments);
        if(!args.success){reply(res,400,{status:'invalid',code:'ARGUMENTS'});return;}
        connection=await connectMcp(); if(cancelled.signal.aborted)return;
        const result=await connection.client.callTool({name:q.name,arguments:{snapshot:q.snapshot,arguments:args.data}},undefined,{signal:cancelled.signal,timeout:toolTimeoutMs});
        if(cancelled.signal.aborted)return;
        const payload=result.structuredContent??JSON.parse(result.content.find(c=>c.type==='text')?.text??'{}');
        reply(res,200,{...payload,protocol:'mcp-stdio',requestId:randomUUID()});return;
      }
      if(req.method==='POST'&&path==='/model'){
        const data=z.object({question:z.string().min(1).max(4000),contextId:z.string().max(100).optional()}).strict().safeParse(await readBody(req));
        if(!data.success){reply(res,400,{status:'invalid',code:'MODEL_INPUT'});return;}
        const result=await provider.ask(data.data.question,{signal:cancelled.signal,contextId:data.data.contextId});reply(res,200,result);return;
      }
      reply(res,404,{status:'not_found'});
    }catch(e){
      const status=cancelled.signal.aborted?'cancelled':e.code===-32001?'timeout':'failed';
      reply(res,e.status??(status==='timeout'?504:502),{status,code:e.status===413?'BODY_SIZE':e.status===400?'BODY_JSON':'TOOL_REQUEST'});
    }finally{req.removeListener('aborted',abort);try{if(connection)await connection.close();}finally{active--;}}
  });
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=createGateway({token:process.env.QH_AGENT_TOKEN,allowedOrigins:(process.env.QH_AGENT_ALLOWED_ORIGINS??'').split(',').filter(Boolean)});
  const port=Number(process.env.QH_AGENT_PORT??4249);
  server.listen(port,'127.0.0.1',()=>process.stderr.write(`Qiheng agent gateway listening on loopback port ${port}\n`));
}
