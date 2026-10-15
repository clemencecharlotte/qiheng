// Browser-safe: no Node imports, SDK, token, model key, or local storage access.
export class RequestCoordinator{
  constructor({base='/agent-api',fetchImpl=fetch}={}){this.base=base;this.fetchImpl=fetchImpl;this.epoch=0;this.controller=null;}
  cancel(){this.epoch++;this.controller?.abort();this.controller=null;}
  async query(name,args,snapshot){
    this.cancel(); const epoch=this.epoch; const controller=new AbortController();this.controller=controller;
    let frozen;
    try{frozen=JSON.parse(JSON.stringify(snapshot));}
    catch{this.controller=null;return {status:'invalid',result:{status:'invalid',code:'SNAPSHOT_SERIALIZE'}};}
    try{
      // Native Window.fetch must not receive this coordinator as its receiver.
      const fetchImpl=this.fetchImpl;
      const response=await fetchImpl(`${this.base}/query`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name,arguments:args,snapshot:frozen}),signal:controller.signal});
      let data;
      try{data=await response.json();}
      catch{
        if(epoch!==this.epoch||controller.signal.aborted)return {status:'superseded'};
        return {status:'failed',result:{status:'failed',code:'RESPONSE_FORMAT'},snapshot:frozen,httpStatus:response.status};
      }
      if(epoch!==this.epoch||controller.signal.aborted)return {status:'superseded'};
      if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.status!=='string')
        return {status:'failed',result:{status:'failed',code:'RESPONSE_FORMAT'},snapshot:frozen,httpStatus:response.status};
      if(response.status<200||response.status>=300){
        const status=[401,403,429].includes(response.status)?'denied':response.status===504?'timeout':response.status===400||response.status===413?'invalid':'failed';
        return {status,result:{status,code:typeof data.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(data.code)?data.code:'HTTP_ERROR'},snapshot:frozen,httpStatus:response.status};
      }
      return {status:data.status,result:data,snapshot:frozen,httpStatus:response.status};
    }catch{return {status:epoch!==this.epoch?'superseded':controller.signal.aborted?'cancelled':'failed',result:{status:'failed',code:'NETWORK'},snapshot:frozen};}
    finally{if(epoch===this.epoch)this.controller=null;}
  }
}
