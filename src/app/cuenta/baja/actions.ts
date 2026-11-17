'use server';
import {cookies} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import {z} from 'zod';
import {supabase} from '@/lib/supabase';
import {appOrigin} from '@/lib/auth-navigation';
import {accountDeletionEnabled,requestAccountDeletion} from '@/lib/account-deletion';

export async function requestDeletion(form:FormData){
 if(!accountDeletionEnabled())notFound();
 const password=z.string().min(1).max(128).safeParse(form.get('password'));
 if(!password.success||form.get('confirm')!=='si')redirect('/cuenta/baja?msg=invalido');
 const db=await supabase();
 const result=await requestAccountDeletion(db,password.data);
 if(result.status==='unauthenticated')redirect('/cuenta?next=%2Fpreferencias');
 if(result.status==='invalid')redirect('/cuenta/baja?msg=credenciales');
 if(result.status!=='requested')redirect('/cuenta/baja?msg=error');
 const jar=await cookies();
 jar.set('riuya-baja-limpieza',JSON.stringify({userId:result.userId,recoverUntil:result.recoverUntil}),{httpOnly:true,sameSite:'strict',secure:appOrigin().startsWith('https://'),path:'/cuenta/baja-confirmada',maxAge:120});
 redirect('/cuenta/baja-confirmada');
}
