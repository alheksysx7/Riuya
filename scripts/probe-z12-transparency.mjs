import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const axe=createRequire(import.meta.url).resolve('axe-core');

export async function probeTransparency({browser,id,appPort,article}){
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||!Number.isInteger(appPort)||appPort<1024||appPort>65535||!/^[a-f0-9-]{36}$/.test(article))throw Error('LAB_SCOPE_INVALID');
 const context=await browser.newContext({viewport:{width:360,height:900}}),page=await context.newPage();
 const cdp=await context.newCDPSession(page),base='http://127.0.0.1:'+appPort;
 try{
  for(const scheme of ['light','dark']){
   await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme},{name:'prefers-reduced-transparency',value:'no-preference'}]});
   await page.goto(base+'/');
   const categories=['politica','economia','tecnologia','ciencia','sociedad','cultura'];
   const styles=await page.locator('.news-card').first().evaluate((card,categories)=>categories.map(category=>{
    const clone=card.cloneNode(true);clone.dataset.category=category;card.parentNode.appendChild(clone);
    const style=getComputedStyle(clone),result={gradient:style.backgroundImage,edge:style.borderTopColor,blur:style.backdropFilter};
    clone.remove();return result;
   }),categories);
   assert.equal(new Set(styles.map(x=>x.edge)).size,6,'LAB_CATEGORY_COLORS');
   assert.ok(styles.every(x=>x.gradient.includes('radial-gradient')),'LAB_CATEGORY_GRADIENT');
   if(await page.evaluate(()=>CSS.supports('backdrop-filter','blur(12px)')&&matchMedia('(prefers-reduced-transparency: no-preference)').matches))
    assert.ok(styles.every(x=>x.blur.includes('blur(12px)')),'LAB_GLASS_BLUR');
   await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme},{name:'prefers-reduced-transparency',value:'reduce'}]});
   await page.goto(base+'/');
   assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-transparency: reduce)').matches),true);
   const surface=scheme==='light'?'rgb(255, 255, 255)':'rgb(24, 38, 58)';
   assert.equal(await page.locator('.news-card').first().evaluate(el=>getComputedStyle(el).backgroundColor),surface);
   assert.equal(await page.locator('.news-card').first().evaluate(el=>getComputedStyle(el).backgroundImage),'none');
   assert.equal(await page.locator('.news-card').first().evaluate(el=>getComputedStyle(el).backdropFilter),'none');
   assert.equal(await page.locator('.reader-filters a:not([aria-current])').first().evaluate(el=>getComputedStyle(el).backgroundColor),surface);
   await page.goto(base+'/cuenta');
   const account=page.locator('.account-panel').first();
   assert.equal(await account.evaluate(el=>getComputedStyle(el).backgroundColor),surface);
   assert.equal(await account.evaluate(el=>getComputedStyle(el).backgroundImage),'none');
   assert.equal(await account.evaluate(el=>getComputedStyle(el).backdropFilter),'none');
   await page.evaluate(()=>sessionStorage.clear());
   await page.goto(base+'/noticias/'+article);
   await page.getByRole('heading',{name:'Noticia ficticia de accesibilidad'}).waitFor();
   assert.equal(await page.locator('.voice-card').first().evaluate(el=>getComputedStyle(el).backgroundColor),surface);
   const like=page.getByRole('button',{name:'♡ Me gusta'}).first();
   await like.click();
   assert.equal(await page.getByRole('button',{name:'♥ Te gusta'}).first().getAttribute('aria-pressed'),'true');
   const trigger=page.getByRole('button',{name:/Rami.*Conoce su mirada/});await trigger.click();
   const dialog=page.getByRole('dialog');await dialog.waitFor();
   const backdrop=await dialog.evaluate(el=>getComputedStyle(el,'::backdrop').backgroundColor);
   assert.equal(backdrop,scheme==='light'?'rgb(18, 42, 54)':'rgb(9, 18, 28)');
   await page.addScriptTag({path:axe});
   const contrast=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'rule',values:['color-contrast']}}));
   assert.deepEqual(contrast.violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>n.target)})),[],'LAB_REDUCED_TRANSPARENCY_CONTRAST '+scheme);
   await page.keyboard.press('Escape');
  }
  console.log('Z12 transparencia reducida: superficies opacas, selección y diálogo en claro y oscuro: OK');
 }finally{await cdp.detach();await context.close();}
}
