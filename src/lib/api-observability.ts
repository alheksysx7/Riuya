import {randomUUID} from 'node:crypto';

type Route = '/api/v1/news' | '/api/v1/news/[id]' | '/api/v1/news/[id]/participation' | '/api/v1/news/[id]/omit' | '/api/v1/news/[id]/results/access' | '/api/v1/characters/[key]' | '/api/v1/me/activity' | '/api/v1/me/trends';
type Method = 'GET' | 'POST';

// Solo se reciben etiquetas estáticas; nunca se inspecciona la petición ni la respuesta.
export async function observeApi(route:Route,method:Method,handler:()=>Promise<Response>):Promise<Response>{
 const started=performance.now(),requestId=randomUUID();
 const emit=(status:number)=>{
  try{console.log(JSON.stringify({event:'api.request',requestId,route,method,status,durationMs:Math.round(performance.now()-started)}));}catch{/* El registro no cambia la respuesta. */}
 };
 try{const response=await handler();emit(response.status);return response;}
 catch(error){emit(500);throw error;}
}
