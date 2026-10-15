export function providerFromEnv(env=process.env){
  return createProvider({approved:env.QH_MODEL_APPROVED==='true',protocol:env.QH_MODEL_PROTOCOL,endpoint:env.QH_MODEL_ENDPOINT,
    apiKey:env.QH_MODEL_API_KEY,modelId:env.QH_DEEPSEEK_MODEL_ID});
}
export function createProvider(config,{allowHttpForTests=false,timeoutMs=9000}={}){
  let endpoint;
  try{endpoint=new URL(config.endpoint);}catch{}
  const ready=config.approved===true && config.protocol==='openai-compatible' && typeof config.apiKey==='string' && config.apiKey.length>0
    && typeof config.modelId==='string' && config.modelId.length>0 && endpoint && !endpoint.username && !endpoint.password && !endpoint.hash
    && (endpoint.protocol==='https:'||(allowHttpForTests&&endpoint.protocol==='http:'&&['127.0.0.1','localhost'].includes(endpoint.hostname)));
  return {
    status:()=>({state:ready?'configured':'not_connected',model:'DeepSeek',onlineVerified:false,modelSwitchAllowed:false}),
    async ask(question,{signal,contextId}={}){
      if(!ready) return {status:'not_connected',message:'未获正规模型授权或缺少服务端配置；未调用模型'};
      const limitSignal=AbortSignal.timeout(timeoutMs);
      try{
        const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,limitSignal]):limitSignal,
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},
          body:JSON.stringify({model:config.modelId,max_tokens:512,stream:false,messages:[
            {role:'system',content:'只解释气衡证据；不得批准、启停、修改授权或假造数据。没有工具结果不能假称已查询。'},
            {role:'user',content:question}]})});
        if(!response.ok) return {status:'failed',code:'PROVIDER_HTTP',httpStatus:response.status};
        const text=await response.text(); if(text.length>65536) return {status:'failed',code:'PROVIDER_SIZE'};
        const result=JSON.parse(text); const answer=result?.choices?.[0]?.message?.content;
        if(typeof answer!=='string'||answer.length>20000) return {status:'failed',code:'PROVIDER_FORMAT'};
        return {status:'ok',answer,contextId,model:'DeepSeek',permissionsChanged:false};
      }catch{ return {status:signal?.aborted?'cancelled':limitSignal.aborted?'timeout':'failed',code:'PROVIDER_REQUEST'}; }
    }
  };
}
