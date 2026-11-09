'use client';
import { useRef, useState } from 'react';
import { Avatar } from './avatar';
type Opinion={characterKey:string;name:string;body:string};
type Character={key:string;name:string;biography:string|null;traits:string[]|null;canonVersion:string};
export function Voices({opinions}:{opinions:Opinion[]}) {
 const dialog=useRef<HTMLDialogElement>(null); const trigger=useRef<HTMLButtonElement|null>(null); const [character,setCharacter]=useState<Character|null>(null); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
 async function open(key:string,button:HTMLButtonElement){trigger.current=button; setCharacter(null);setError('');setLoading(true); dialog.current?.showModal(); try{const response=await fetch(`/api/v1/characters/${encodeURIComponent(key)}`,{cache:'no-store'}); if(!response.ok)throw new Error();setCharacter(await response.json());}catch{setError('No pudimos cargar la ficha. Ciérrala y vuelve a intentarlo.');}finally{setLoading(false);}}
 function closed(){ trigger.current?.focus({preventScroll:true}); }
 return <><div className="voice-list">{opinions.map(o=><article className="voice-card" key={o.characterKey}><button className="voice-person" onClick={e=>open(o.characterKey,e.currentTarget)} aria-label={`Ver ficha de ${o.name}`}><Avatar name={o.name} characterKey={o.characterKey}/><span><strong>{o.name}</strong><small>Conoce su mirada ↗</small></span></button><p>{o.body}</p></article>)}</div><dialog className="voice-dialog" ref={dialog} onClose={closed} aria-label="Ficha de personaje"><div className="dialog-top"><span className="reader-eyebrow">UNA DE LAS OCHO VOCES</span><button className="dialog-close" onClick={()=>dialog.current?.close()} aria-label="Cerrar ficha">×</button></div>{loading && <p role="status">Cargando ficha…</p>}{error && <p role="alert">{error}</p>}{character && <><Avatar name={character.name} characterKey={character.key} large/><h2 id="character-title">{character.name}</h2><p>{character.biography||'La descripción de este personaje está pendiente de incorporación editorial.'}</p>{character.traits?.length ? <p>{character.traits.join(' · ')}</p>:null}<small>Personaje de ficción · contenido sujeto a revisión editorial</small></>}</dialog></>;
}


