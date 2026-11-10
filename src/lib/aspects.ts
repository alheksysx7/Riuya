// T07: cálculo puro de aspectos; no expone etiquetas ni activa el catálogo.
export const ASPECT_FORMULA_VERSION='T07-v1';
export type Dimension='emotion'|'approach'|'stance';
export type Annotation={key:string;dimension:Dimension;weight:number};
export type Opinion=Annotation[];
export type Distribution={coverage:number;items:{key:string;percentage:number}[]};
const dimensions:Dimension[]=['emotion','approach','stance'];
function totals(opinions:Opinion[],dimension:Dimension):Map<string,number>{
 const out=new Map<string,number>();
 for(const opinion of opinions){
  const rows=opinion.filter(x=>x.dimension===dimension);
  const weights=rows.map(x=>x.weight).sort((a,b)=>b-a).join(',');
  if(rows.some(x=>!x.key)||new Set(rows.map(x=>x.key)).size!==rows.length||!['','10000','7000,3000','6000,2500,1500'].includes(weights))throw new Error('Aspectos inválidos');
  for(const row of rows)out.set(row.key,(out.get(row.key)||0)+row.weight/10000/opinions.length);
 }
 return out;
}
function distribution(values:Map<string,number>):Distribution|null{
 const coverage=[...values.values()].reduce((a,b)=>a+b,0);if(!coverage)return null;
 return {coverage,items:[...values].map(([key,value])=>({key,percentage:100*value/coverage})).sort((a,b)=>b.percentage-a.percentage||a.key.localeCompare(b.key))};
}
export function personalAspects(opinions:Opinion[]):Record<Dimension,Distribution|null>{
 return Object.fromEntries(dimensions.map(d=>[d,distribution(totals(opinions,d))])) as Record<Dimension,Distribution|null>;
}
export function communityAspects(participants:Opinion[][]):Record<Dimension,Distribution|null>{
 return Object.fromEntries(dimensions.map(d=>{
  const sums=new Map<string,number>();let contributors=0;
  for(const opinions of participants){const values=totals(opinions,d);if(values.size)contributors++;for(const [key,value] of values)sums.set(key,(sums.get(key)||0)+value);}
  return [d,participants.length>=10&&contributors>=10?distribution(sums):null];
 })) as Record<Dimension,Distribution|null>;
}
