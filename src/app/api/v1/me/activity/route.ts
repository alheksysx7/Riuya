import {observeApi} from '@/lib/api-observability';
import {activity,ActivityError} from '@/lib/activity';
async function handleGET(request:Request){const url=new URL(request.url);try{if([...url.searchParams.keys()].some(key=>!['status','cursor'].includes(key))||url.searchParams.getAll('status').length>1||url.searchParams.getAll('cursor').length>1)throw new ActivityError(400);const data=await activity(url.searchParams.get('status')||'all',url.searchParams.get('cursor'));return Response.json(data,{headers:{'Cache-Control':'private, no-store'}});}catch(e){const status=e instanceof ActivityError?e.status:503;return Response.json({error:e instanceof ActivityError?e.message:'TEMPORARY_ERROR'},{status,headers:{'Cache-Control':'private, no-store'}});}}

export async function GET(request:Request){return observeApi('/api/v1/me/activity','GET',()=>handleGET(request));}
