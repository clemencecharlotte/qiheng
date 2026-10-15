import type {AgentSnapshot} from './build-snapshot.mjs';
export declare class RequestCoordinator {
  constructor(options?:{base?:string;fetchImpl?:typeof fetch});
  cancel():void;
  query(name:string,args:Record<string,unknown>,snapshot:AgentSnapshot):Promise<{status:string;result?:Record<string,unknown>;snapshot?:AgentSnapshot;httpStatus?:number}>;
}
