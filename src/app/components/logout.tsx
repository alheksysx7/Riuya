'use client';
import {logout} from '@/app/cuenta/actions';
import {useSyncExternalStore} from 'react';
const subscribe=()=>()=>{};
export function Logout({userId}:{userId:string}){const ready=useSyncExternalStore(subscribe,()=>true,()=>false);function clear(){try{for(let i=sessionStorage.length-1;i>=0;i--){const k=sessionStorage.key(i);if(k?.startsWith(`riuya:draft:${userId}:`)||k?.startsWith(`riuya:pending:${userId}:`)||k?.startsWith(`riuya:results-pending:${userId}:`))sessionStorage.removeItem(k);}sessionStorage.removeItem('riuya:transfer');}catch{/* La sesión se cierra igualmente. */}}return <form action={logout} onSubmit={clear}><button className="account-secondary" disabled={!ready}>Cerrar sesión</button></form>;}
