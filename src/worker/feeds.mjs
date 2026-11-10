import {XMLParser,XMLValidator} from 'fast-xml-parser';import {canonicalUrl} from './editorial.mjs';
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',processEntities:false,parseTagValue:false,parseAttributeValue:false,trimValues:true});
const array=x=>x===undefined?[]:Array.isArray(x)?x:[x];
function text(x){if(typeof x==='string'||typeof x==='number')return String(x);if(x&&typeof x==='object')return text(x['#text']);return '';}
function plain(x){return text(x).replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();}
function link(x,kind){
 if(kind==='rss')return text(x);
 const links=array(x);const chosen=links.find(a=>typeof a==='object'&&(!a['@_rel']||a['@_rel']==='alternate')&&a['@_href']);
 return chosen?.['@_href']||'';
}
export function parseFeed(body,kind,baseUrl){
 if(!['rss','atom','api'].includes(kind)||!Buffer.isBuffer(body)||body.length>1048576)throw Error('INVALID_FEED');
 const rawBody=body.toString('utf8');let records;
 if(kind==='api'){
  let doc;try{doc=JSON.parse(rawBody);}catch{throw Error('INVALID_FEED');}
  if(!doc||!['https://jsonfeed.org/version/1','https://jsonfeed.org/version/1.1'].includes(doc.version)||typeof doc.title!=='string'||!Array.isArray(doc.items))throw Error('INVALID_FEED');
  records=doc.items;
 }else{
  if(/<!DOCTYPE|<!ENTITY/i.test(rawBody)||XMLValidator.validate(rawBody)!==true)throw Error('INVALID_XML');
  const doc=parser.parse(rawBody);records=kind==='rss'?array(doc.rss?.channel?.item):array(doc.feed?.entry);
  if(kind==='rss'&&!doc.rss?.channel||kind==='atom'&&!doc.feed)throw Error('INVALID_FEED');
 }
 const output=[];const seen=new Set();
 for(const x of records.slice(0,200)){
  if(!x||typeof x!=='object')continue;
  const title=plain(x.title).slice(0,300),raw=kind==='api'?text(x.url):link(x.link,kind),timestamp=Date.parse(text(kind==='rss'?x.pubDate:kind==='api'?x.date_published||x.date_modified:x.published||x.updated));
  if(!title||!raw||!Number.isFinite(timestamp))continue;
  let url;try{url=canonicalUrl(new URL(raw,baseUrl).href);}catch{continue;}
  if(url.length>2048||seen.has(url)||new URL(url).hostname!==new URL(baseUrl).hostname)continue;seen.add(url);output.push({url,title,date:new Date(timestamp).toISOString()});
  if(output.length===50)break;
 }
 return output;
}
