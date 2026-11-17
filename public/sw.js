/* Solo se guarda la pantalla pública de desconexión; no se guardan datos de la aplicación. */
const CACHE='riuya-offline-v2';
const OFFLINE='/offline.html';
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.add(new Request(OFFLINE,{cache:'reload',credentials:'omit'}))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('riuya-offline-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||event.request.mode!=='navigate')return;
 event.respondWith(fetch(event.request).catch(async()=>{
  const cache=await caches.open(CACHE);
  return (await cache.match(OFFLINE))||new Response('Sin conexión. Vuelve a intentarlo.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
 }));
});
