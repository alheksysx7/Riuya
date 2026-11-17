import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const routes=new Set(['/api/v1/news','/api/v1/news/[id]','/api/v1/news/[id]/participation','/api/v1/news/[id]/omit','/api/v1/news/[id]/results/access','/api/v1/characters/[key]','/api/v1/me/activity','/api/v1/me/trends']);
const jobs=new Set(['draft.generate','source.fetch','event.cluster','notification.send','account.purge','unknown']);
const edges=[100,250,500,1000,2000,5000,30000,Infinity];
const blank=()=>({total:0,erroresServidor:0,limitadas:0,lentas:0,intervalos:edges.map(()=>0)});
function addLatency(metric,ms){
 metric.total++;
 metric.intervalos[edges.findIndex(edge=>ms<=edge)]++;
 if(ms>=1000)metric.lentas++;
}
function percentile(metric){
 if(!metric.total)return null;
 let total=0;
 for(let i=0;i<edges.length;i++){
  total+=metric.intervalos[i];
  if(total>=Math.ceil(metric.total*.95))return {mayorQueMs:i?edges[i-1]:null,hastaMs:Number.isFinite(edges[i])?edges[i]:null};
 }
 return null;
}
function compact(metric){return {total:metric.total,erroresServidor:metric.erroresServidor,limitadas:metric.limitadas,desde1000ms:metric.lentas,p95IntervaloMs:percentile(metric)};}
export function createMetrics(){
 const api=blank(),confirmaciones=blank(),workers={total:0,fallidos:0,leaseVencido:0,porTipo:{}};
 let agendaFallida=0,ignorados=0;
 return {
  consume(line){
   if(line.length>65536){ignorados++;return;}
   let value;try{value=JSON.parse(line);}catch{ignorados++;return;}
   if(!value||typeof value!=='object'||Array.isArray(value)){ignorados++;return;}
   if(value.event==='api.request'){
    if(!routes.has(value.route)||!['GET','POST'].includes(value.method)||!Number.isInteger(value.status)||value.status<100||value.status>599||!Number.isSafeInteger(value.durationMs)||value.durationMs<0){ignorados++;return;}
    const targets=[api];
    if(value.route==='/api/v1/news/[id]/participation'&&value.method==='POST')targets.push(confirmaciones);
    for(const metric of targets){addLatency(metric,value.durationMs);if(value.status>=500)metric.erroresServidor++;if(value.status===429)metric.limitadas++;}
   }else if(value.event==='worker.job'){
    if(!jobs.has(value.type)||!['completed','failed','lease_lost'].includes(value.status)||!Number.isSafeInteger(value.durationMs)||value.durationMs<0){ignorados++;return;}
    workers.total++;
    workers.porTipo[value.type]=(workers.porTipo[value.type]||0)+1;
    if(value.status==='failed')workers.fallidos++;
    if(value.status==='lease_lost')workers.leaseVencido++;
   }else if(value.event==='worker.scheduler'&&value.status==='failed')agendaFallida++;
   else if(value.event!=='worker.start')ignorados++;
  },
  result(){
   const alertas=[];
   if(api.erroresServidor)alertas.push('RESPUESTAS_API_5XX');
   if(confirmaciones.erroresServidor)alertas.push('CONFIRMACIONES_5XX');
   if(api.lentas)alertas.push('SOLICITUDES_DESDE_1000MS');
   if(workers.fallidos)alertas.push('TRABAJOS_FALLIDOS');
   if(workers.leaseVencido)alertas.push('TRABAJOS_CON_LEASE_VENCIDO');
   if(agendaFallida)alertas.push('AGENDA_FALLIDA');
   const total=api.total+workers.total+agendaFallida;
   return {estado:total?(alertas.length?'requiere_revision':'sin_alertas_detectadas'):'sin_datos',
    api:compact(api),confirmaciones:compact(confirmaciones),worker:{...workers,agendaFallida},alertas,lineasIgnoradas:ignorados};
  }
 };
}
export async function summarizeStream(input){
 const metrics=createMetrics();
 const lines=createInterface({input,crlfDelay:Infinity});
 for await(const line of lines)metrics.consume(line);
 return metrics.result();
}
// El intervalo se mide desde la recepción; no indica cuándo ocurrió el evento.
export async function watchStream(input,{intervalMs=60000,emit=value=>console.log(JSON.stringify(value))}={}){
 if(!Number.isInteger(intervalMs)||intervalMs<10)throw Error('INVALID_INTERVAL');
 let metrics=createMetrics(),pending=0;
 const flush=final=>{
  const result=metrics.result();
  metrics=createMetrics();pending=0;
  emit({tipo:final?'entrada_finalizada':'intervalo',intervaloMs:intervalMs,...result});
 };
 const timer=setInterval(()=>flush(false),intervalMs);
 try{
  const lines=createInterface({input,crlfDelay:Infinity});
  for await(const line of lines){metrics.consume(line);pending++;}
  if(pending)flush(true);else emit({tipo:'entrada_finalizada'});
 }finally{clearInterval(timer);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 if(args.length===0)console.log(JSON.stringify(await summarizeStream(process.stdin),null,2));
 else if(args.length===1&&args[0]==='--vigilar')await watchStream(process.stdin);
 else {console.error('Uso: node scripts/metrics-local.mjs [--vigilar]');process.exitCode=1;}
}
