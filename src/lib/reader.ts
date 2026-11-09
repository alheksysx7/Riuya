import { z } from 'zod';
import { supabase } from './supabase';
export const cursorSchema=z.object({category:z.string().nullable(),upperTime:z.iso.datetime({offset:true}),upperId:z.uuid(),lastTime:z.iso.datetime({offset:true}),lastId:z.uuid()}).strict();
const cardSchema=z.object({id:z.uuid(),title:z.string(),summary:z.string(),category:z.string(),categorySlug:z.string(),publishedAt:z.iso.datetime({offset:true})});
const pageSchema=z.object({items:z.array(cardSchema).max(10),hasMore:z.boolean(),nextCursor:cursorSchema.nullable()});
export type Card=z.infer<typeof cardSchema>;
export type Page={items:Card[];hasMore:boolean;nextCursor:string|null};
export function parseCursor(value:string|null) { if(!value) return null; if(value.length>1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Cursor inválido'); try { return cursorSchema.parse(JSON.parse(Buffer.from(value,'base64url').toString('utf8'))); } catch { throw new Error('Cursor inválido'); } }
export async function feed(category:string|null,cursor:string|null):Promise<Page> {
 const parsed=parseCursor(cursor); if(parsed && parsed.category!==category) throw new Error('Cursor inválido');
 const db=await supabase(); const {data,error}=await db.schema('api').rpc('reader_feed',{p_category:category,p_cursor:parsed});
 if(error){if(error.message==='INVALID_CATEGORY'||error.message==='INVALID_CURSOR') throw new Error('Filtro o cursor inválido'); throw new Error('El servicio de noticias no está disponible');}
 const result=pageSchema.parse(data); return {...result,nextCursor:result.nextCursor ? Buffer.from(JSON.stringify(result.nextCursor)).toString('base64url') : null};
}
