import {safeFetch} from './safe-fetch.mjs';import {parseFeed} from './feeds.mjs';
export async function processSourceJob(client,job,fetcher=safeFetch){
 const q=await client.query('select private.source_job_info($1,$2) info',[job.id,job.leaseToken]);const info=q.rows[0].info;
 if(!info)throw Error('SOURCE_UNAVAILABLE');
 const headers={accept:'application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml','user-agent':'RiuyaLocal/1.0'};
 if(info.etag)headers['if-none-match']=info.etag;if(info.lastModified)headers['if-modified-since']=info.lastModified;
 const response=await fetcher(info.feedUrl,{allowedDomains:[info.domain],headers});
 if(response.status!==200&&response.status!==304)throw Error(response.status>=400&&response.status<500&&response.status!==429?'SOURCE_HTTP_PERMANENT':'SOURCE_HTTP_TEMPORARY');
 const items=response.status===304?[]:parseFeed(response.body,info.type,info.feedUrl);
 const header=x=>typeof x==='string'&&x.length<=512&&!/[\r\n]/.test(x)?x:null;
 const result=await client.query('select private.complete_source_job($1,$2,$3::jsonb,$4,$5) ok',[job.id,job.leaseToken,JSON.stringify(items),header(response.headers.etag)||(response.status===304?info.etag:null),header(response.headers.lastModified)||(response.status===304?info.lastModified:null)]);
 if(!result.rows[0].ok)throw Error('SOURCE_UNAVAILABLE');return items.length;
}
