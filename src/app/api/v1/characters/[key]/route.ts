import {observeApi} from '@/lib/api-observability';
import { supabase } from '@/lib/supabase';
async function handleGET(_request:Request,{params}:{params:Promise<{key:string}>}){const {key}=await params; if(!/^(rami|beatriz|leo|dmitri|naoki|salma|tove|kavya)$/.test(key))return Response.json({error:'No encontrada'},{status:404}); try{const db=await supabase(); const {data,error}=await db.schema('api').rpc('reader_character',{p_key:key}); if(error)throw error; if(!data)return Response.json({error:'No encontrada'},{status:404}); return Response.json(data,{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Servicio no disponible'},{status:503});}}

export async function GET(request:Request,context:{params:Promise<{key:string}>}){return observeApi('/api/v1/characters/[key]','GET',()=>handleGET(request,context));}
