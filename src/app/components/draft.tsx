'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {z} from 'zod';
const draftSchema=z.object({articleId:z.uuid(),revisionId:z.uuid(),choices:z.array(z.uuid()).max(8),none:z.boolean(),scroll:z.number().min(0),updatedAt:z.number(),returnTo:z.string()}).refine(x=>!(x.none&&x.choices.length));
type Draft=z.infer<typeof draftSchema>;
const prefix='riuya:draft:'; const transferKey='riuya:transfer';
export function useDraft(articleId:string,revisionId:string,validIds:string[],userId:string|null){
 const owner=userId||'visitor';const key=`${prefix}${owner}:${articleId}:${revisionId}`;const [draft,setDraft]=useState<Draft>({articleId,revisionId,choices:[],none:false,scroll:0,updatedAt:0,returnTo:`/noticias/${articleId}`});const [ready,setReady]=useState(false);const [message,setMessage]=useState('');
 useEffect(()=>{const timer=window.setTimeout(()=>{try{let restored=sessionStorage.getItem(key);const transfer=sessionStorage.getItem(transferKey);if(userId&&transfer){const parsed=draftSchema.safeParse(JSON.parse(transfer));if(parsed.success&&parsed.data.articleId===articleId&&parsed.data.revisionId===revisionId&&!restored){restored=transfer;sessionStorage.setItem(key,transfer);sessionStorage.removeItem(`${prefix}visitor:${articleId}:${revisionId}`);}sessionStorage.removeItem(transferKey);}
 let stale=false; for(let i=sessionStorage.length-1;i>=0;i--){const k=sessionStorage.key(i);if(k&&k.startsWith(`${prefix}${owner}:${articleId}:`)&&k!==key){sessionStorage.removeItem(k);stale=true;}}
 if(restored){const parsed=draftSchema.safeParse(JSON.parse(restored));if(parsed.success&&parsed.data.articleId===articleId&&parsed.data.revisionId===revisionId&&parsed.data.choices.every(x=>validIds.includes(x))){setDraft(parsed.data);if(userId&&transfer) requestAnimationFrame(()=>window.scrollTo({top:parsed.data.scroll,behavior:'instant'}));}else{sessionStorage.removeItem(key);stale=true;}}
 if(stale)setMessage('La noticia cambió; la selección anterior se descartó.');}catch{setMessage('No se pudo recuperar el borrador en esta pestaña.');}setReady(true);},0);return ()=>window.clearTimeout(timer);
 // The key determines the immutable article, revision, owner and valid choices for this mount.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key]);
 useEffect(()=>{if(!ready)return;try{sessionStorage.setItem(key,JSON.stringify({...draft,scroll:Math.max(0,window.scrollY),updatedAt:Date.now()}));}catch{queueMicrotask(()=>setMessage('No se pudo guardar el borrador en esta pestaña.'));}},[draft,key,ready]);
 function toggle(id:string){setDraft(d=>({...d,none:false,choices:d.choices.includes(id)?d.choices.filter(x=>x!==id):[...d.choices,id]}));}
 function toggleNone(){setDraft(d=>({...d,none:!d.none,choices:[]}));}
 function prepareTransfer(){try{const value={...draft,scroll:Math.max(0,window.scrollY),updatedAt:Date.now()};sessionStorage.setItem(key,JSON.stringify(value));sessionStorage.setItem(transferKey,JSON.stringify(value));}catch{setMessage('No se pudo guardar el borrador para el regreso.');}}
 return {draft,ready,message,toggle,toggleNone,prepareTransfer};
}
export function DraftFooter({userId,none,onNone,onTransfer,articleId,message,ready}:{userId:string|null;none:boolean;ready:boolean;onNone:()=>void;onTransfer:()=>void;articleId:string;message:string}){return <div className="draft-footer">{message&&<p role="status">{message}</p>}<button type="button" disabled={!ready} className={`draft-none ${none?'draft-selected':''}`} aria-pressed={none} onClick={onNone}>Ninguna me representa</button><p>Tu selección es provisional y se guarda solo en esta pestaña. Todavía no se confirma.</p>{!userId&&<Link className="reader-button" href={`/cuenta?next=${encodeURIComponent(`/noticias/${articleId}`)}`} onClick={onTransfer}>Iniciar sesión y volver</Link>}</div>;}
