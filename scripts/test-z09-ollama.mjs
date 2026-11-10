import assert from 'node:assert/strict';import {generateWithOllama} from '../src/worker/ollama.mjs';import {fixtureDraft} from '../src/worker/editorial.mjs';
const source={key:'f1',name:'Fuente ficticia',date:'2026-11-09',url:'https://example.org/a'},candidate=fixtureDraft(source);let calls=0;
const mock=async(url,opts)=>{assert(url.startsWith('http://127.0.0.1:11434/'));assert.equal(opts.redirect,'error');if(url.endsWith('/api/tags'))return Response.json({models:[{name:'qwen3:8b',digest:'a'.repeat(64)}]});calls++;const request=JSON.parse(opts.body);assert.equal(request.stream,false);assert.equal(request.format.type,'object');return Response.json({done:true,response:calls===1?'{}':JSON.stringify(candidate)});};
const result=await generateWithOllama({source,title:'Titular ficticio'},mock);assert.equal(result.attempts,2);assert.equal(result.digest,'a'.repeat(64));assert.equal(calls,2);
calls=0;const invalid=async(url)=>url.endsWith('/api/tags')?Response.json({models:[{name:'qwen3:8b',digest:'a'.repeat(64)}]}):(calls++,Response.json({done:true,response:'{}'}));
await assert.rejects(()=>generateWithOllama({source,title:'Prueba'},invalid),/OLLAMA_FORMAT_INVALID/);assert.equal(calls,3);
await assert.rejects(()=>generateWithOllama({source,title:'Prueba'},async()=>Response.json({models:[]})),/OLLAMA_MODEL_UNAVAILABLE/);
console.log('Z09 Ollama simulado: esquema, digest y hasta dos reparaciones: OK');

