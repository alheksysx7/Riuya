import assert from 'node:assert/strict';

export async function probeOffline({browser,authenticatedPage,id,appPort}){
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||!Number.isInteger(appPort)||appPort<1024||appPort>65535)throw Error('LAB_SCOPE_INVALID');
 const state=await authenticatedPage.context().storageState();
 const context=await browser.newContext({storageState:state,serviceWorkers:'allow'}),page=await context.newPage();
 const base='http://127.0.0.1:'+appPort;
 try{
  const manifest=await (await page.request.get(base+'/manifest.webmanifest')).json();
  assert.equal(manifest.name,'Riuya');assert.equal(manifest.start_url,'/');
  for(const size of [256,512]){
   const icon=manifest.icons.find(item=>item.sizes===size+'x'+size&&item.type==='image/png');
   assert(icon,'LAB_PWA_ICON_MISSING');
   const response=await page.request.get(base+icon.src);assert.equal(response.status(),200);
   const bytes=await response.body();
   assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
  }

  const worker=await page.request.get(base+'/sw.js');
  assert.match(worker.headers()['cache-control'],/no-store/);
  await page.goto(base+'/offline.html');
  await page.evaluate(async()=>{await caches.open('fixture-ajeno');await caches.open('riuya-offline-v1');});
  await page.goto(base+'/actividad');
  await page.getByRole('heading',{name:'Mi actividad'}).waitFor();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.reload();
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  const cdp=await context.newCDPSession(page);
  try{
   const installability=await cdp.send('Page.getInstallabilityErrors');
   assert.deepEqual(installability.installabilityErrors.map(error=>error.errorId),['in-incognito']);
  }finally{await cdp.detach();}
  const before=await page.evaluate(async()=>{
   const names=await caches.keys(),app=names.filter(name=>name.startsWith('riuya-offline-'));
   const keys=await (await caches.open(app[0])).keys();
   return {names,app,paths:keys.map(request=>new URL(request.url).pathname)};
  });
  assert.deepEqual(before.app,['riuya-offline-v2']);
  assert.deepEqual(before.paths,['/offline.html']);
  assert(before.names.includes('fixture-ajeno'));
  assert(!before.names.includes('riuya-offline-v1'));
  let attempts=0;
  page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/v1/news/'))attempts++;});
  await context.setOffline(true);
  await page.goto(base+'/actividad');
  await page.getByRole('heading',{name:'No hay conexión'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Reintentar'}).count(),1);
  const unavailable=await page.evaluate(async()=>{
   const get=await fetch('/api/v1/me/activity').then(()=>false,()=>true);
   const post=await fetch('/api/v1/news/00000000-0000-4000-8000-000000000001/participation',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(()=>false,()=>true);
   return {get,post};
  });
  assert.deepEqual(unavailable,{get:true,post:true});
  assert.equal(attempts,1);
  await context.setOffline(false);
  await new Promise(resolve=>setTimeout(resolve,1500));
  assert.equal(attempts,1,'LAB_OFFLINE_UNEXPECTED_RETRY');
  await page.getByRole('link',{name:'Reintentar'}).click();
  await page.getByRole('heading',{name:'Mi actividad'}).waitFor();
  const after=await page.evaluate(async()=>{const keys=await (await caches.open('riuya-offline-v2')).keys();return keys.map(request=>new URL(request.url).pathname);});
  assert.deepEqual(after,['/offline.html']);
  console.log('Z12 desconexión aislada: manifiesto sin otros errores en Chrome temporal, caché y API sin reenvío: OK');
 }finally{await context.close();}
}
