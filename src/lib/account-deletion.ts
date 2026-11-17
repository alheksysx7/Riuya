import type {SupabaseClient} from '@supabase/supabase-js';

type RequestResult={status:'requested';userId:string;recoverUntil:string}|{status:'unauthenticated'|'invalid'|'unavailable'};
type RecoverResult={status:'recovered'|'signed_in'|'unavailable'};

export function accountDeletionEnabled(){return process.env.RIUYA_ENABLE_ACCOUNT_DELETION==='1';}

// La identidad de la baja se obtiene de la sesión verificada, no del formulario.
export async function requestAccountDeletion(db:SupabaseClient,password:string):Promise<RequestResult>{
 const current=await db.auth.getUser();const user=current.data.user;
 if(current.error||!user?.email||!user.email_confirmed_at)return {status:'unauthenticated'};
 const reauth=await db.auth.signInWithPassword({email:user.email,password});
 if(reauth.error||!reauth.data.user)return {status:'invalid'};
 if(reauth.data.user.id!==user.id){await db.auth.signOut({scope:'local'});return {status:'unavailable'};}
 const result=await db.schema('api').rpc('request_account_deletion');
 if(result.error||result.data?.status!=='deletion_pending'||typeof result.data.recoverUntil!=='string'||Number.isNaN(Date.parse(result.data.recoverUntil)))return {status:'unavailable'};
 try{await db.auth.signOut({scope:'local'});}catch{/* Las sesiones ya fueron revocadas en la base. */}
 return {status:'requested',userId:user.id,recoverUntil:result.data.recoverUntil};
}

// Recuperación independiente: nunca reutiliza una sesión anterior.
export async function recoverDeletedAccount(db:SupabaseClient,email:string,password:string):Promise<RecoverResult>{
 const current=await db.auth.getUser();
 if(current.data.user)return {status:'signed_in'};
 if(current.error&&current.error.name!=='AuthSessionMissingError')return {status:'unavailable'};
 const login=await db.auth.signInWithPassword({email,password});
 if(login.error||!login.data.user?.email_confirmed_at){if(login.data.user)await db.auth.signOut({scope:'local'});return {status:'unavailable'};}
 const result=await db.schema('api').rpc('recover_account_deletion');
 if(result.error||result.data?.status!=='active'){await db.auth.signOut({scope:'local'});return {status:'unavailable'};}
 return {status:'recovered'};
}
