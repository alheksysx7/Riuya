'use client';
import {useRef,type ReactNode} from 'react';
import {useFormStatus} from 'react-dom';
function Fields({children}:{children:ReactNode}){const {pending}=useFormStatus();return <fieldset disabled={pending}>{children}</fieldset>;}
export function RequestForm({action,itemId,children}:{action:(data:FormData)=>Promise<void>;itemId?:string;children:ReactNode}){
 const request=useRef<HTMLInputElement>(null);
 return <form action={action} onSubmit={()=>{if(request.current)request.current.value=crypto.randomUUID();}}>
  <input ref={request} type="hidden" name="requestId" defaultValue=""/>
  {itemId&&<input type="hidden" name="itemId" value={itemId}/>}<Fields>{children}</Fields>
 </form>;
}
