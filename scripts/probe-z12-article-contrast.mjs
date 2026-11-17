import assert from 'node:assert/strict';
import sharp from 'sharp';

const selectors=['.card-meta > span','.card-meta time','h1','.article-summary'];
const categories=['politica','economia','tecnologia','ciencia','sociedad','cultura'];
const hideText='.article-hero .card-meta > span,.article-hero .card-meta time,.article-hero h1,.article-hero .article-summary{color:transparent!important;text-shadow:none!important}';
function luminance(rgb){
 return rgb.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4})
  .reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
}
function contrast(a,b){
 const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}

// Muestrea píxeles del fondo real después de volver transparentes solo los textos.
export async function probeArticleContrast({browser,id,appPort,article}){
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||!Number.isInteger(appPort)||appPort<1024||appPort>65535||!/^[a-f0-9-]{36}$/.test(article))throw Error('LAB_SCOPE_INVALID');
 let minimum=Infinity,samples=0;
 for(const scheme of ['light','dark'])for(const width of [360,1200]){
  const page=await browser.newPage({viewport:{width,height:1500},colorScheme:scheme,deviceScaleFactor:1});
  try{
   const cdp=await page.context().newCDPSession(page);
   await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme},{name:'prefers-reduced-transparency',value:'no-preference'}]});
   await page.goto('http://127.0.0.1:'+appPort+'/noticias/'+article);
   const hero=page.locator('.article-hero');await hero.scrollIntoViewIfNeeded();
   assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-transparency: no-preference)').matches),true,'LAB_TRANSPARENCY_MEDIA');
   assert.match(await hero.evaluate(element=>getComputedStyle(element).backdropFilter),/blur\(12px\)/,'LAB_GLASS_NOT_RENDERED');
   for(const category of categories){
    await hero.evaluate((element,value)=>{element.dataset.category=value},category);
    const box=await hero.boundingBox();assert.ok(box);
    const elements=[];
    for(const selector of selectors){
     const el=hero.locator(selector),pos=await el.boundingBox();
     const color=await el.evaluate(element=>getComputedStyle(element).color);
     const match=/^rgb\((\d+), (\d+), (\d+)\)$/.exec(color);
     assert.ok(match&&pos,'LAB_CONTRAST_TEXT');elements.push({selector,pos,fg:match.slice(1).map(Number)});
    }
    const style=await page.addStyleTag({content:hideText});
    let png;
    try{png=await hero.screenshot({scale:'css'});}finally{await style.evaluate(element=>element.remove());}
    const {data,info}=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
    for(const {selector,pos,fg} of elements){
     let min=Infinity,count=0;
     const x0=Math.max(0,Math.floor(pos.x-box.x)),y0=Math.max(0,Math.floor(pos.y-box.y));
     const x1=Math.min(info.width,Math.ceil(pos.x+pos.width-box.x)),y1=Math.min(info.height,Math.ceil(pos.y+pos.height-box.y));
     for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){
      const k=(y*info.width+x)*3;min=Math.min(min,contrast(fg,[data[k],data[k+1],data[k+2]]));count++;
     }
     assert.ok(count>0,'LAB_CONTRAST_EMPTY');samples+=count;minimum=Math.min(minimum,min);
     assert.ok(min>=4.5,'LAB_ARTICLE_CONTRAST '+scheme+' '+width+' '+category+' '+selector+' '+min.toFixed(2));
    }
   }
  }finally{await page.close();}
 }
 console.log('Z12 contraste de cabecera: seis categorías, claro y oscuro, 360 y 1200 px; mínimo muestreado '+minimum.toFixed(2)+':1; '+samples+' píxeles: OK');
}
