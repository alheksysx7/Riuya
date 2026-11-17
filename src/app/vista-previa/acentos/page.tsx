import Link from 'next/link';
import {notFound} from 'next/navigation';
import {AccentPreview} from './preview';
export const dynamic='force-dynamic';
export default function Page(){
 if(process.env.APP_ENV!=='local')notFound();
 return <main className="reader-shell"><header className="reader-header"><Link className="reader-brand" href="/">Riuya</Link></header><article className="article-content"><Link className="article-back" href="/">← Volver a noticias</Link><div className="article-hero"><h1>Vista previa de acentos</h1><p className="article-summary">Simulación local: colores propuestos para opiniones ficticias. No son clasificaciones reales ni una validación editorial.</p></div><section className="article-voices"><h2>Paleta de emociones</h2><p>Prueba el botón de cada tarjeta para comparar la selección con su acento.</p><AccentPreview/></section></article></main>;
}
