'use client';
import Image from 'next/image';
import {useState} from 'react';
export function Avatar({name,characterKey,large=false}:{name:string;characterKey:string;large?:boolean}) {const [failed,setFailed]=useState(false);return <span className={`voice-avatar ${large?'voice-avatar-large':''}`} aria-hidden="true">{failed ? name.slice(0,1) : <Image src={`/assets/personajes/${characterKey}.png`} width={large?72:48} height={large?72:48} alt="" onError={()=>setFailed(true)} style={{borderRadius:'50%',width:'100%',height:'100%',objectFit:'cover'}}/>}</span>;}
