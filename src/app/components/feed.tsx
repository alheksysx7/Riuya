'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Page } from '@/lib/reader';
export function Feed({initial,category}:{initial:Page;category:string|null}) {
 const [page,setPage]=useState(initial); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
 async function more(){ if(!page.nextCursor || loading)return; setLoading(true); setError(''); try { const params=new URLSearchParams({cursor:page.nextCursor}); if(category)params.set('category',category); const response=await fetch(`/api/v1/news?${params}`,{cache:'no-store'}); if(!response.ok)throw new Error(); const next:Page=await response.json(); setPage(p=>({...next,items:[...p.items,...next.items]})); } catch {setError('No se pudieron cargar más noticias. Inténtalo nuevamente.');} finally {setLoading(false);} }
 if(!page.items.length)return <div className="reader-empty"><h2>Por ahora no hay noticias</h2><p>Cuando se publique una noticia, aparecerá aquí.</p></div>;
 return <><div className="reader-grid">{page.items.map(item=><article className="news-card" key={item.id}><div className="card-meta"><span>{item.category}</span><time dateTime={item.publishedAt}>{new Intl.DateTimeFormat('es',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(item.publishedAt))}</time></div><h2><Link prefetch={false} href={`/noticias/${item.id}`}>{item.title}</Link></h2><p>{item.summary}</p><Link className="card-link" prefetch={false} href={`/noticias/${item.id}`}>Leer noticia <span aria-hidden="true">↗</span></Link></article>)}</div>{error && <p role="alert">{error}</p>}{page.hasMore && <div className="reader-more"><button className="reader-button" disabled={loading} onClick={more}>{loading?'Cargando…':'Cargar más noticias'}</button></div>}</>;
}

