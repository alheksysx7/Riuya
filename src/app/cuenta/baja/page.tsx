import Link from 'next/link';
import {notFound} from 'next/navigation';
import {supabase} from '@/lib/supabase';
import {accountDeletionEnabled} from '@/lib/account-deletion';
import {requestDeletion} from './actions';

export const dynamic='force-dynamic';
const messages:Record<string,string>={
 invalido:'Confirma que deseas solicitar la baja y escribe tu contraseña.',
 credenciales:'No se pudo verificar la contraseña.',
 error:'No pudimos confirmar la solicitud. Comprueba tu acceso antes de intentarlo de nuevo.',
};
export default async function DeleteAccount({searchParams}:{searchParams:Promise<{msg?:string}>}){
 if(!accountDeletionEnabled())notFound();
 const db=await supabase();const {data}=await db.auth.getUser();const user=data.user;
 if(!user?.email_confirmed_at)return <main className="reader-shell"><div className="account-panel"><h1>Solicitar baja</h1><p>Inicia sesión para continuar.</p><Link className="reader-button" href="/cuenta?next=%2Fpreferencias">Iniciar sesión</Link></div></main>;
 const q=await searchParams;
 return <main className="reader-shell"><div className="account-panel"><Link href="/preferencias">← Preferencias</Link><h1>Solicitar baja</h1>
 <p>Tu cuenta dejará de tener acceso en cuanto solicites la baja. Podrás recuperarla durante siete días; después comenzará la eliminación de la cuenta y sus participaciones.</p>
 <p>Para confirmar, vuelve a escribir tu contraseña.</p>{q.msg&&messages[q.msg]&&<p className="account-message" role="alert">{messages[q.msg]}</p>}
 <form action={requestDeletion} className="account-form"><label>Contraseña<input className="account-input" name="password" type="password" autoComplete="current-password" maxLength={128} required/></label>
 <label className="share-option"><input type="checkbox" name="confirm" value="si" required/> Entiendo que solicito la baja de mi cuenta.</label>
 <button className="reader-button" type="submit">Solicitar baja</button></form></div></main>;
}
