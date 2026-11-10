// Solo para el proceso de prueba: red simulada para un dominio ficticio.
import dns from 'node:dns/promises';import https from 'node:https';import {EventEmitter} from 'node:events';import {Readable} from 'node:stream';
dns.lookup=async(host)=>{if(host!=='fixtures.example.invalid')throw Error('TEST_HOST_ONLY');return [{address:'8.8.8.8',family:4}];};
https.request=(url,options,callback)=>{
 if(url.hostname!=='fixtures.example.invalid')throw Error('TEST_HOST_ONLY');
 options.lookup(url.hostname,{},(_error,address)=>{if(address!=='8.8.8.8')throw Error('ADDRESS_NOT_PINNED');});
 const req=new EventEmitter();req.destroy=error=>req.emit('error',error);
 req.end=()=>{const xml='<rss><channel><item><title>SIMULACIÓN Biblioteca Zeta abre parque público</title><link>https://fixtures.example.invalid/a</link><pubDate>Mon, 09 Nov 2026 12:00:00 GMT</pubDate><description>NO_GUARDAR_CONTENIDO</description></item><item><title>SIMULACIÓN Biblioteca Zeta abre nuevo parque público</title><link>https://fixtures.example.invalid/b</link><pubDate>Mon, 09 Nov 2026 13:00:00 GMT</pubDate></item></channel></rss>';const res=Readable.from([Buffer.from(xml)]);res.statusCode=200;res.headers={'content-type':'application/rss+xml',etag:'test-etag'};res.on('close',()=>req.emit('close'));queueMicrotask(()=>callback(res));};
 return req;
};
