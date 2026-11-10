export function safeReturn(value:unknown):string {return typeof value==='string' && (value==='/actividad' || /^\/noticias\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))?value:'/';}
export function appOrigin():string {const origin=process.env.APP_ORIGIN || 'http://127.0.0.1:3102'; const u=new URL(origin); if(u.origin!==origin || !['http:','https:'].includes(u.protocol))throw new Error('APP_ORIGIN inválido'); return origin;}

