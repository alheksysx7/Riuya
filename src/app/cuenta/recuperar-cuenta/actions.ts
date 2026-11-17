'use server';
import {notFound,redirect} from 'next/navigation';
import {z} from 'zod';
import {supabase} from '@/lib/supabase';
import {accountDeletionEnabled,recoverDeletedAccount} from '@/lib/account-deletion';

export async function recoverAccount(form:FormData){
 if(!accountDeletionEnabled())notFound();
 const input=z.object({email:z.email().max(254),password:z.string().min(1).max(128)}).safeParse({email:form.get('email'),password:form.get('password')});
 if(!input.success)redirect('/cuenta/recuperar-cuenta?msg=error');
 const result=await recoverDeletedAccount(await supabase(),input.data.email,input.data.password);
 if(result.status==='signed_in')redirect('/cuenta/recuperar-cuenta?msg=sesion');
 if(result.status!=='recovered')redirect('/cuenta/recuperar-cuenta?msg=error');
 redirect('/preferencias?msg=recuperada');
}
