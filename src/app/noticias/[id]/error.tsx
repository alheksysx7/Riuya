'use client';
export default function ErrorPage({reset}:{error:Error;reset:()=>void}) {return <main className="reader-shell"><section className="reader-empty" role="alert"><h1>No pudimos cargar esta página</h1><p>Comprueba los servicios locales y vuelve a intentarlo.</p><button className="reader-button" onClick={reset}>Reintentar</button></section></main>;}
