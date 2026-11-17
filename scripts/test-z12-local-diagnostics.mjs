import assert from 'node:assert/strict';
import {validateLocalTarget,collectDiagnostics} from './local-diagnostics.mjs';
const status={API_URL:'http://127.0.0.1:54321',DB_URL:'postgresql://postgres:fake@127.0.0.1:54322/postgres'};
assert.equal(validateLocalTarget(status),status.DB_URL);
for(const value of [
 {...status,API_URL:'https://external.invalid'},
 {...status,DB_URL:'postgresql://postgres:fake@external.invalid:54322/postgres'},
 {...status,DB_URL:'postgresql://postgres:fake@127.0.0.1:54323/postgres'},
 {...status,DB_URL:'postgresql://postgres:fake@127.0.0.1:54322/postgres?host=external.invalid'},
 {...status,DB_URL:'postgresql://other:fake@127.0.0.1:54322/postgres'}
])assert.throws(()=>validateLocalTarget(value));
const calls=[];
const bad={query:async sql=>{calls.push(sql);if(sql.startsWith('select'))throw Error('SENSITIVE_FAKE');return {rows:[]};}};
await assert.rejects(collectDiagnostics(bad));
assert.equal(calls.at(-1),'rollback');
console.log('Z12 diagnóstico: límites de destino y rollback ante error OK');
