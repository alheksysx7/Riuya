import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import { feed } from '@/lib/reader';
import { Feed } from './components/feed';
export const dynamic='force-dynamic';
type Category={name:string;slug:string};
export default async function Home({searchParams}:{searchParams:Promise<{categoria?:string}>}) {
 const query=await searchParams; const category=typeof query.categoria==='string'?query.categoria:null; let categories:Category[]=[]; let data;
 try {const db=await supabase(); const c=await db.schema('api').rpc('list_categories'); if(c.error) throw c.error; categories=c.data as Category[]; data=await feed(category,null);} catch {return <main className="reader-shell"><header className="reader-header"><Link href="/" className="reader-brand"><Image src="/assets/r8-icono-128.png" width={42} height={42} alt="" /> <span>Riuya</span></Link></header><section className="reader-empty" role="alert"><h1>No pudimos cargar las noticias</h1><p>Comprueba que los servicios locales estén activos y vuelve a intentarlo.</p><Link className="reader-button" href="/">Reintentar</Link></section></main>;}
 return <main className="reader-shell"><header className="reader-header"><Link href="/" className="reader-brand"><Image src="/assets/r8-icono-128.png" width={42} height={42} alt="" /> <span>Riuya</span></Link><span className="reader-header-note">Una noticia. Distintas miradas.</span></header><section className="reader-intro"><span className="reader-eyebrow">EL MUNDO, DESDE OTRAS MIRADAS</span><h1>La actualidad tiene<br/><em>más de una voz.</em></h1><p>Explora las noticias y conoce distintas formas de entender lo que pasa.</p></section><section className="reader-content"><div className="reader-section-title"><div><span className="reader-eyebrow">EN CONTEXTO</span><h2>Noticias</h2></div></div><nav className="reader-filters" aria-label="Filtrar noticias por categoría"><Link aria-current={!category?'page':undefined} href="/">Todas</Link>{categories.map(c=><Link key={c.slug} aria-current={category===c.slug?'page':undefined} href={`/?categoria=${encodeURIComponent(c.slug)}`}>{c.name}</Link>)}</nav><Feed key={category||'all'} initial={data} category={category}/></section><footer className="reader-footer">Riuya · Distintas miradas, una conversación</footer></main>;
}


