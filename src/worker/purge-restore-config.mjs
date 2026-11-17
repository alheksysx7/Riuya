// No admite hosts remotos ni parámetros que puedan redirigir la conexión.
export function requireLocalRestoreDbUrl(raw){
 let url;try{url=new URL(raw);}catch{throw Error('PURGE_RESTORE_CONFIG_INVALID');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='54322'||url.pathname!=='/postgres'||!url.username||!url.password||url.search||url.hash)throw Error('PURGE_RESTORE_CONFIG_INVALID');
 return raw;
}
