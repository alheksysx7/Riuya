import Link from 'next/link';
import {cookies} from 'next/headers';
import {notFound} from 'next/navigation';
import {accountDeletionEnabled} from '@/lib/account-deletion';
import {ClearDrafts} from './clear-drafts';

export const dynamic='force-dynamic';
export default async function DeletionConfirmed(){
 if(!accountDeletionEnabled())notFound();
 const value=(await cookies()).get('riuya-baja-limpieza')?.value;
 let userId:string|null=null;let recoverUntil:Date|null=null;
 try{
  const parsed=JSON.parse(value||'null');
  if(typeof parsed?.userId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.userId)&&typeof parsed?.recoverUntil==='string'){
   const date=new Date(parsed.recoverUntil);
   if(!Number.isNaN(date.getTime())){userId=parsed.userId;recoverUntil=date;}
  }
 }catch{/* La confirmación solo se muestra con una respuesta válida. */}
 if(!userId||!recoverUntil)return <main className="reader-shell"><div className="account-panel"><h1>Solicitud de baja</h1><p>No hay una confirmación disponible en esta pestaña.</p><Link href="/cuenta/recuperar-cuenta">Recuperar una cuenta</Link></div></main>;
 return <main className="reader-shell"><div className="account-panel"><h1>Solicitud recibida</h1>
 <p>Tu cuenta está desactivada. Puedes recuperarla hasta {new Intl.DateTimeFormat('es-EC',{dateStyle:'long',timeStyle:'short',timeZone:'UTC'}).format(recoverUntil)} (UTC).</p>
 <ClearDrafts userId={userId}/><Link className="reader-button" href="/cuenta/recuperar-cuenta">Recuperar mi cuenta</Link><p><Link href="/">Volver a noticias</Link></p></div></main>;
}
