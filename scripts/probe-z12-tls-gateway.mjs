// Puerta de pruebas: únicamente reenvía al PostgreSQL del proyecto temporal.
import {readFileSync} from 'node:fs';
import {createConnection,createServer} from 'node:net';
import {createServer as createTlsServer} from 'node:tls';

const host=process.env.LAB_TARGET_HOST;
if(!/^supabase_db_riuya_z11_lab_[a-f0-9]{20}$/.test(host||''))throw Error('LAB_SCOPE_INVALID');
const tlsServer=createTlsServer({key:readFileSync('/tmp/certs/key.pem'),cert:readFileSync('/tmp/certs/cert.pem')},socket=>{
 socket.on('error',()=>{});
 const upstream=createConnection({host,port:5432});
 upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
 socket.pipe(upstream);upstream.pipe(socket);
});
tlsServer.on('tlsClientError',()=>{});
createServer(socket=>{
 socket.on('error',()=>{});let request=Buffer.alloc(0);
 const receive=chunk=>{
  request=Buffer.concat([request,chunk]);if(request.length<8)return;
  if(request.length!==8||request.readUInt32BE(0)!==8||request.readUInt32BE(4)!==80877103){socket.destroy();return;}
  socket.removeListener('data',receive);socket.write('S',()=>tlsServer.emit('connection',socket));
 };
 socket.on('data',receive);
}).listen(5432,'0.0.0.0');
