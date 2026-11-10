import assert from 'node:assert/strict';import {proposePairs} from '../src/worker/cluster.mjs';
const rows=[{id:'a',title:'Ciudad inaugura parque público',date:'2026-11-09'},{id:'b',title:'Ciudad inaugura nuevo parque público',date:'2026-11-10'},{id:'c',title:'Mercado anuncia productos nuevos',date:'2026-11-10'}];
assert.deepEqual(proposePairs(rows),[{a:'a',b:'b'}]);assert.deepEqual(proposePairs(rows,{threshold:1}),[]);assert.throws(()=>proposePairs(rows,{threshold:2}));assert.deepEqual(proposePairs([{...rows[0],simulation:true},{...rows[1],simulation:false}]),[]);console.log('Z09 agrupación: propuesta determinista sin fusión: OK');

