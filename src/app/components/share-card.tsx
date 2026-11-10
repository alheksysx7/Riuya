'use client';
import {useEffect,useRef,useState} from 'react';
import type {Results} from '@/lib/results';
type Props={value:Results;title:string;summary:string;revisionId:string;selectedNames:string[];simulation:boolean};
function lines(c:CanvasRenderingContext2D,text:string,x:number,y:number,width:number,height:number,max:number){
 const out:string[]=[];let line='';for(const word of text.trim().split(/\s+/)){const next=line?line+' '+word:word;if(c.measureText(next).width>width&&line){out.push(line);line=word;}else line=next;}if(line)out.push(line);
 const visible=out.slice(0,max);if(out.length>max){let last=visible[max-1];while(last&&c.measureText(last+'…').width>width)last=last.slice(0,-1);visible[max-1]=last+'…';}visible.forEach((s,i)=>c.fillText(s,x,y+i*height));
}
function draw(canvas:HTMLCanvasElement,p:Props,detailed:boolean){
 const c=canvas.getContext('2d');if(!c)throw Error('Canvas no disponible');c.fillStyle='#eef5f4';c.fillRect(0,0,1080,1920);c.fillStyle='#d7e8e4';c.beginPath();c.arc(1020,140,330,0,Math.PI*2);c.fill();
 c.fillStyle='#173e46';c.font='bold 46px Segoe UI, sans-serif';c.fillText('RIUYA',90,130);
 if(p.simulation){c.fillStyle='#8c4e2f';c.font='bold 30px Segoe UI, sans-serif';c.fillText('SIMULACIÓN · DATOS FICTICIOS',90,205);}
 c.fillStyle='#52797a';c.font='bold 29px Segoe UI, sans-serif';c.fillText('UNA NOTICIA, DISTINTAS MIRADAS',90,340);
 c.fillStyle='#142638';c.font='bold 68px Georgia, serif';lines(c,p.title,90,440,900,82,5);
 c.fillStyle='#4c6670';c.font='38px Segoe UI, sans-serif';lines(c,p.summary,90,925,900,54,5);
 c.fillStyle='#ffffff';c.beginPath();c.roundRect(90,1280,900,330,36);c.fill();
 c.fillStyle='#173e46';c.font='bold 38px Segoe UI, sans-serif';c.fillText(p.value.mode==='preliminary'?'Resultados preliminares':'Distintas voces, una conversación',135,1360);
 c.fillStyle='#50646f';c.font='32px Segoe UI, sans-serif';lines(c,detailed?'Mis elecciones: '+p.selectedNames.join(', '):'Una mirada para seguir conversando.',135,1430,810,48,3);
 c.fillStyle='#173e46';c.font='bold 36px Segoe UI, sans-serif';c.fillText('Descubre otras miradas en Riuya',90,1765);c.fillStyle='#668486';c.font='28px Segoe UI, sans-serif';c.fillText('Lee · participa · reflexiona',90,1825);
}
export function ShareCard(props:Props){
 const canvas=useRef<HTMLCanvasElement>(null);const [open,setOpen]=useState(false);const [detailed,setDetailed]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
 useEffect(()=>{if(open&&canvas.current)draw(canvas.current,props,detailed);},[open,detailed,props]);
 async function exportCard(share:boolean){
  if(!canvas.current||busy)return;setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/v1/news/'+props.value.articleId,{cache:'no-store'});
   if(!response.ok)throw Error('La noticia ya no está disponible. No se puede generar la tarjeta.');
   const article=await response.json();if(article.revisionId!==props.revisionId)throw Error('La noticia cambió. Recarga la página antes de crear la tarjeta.');
   draw(canvas.current,props,detailed);const blob=await new Promise<Blob>((resolve,reject)=>canvas.current!.toBlob(b=>b?resolve(b):reject(Error('No se pudo crear el PNG.')),'image/png'));const file=new File([blob],'riuya-tarjeta.png',{type:'image/png'});
   if(share&&navigator.share&&navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Riuya'});return;}catch(e){if(e instanceof Error&&e.name==='AbortError')return;setMessage('No se pudo compartir. Puedes descargar la imagen.');return;}}
   if(share){setMessage('Tu navegador no permite compartir archivos. Usa Descargar PNG.');return;}
   const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='riuya-tarjeta.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setMessage(e instanceof Error?e.message:'No se pudo crear la tarjeta.');}finally{setBusy(false);}
 }
 return <section className="share-card"><h2>Comparte esta noticia</h2><p>La tarjeta privada no incluye tus elecciones. Puedes revisarla antes de compartirla.</p>
 {!open?<button className="account-secondary" onClick={()=>setOpen(true)}>Crear tarjeta</button>:<>
 {props.selectedNames.length>0&&<label className="share-option"><input type="checkbox" checked={detailed} onChange={e=>setDetailed(e.target.checked)}/> Incluir mis elecciones en la tarjeta</label>}
 <canvas ref={canvas} width={1080} height={1920} className="share-preview" aria-label={detailed?'Vista previa con tus elecciones':'Vista previa privada sin tus elecciones'}/>
 <p>{detailed?'Vista previa detallada: tus elecciones aparecerán en la imagen.':'Vista previa privada: tus elecciones no aparecen en la imagen.'}</p>
 <div className="share-actions"><button className="reader-button" disabled={busy} onClick={()=>void exportCard(false)}>Descargar PNG</button><button className="account-secondary" disabled={busy} onClick={()=>void exportCard(true)}>Compartir imagen</button><button className="account-secondary" disabled={busy} onClick={()=>{setOpen(false);setDetailed(false);}}>Cerrar vista previa</button></div>
 </>}{message&&<p role="status">{message}</p>}</section>;
}
