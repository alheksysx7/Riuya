import {z} from 'zod';
export const characterKeys=['rami','beatriz','leo','dmitri','naoki','salma','tove','kavya'];
const reference=z.object({key:z.string().regex(/^[A-Za-z0-9_-]+$/),name:z.string().min(1),date:z.iso.date(),url:z.url().refine(x=>['http:','https:'].includes(new URL(x).protocol))}).strict();
const opinion=z.object({characterKey:z.enum(characterKeys),body:z.string().min(1)}).strict();
export const candidateSchema=z.object({title:z.string().min(1).max(300),summary:z.string().min(1),paragraphs:z.array(z.string().min(1)).min(1),sources:z.array(reference).min(1),opinions:z.array(opinion).length(8)}).strict().superRefine((v,ctx)=>{
 if(new Set(v.opinions.map(x=>x.characterKey)).size!==8||new Set(v.sources.map(x=>x.key)).size!==v.sources.length)ctx.addIssue({code:'custom',message:'Personajes o fuentes repetidos'});
 const keys=new Set(v.sources.map(s=>s.key));
 for(const paragraph of v.paragraphs){const matches=[...paragraph.matchAll(/\[([A-Za-z0-9_-]+)\]/g)];if(!matches.length||matches.some(m=>!keys.has(m[1])))ctx.addIssue({code:'custom',message:'Cita ausente o desconocida'});}
});
export function validateCandidate(input,verifiedSources){
 const candidate=candidateSchema.parse(input);
 const allow=new Map(verifiedSources.map(s=>[s.key,s]));
 if(candidate.sources.some(s=>{const a=allow.get(s.key);return !a||a.name!==s.name||a.date!==s.date||a.url!==s.url;}))throw Error('UNVERIFIED_SOURCE');
 return candidate;
}
export function fixtureDraft(source){
 const verified=reference.parse(source);
 const candidate={title:'SIMULACIÓN · Propuesta editorial local',summary:'Este borrador es una simulación y requiere revisión editorial antes de cualquier publicación.',paragraphs:['Contenido de demostración sin hechos reales. ['+verified.key+']'],sources:[verified],opinions:characterKeys.map(characterKey=>({characterKey,body:'Opinión ficticia de demostración, pendiente de revisión.'}))};
 return validateCandidate(candidate,[verified]);
}
export function canonicalUrl(input){
 const u=new URL(input);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('INVALID_URL');
 u.hash='';u.hostname=u.hostname.toLowerCase();for(const k of [...u.searchParams.keys()])if(/^(utm_.+|gclid|fbclid)$/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.toString();
}
function tokens(title){return new Set(title.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>2));}
export function proposeMatch(a,b,{threshold=.5,maxDays=3}={}){
 const days=Math.abs(Date.parse(a.date)-Date.parse(b.date))/86400000;if(!Number.isFinite(days)||days>maxDays)return false;
 const entities=new Set(a.entities.map(x=>x.toLocaleLowerCase('es')));if(!b.entities.some(x=>entities.has(x.toLocaleLowerCase('es'))))return false;
 const left=tokens(a.title),right=tokens(b.title);const common=[...left].filter(x=>right.has(x)).length,union=new Set([...left,...right]).size;
 return union>0&&common/union>=threshold;
}
