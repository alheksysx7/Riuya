import { z } from 'zod';
import { supabase } from '@/lib/supabase';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params; if(!z.uuid().safeParse(id).success)return Response.json({error:'No encontrada'},{status:404,headers:{'Cache-Control':'no-store'}});
 try {const db=await supabase();const {data,error}=await db.schema('api').rpc('reader_article',{p_id:id}); if(error)throw error; if(!data)return Response.json({error:'No encontrada'},{status:404,headers:{'Cache-Control':'no-store'}});return Response.json(data,{headers:{'Cache-Control':'no-store'}});} catch {return Response.json({error:'Servicio no disponible'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
