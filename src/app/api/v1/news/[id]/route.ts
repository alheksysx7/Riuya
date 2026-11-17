import {observeApi} from '@/lib/api-observability';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
async function handleGET(_request:Request,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params; if(!z.uuid().safeParse(id).success)return Response.json({error:'No encontrada'},{status:404,headers:{'Cache-Control':'no-store'}});
 try {const db=await supabase();const {data,error}=await db.schema('api').rpc('reader_article',{p_id:id}); if(error)throw error; if(!data)return Response.json({error:'No encontrada'},{status:404,headers:{'Cache-Control':'no-store'}});return Response.json(data,{headers:{'Cache-Control':'no-store'}});} catch {return Response.json({error:'Servicio no disponible'},{status:503,headers:{'Cache-Control':'no-store'}});}
}

export async function GET(request:Request,context:{params:Promise<{id:string}>}){return observeApi('/api/v1/news/[id]','GET',()=>handleGET(request,context));}
