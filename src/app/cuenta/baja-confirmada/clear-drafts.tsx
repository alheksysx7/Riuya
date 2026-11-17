'use client';
import {useEffect,useState} from 'react';

export function ClearDrafts({userId}:{userId:string}){
 const [message,setMessage]=useState('Limpiando los borradores de esta pestaña…');
 useEffect(()=>{
  let active=true;
  queueMicrotask(()=>{
   try{
    for(let i=sessionStorage.length-1;i>=0;i--){
     const key=sessionStorage.key(i);
     if(key?.startsWith(`riuya:draft:${userId}:`)||key?.startsWith(`riuya:pending:${userId}:`)||key?.startsWith(`riuya:results-pending:${userId}:`))sessionStorage.removeItem(key);
    }
    sessionStorage.removeItem('riuya:transfer');
    if(active)setMessage('Se limpiaron los borradores de esta cuenta en esta pestaña.');
   }catch{if(active)setMessage('No pudimos limpiar los borradores de esta pestaña. Puedes borrar los datos del sitio desde el navegador.');}
  });
  return ()=>{active=false;};
 },[userId]);
 return <p role="status">{message}</p>;
}
