import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { snapshotSchema,toolArgs,descriptions,executeTool,TOOL_NAMES } from './domain.mjs';
import { resources } from './resources.mjs';

const server=new McpServer({name:'qiheng-readonly-evidence',version:'1.0.0'});
for(const [uri,doc] of Object.entries(resources))server.registerResource(doc.title,uri,{title:doc.title,mimeType:'text/markdown'},async u=>({contents:[{uri:u.href,mimeType:'text/markdown',text:doc.text}]}));
for(const name of TOOL_NAMES){
  server.registerTool(name,{description:descriptions[name],inputSchema:z.object({snapshot:snapshotSchema,arguments:toolArgs[name]}).strict(),
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({snapshot,arguments:args},extra)=>{
    const testDelay=process.env.QH_MCP_TEST_MODE==='1'?Number(process.env.QH_MCP_TEST_DELAY_MS||0):0;
    if(testDelay){await new Promise((resolve,reject)=>{
      const timer=setTimeout(done,testDelay);
      function done(){extra.signal.removeEventListener('abort',abort);resolve();}
      function abort(){clearTimeout(timer);extra.signal.removeEventListener('abort',abort);process.stderr.write('QH_TEST_CANCEL_OBSERVED\n');reject(new Error('Cancelled'));}
      if(extra.signal.aborted) abort(); else extra.signal.addEventListener('abort',abort,{once:true});
    });}
    if(extra.signal.aborted) return {isError:true,content:[{type:'text',text:'Cancelled'}]};
    const value=executeTool(name,snapshot,args);
    return {isError:value.status!=='ok',content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};
  });
}
await server.connect(new StdioServerTransport());
