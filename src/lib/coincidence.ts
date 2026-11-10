// T07 está pendiente de validación de producto y no se expone en resultados.
export const COINCIDENCE_FORMULA_VERSION = 'T07-v1';
export type Choice = {kind:'none'} | {kind:'voices'; keys:string[]};
function choiceSet(choice:Choice):Set<string>{
 if(choice.kind==='none')return new Set(['none']);
 if(!choice.keys.length || choice.keys.some(x=>!x||x==='none') || new Set(choice.keys).size!==choice.keys.length)throw new Error('Selección inválida');
 return new Set(choice.keys);
}
export function jaccard(a:Choice,b:Choice):number{
 const left=choiceSet(a),right=choiceSet(b);let intersection=0;
 for(const x of left)if(right.has(x))intersection++;
 return intersection/new Set([...left,...right]).size;
}
export function communityCoincidence(own:Choice,others:Choice[]):number|null{
 if(others.length<9)return null;
 return 100*others.reduce((sum,other)=>sum+jaccard(own,other),0)/others.length;
}
