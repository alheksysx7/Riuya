import {observeApi} from '@/lib/api-observability';
import {trends,ActivityError} from '@/lib/activity';
async function handleGET(request:Request){try{if(new URL(request.url).searchParams.size)throw new ActivityError(400);return Response.json(await trends(),{headers:{'Cache-Control':'private, no-store'}});}catch(e){const status=e instanceof ActivityError?e.status:503;return Response.json({error:e instanceof ActivityError?e.message:'TEMPORARY_ERROR'},{status,headers:{'Cache-Control':'private, no-store'}});}}

export async function GET(request:Request){return observeApi('/api/v1/me/trends','GET',()=>handleGET(request));}
