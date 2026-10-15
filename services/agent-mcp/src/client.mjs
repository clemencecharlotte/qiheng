import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

export async function connectMcp({testMode=false,testDelayMs=0,onProtocol=()=>{},onStderr=()=>{}}={}){
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url))],stderr:'pipe',
    env:testMode?{QH_MCP_TEST_MODE:'1',QH_MCP_TEST_DELAY_MS:String(testDelayMs)}:{}});
  const rawSend=transport.send.bind(transport);
  transport.send=async(message)=>{onProtocol(message.method??'response');return rawSend(message);};
  const client=new Client({name:'qiheng-gateway',version:'1.0.0'},{capabilities:{}});
  try{await client.connect(transport,{timeout:5000}); if(transport.stderr) transport.stderr.on('data',b=>onStderr(b.toString()));}
  catch(e){await transport.close();throw e;}
  return {client,transport,close:()=>client.close()};
}
