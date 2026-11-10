import {proposeMatch} from './editorial.mjs';
function entities(title){return title.split(/[^\p{L}\p{N}]+/u).filter(x=>/^[A-ZÁÉÍÓÚÑ][\p{L}\p{N}]{2,}$/u.test(x)).slice(0,10);}
export function proposePairs(items,{threshold=0.5,maxDays=3}={}){
 if(!Number.isFinite(threshold)||threshold<0||threshold>1||!Number.isFinite(maxDays)||maxDays<=0||maxDays>30)throw Error('INVALID_CLUSTER_CONFIG');
 const pairs=[];const rows=items.map(x=>({...x,entities:entities(x.title)}));
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){if(rows[i].simulation===rows[j].simulation&&proposeMatch(rows[i],rows[j],{threshold,maxDays}))pairs.push({a:rows[i].id,b:rows[j].id});if(pairs.length===200)return pairs;}
 return pairs;
}
export async function processClusterJob(client,job){
 const q=await client.query('select private.cluster_job_info($1,$2) items',[job.id,job.leaseToken]);const items=q.rows[0].items;if(!items)throw Error('CLUSTER_UNAVAILABLE');
 const pairs=proposePairs(items,{threshold:Number(process.env.RIUYA_CLUSTER_THRESHOLD||0.5),maxDays:Number(process.env.RIUYA_CLUSTER_DAYS||3)});const result=await client.query('select private.complete_cluster_job($1,$2,$3::jsonb) ok',[job.id,job.leaseToken,JSON.stringify(pairs)]);if(!result.rows[0].ok)throw Error('CLUSTER_UNAVAILABLE');return pairs.length;
}
