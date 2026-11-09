'use client';
import {startTransition,useActionState,useSyncExternalStore,type FormEvent,type ReactNode} from 'react';
import {save,correct} from './actions';
const subscribe=()=>()=>{};
export function EditorForm({correctable,children}:{correctable:boolean;children:ReactNode}) {
 const [state,action,pending]=useActionState(correctable?correct:save,{error:''});
 const ready=useSyncExternalStore(subscribe,()=>true,()=>false);
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);startTransition(()=>action(data));}
 return <form onSubmit={submit} className="space-y-5">{state.error&&<p role="alert" className="rounded-lg bg-red-100 p-4">{state.error}. Tus cambios siguen en el formulario.</p>}<fieldset disabled={!ready||pending} className="space-y-5">{children}</fieldset>{pending&&<p role="status">Guardando…</p>}</form>;
}
