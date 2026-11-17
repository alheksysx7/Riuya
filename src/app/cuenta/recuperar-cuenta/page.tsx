import Link from 'next/link';
import {notFound} from 'next/navigation';
import {accountDeletionEnabled} from '@/lib/account-deletion';
import {supabase} from '@/lib/supabase';
import {Logout} from '@/app/components/logout';
import {recoverAccount} from './actions';

export const dynamic='force-dynamic';
const messages:Record<string,string>={
 sesion:'Cierra tu sesión actual antes de recuperar una cuenta.',
 error:'No pudimos recuperar la cuenta. Comprueba tus datos y el plazo de recuperación.',
};
export default async function RecoverDeletedAccount({searchParams}:{searchParams:Promise<{msg?:string}>}){
 if(!accountDeletionEnabled())notFound();
 const db=await supabase();const current=await db.auth.getUser();
 if(current.data.user)return <main className="reader-shell"><div className="account-panel"><Link href="/">← Noticias</Link><h1>Recuperar cuenta</h1><p>Cierra tu sesión actual antes de recuperar una cuenta.</p><Logout userId={current.data.user.id}/></div></main>;
 const q=await searchParams;
 return <main className="reader-shell"><div className="account-panel"><Link href="/cuenta">← Cuenta</Link><h1>Recuperar cuenta</h1>
 <p>Si solicitaste la baja, puedes recuperar tu cuenta durante los siete días siguientes. Inicia sesión para verificar tu identidad.</p>
 {q.msg&&messages[q.msg]&&<p className="account-message" role="alert">{messages[q.msg]}</p>}
 <form action={recoverAccount} className="account-form"><label>Correo<input className="account-input" name="email" type="email" autoComplete="email" maxLength={254} required/></label>
 <label>Contraseña<input className="account-input" name="password" type="password" autoComplete="current-password" maxLength={128} required/></label>
 <button className="reader-button" type="submit">Recuperar cuenta</button></form></div></main>;
}
