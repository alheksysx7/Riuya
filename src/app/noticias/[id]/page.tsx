import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { Voices } from '@/app/components/voices';
type Article={title:string;summary:string;category:string;publishedAt:string;paragraphs:string[];sources:{key:string;name:string;date:string;url:string}[];opinions:{characterKey:string;name:string;body:string}[]};
export default async function News({params}:{params:Promise<{id:string}>}){const {id}=await params; if(!z.uuid().safeParse(id).success)notFound(); const db=await supabase();const {data,error}=await db.schema('api').rpc('reader_article',{p_id:id}); if(error)throw new Error('No se pudo cargar la noticia'); if(!data)notFound();const a=data as Article;
 return <main className="reader-shell"><header className="reader-header"><Link href="/" className="reader-brand"><Image src="/assets/r8-icono-128.png" width={42} height={42} alt="" /> <span>Riuya</span></Link></header><article className="article-content"><Link className="article-back" href="/">← Volver a noticias</Link><div className="card-meta"><span>{a.category}</span><time dateTime={a.publishedAt}>{new Intl.DateTimeFormat('es',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(a.publishedAt))}</time></div><h1>{a.title}</h1><p className="article-summary">{a.summary}</p><details className="article-expanded"><summary>Leer noticia completa <span aria-hidden="true">↓</span></summary><div>{a.paragraphs.map((p,i)=><p key={i}>{p.split(/(\[[A-Za-z0-9_-]+\])/g).map((piece,n)=>/^\[/.test(piece)?<a key={n} href={`#fuente-${piece.slice(1,-1)}`}>{piece}</a>:piece)}</p>)}<h2>Fuentes</h2><ul>{a.sources.map(s=><li key={s.key} id={`fuente-${s.key}`}>[{s.key}] <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> · {s.date}</li>)}</ul></div></details><section className="article-voices"><span className="reader-eyebrow">OCHO VOCES, DISTINTAS MIRADAS</span><h2>¿Cómo lo ves?</h2><p>Conoce las perspectivas de nuestros personajes.</p><Voices opinions={a.opinions}/></section></article></main>;
}

