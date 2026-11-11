'use server';
import {redirect} from 'next/navigation';import {z} from 'zod';import {supabase} from '@/lib/supabase';
const fields=z.object({hour:z.coerce.number().refine(x=>[8,12,19].includes(x)),timezone:z.string().min(1).max(100).refine(x=>{try{new Intl.DateTimeFormat('es',{timeZone:x});return x==='UTC'||x.includes('/');}catch{return false;}}),version:z.coerce.number().int().min(0)});
export async function saveNotifications(f:FormData){
 const parsed=fields.safeParse({hour:f.get('hour'),timezone:f.get('timezone'),version:f.get('version')});if(!parsed.success)redirect('/preferencias?msg=invalido');
 const db=await supabase();const user=await db.auth.getUser();if(!user.data.user?.email_confirmed_at)redirect('/cuenta?next=%2Fpreferencias');
 const {error}=await db.schema('api').rpc('update_notification_settings',{p_news:f.get('news')==='on',p_results:f.get('results')==='on',p_hour:parsed.data.hour,p_timezone:parsed.data.timezone,p_expected_version:parsed.data.version});
 redirect('/preferencias?msg='+(error?(error.code==='PT409'?'conflicto':'error'):'guardado'));
}
