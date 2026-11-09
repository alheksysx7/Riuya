'use client';
import { useActionState, type ReactNode } from 'react';
import { save, correct } from './actions';
export function EditorForm({correctable,children}:{correctable:boolean;children:ReactNode}) {
 const [state,action,pending]=useActionState(correctable ? correct : save,{error:''});
 return <form action={action} className="space-y-5">{state.error && <p role="alert" className="rounded-lg bg-red-100 p-4">{state.error}. Tus cambios siguen en el formulario.</p>}{children}{pending && <p role="status">Guardando…</p>}</form>;
}
