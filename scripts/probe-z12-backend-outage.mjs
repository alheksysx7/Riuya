import assert from 'node:assert/strict';

export async function probeBackendOutage({page,id,appPort,article,stopBackend,startBackend}){
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||!Number.isInteger(appPort)||appPort<1024||appPort>65535||
  !/^[a-f0-9-]{36}$/.test(article)||typeof stopBackend!=='function'||typeof startBackend!=='function')throw Error('LAB_SCOPE_INVALID');
 const base='http://127.0.0.1:'+appPort;
 let attempted=false;
 try{
  await page.goto(base+'/actividad');
  await page.getByRole('heading',{name:'Mi actividad'}).waitFor();
  attempted=true;stopBackend();
  assert.equal((await page.request.get(base+'/api/health/live')).status(),200);
  assert.equal((await page.request.get(base+'/api/health/ready')).status(),503);
  await page.goto(base+'/');
  await page.getByRole('heading',{name:'No pudimos cargar las noticias'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Reintentar'}).count(),1);
  await page.goto(base+'/actividad');
  await page.getByRole('heading',{name:'No pudimos comprobar tu sesión'}).waitFor();
  assert.equal((await page.request.get(base+'/api/v1/me/activity')).status(),503);
  await page.goto(base+'/preferencias');
  await page.getByRole('heading',{name:'No pudimos comprobar tu sesión'}).waitFor({timeout:10000});
  assert.equal(await page.getByRole('link',{name:'Reintentar'}).count(),1);
  assert.equal((await page.request.get(base+'/api/v1/news/'+article+'/participation')).status(),503);
  for(const path of ['participation','omit','results/access']){
   const response=await page.request.post(base+'/api/v1/news/'+article+'/'+path,{headers:{Origin:base},data:{}});
   assert.equal(response.status(),503,'LAB_BACKEND_API_STATUS '+path);
   assert.match(response.headers()['cache-control']||'',/no-store/);
  }

  console.log('Z12 desconexión backend: mensajes, respuestas y salud degradada: OK');
 }finally{
  if(attempted){
   startBackend();
   let ready=false;
   for(let i=0;i<80&&!ready;i++){
    try{ready=(await page.request.get(base+'/api/health/ready',{timeout:4000})).status()===200;}catch{}
    if(!ready)await new Promise(resolve=>setTimeout(resolve,250));
   }
   assert(ready,'LAB_BACKEND_RESTART_FAILED');
  }
 }
 await page.goto(base+'/actividad');
 await page.getByRole('heading',{name:'Mi actividad'}).waitFor();
 assert.equal((await page.request.get(base+'/api/v1/me/activity')).status(),200);
 console.log('Z12 desconexión backend: recuperación de sesión y actividad: OK');
}
