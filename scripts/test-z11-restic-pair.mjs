import assert from 'node:assert/strict';
import {validateFixturePair} from './probe-z11-restic-fixture.mjs';

const db='a'.repeat(64),storage='b'.repeat(64),pair={version:1,database:db,storage};
assert.equal(validateFixturePair(pair,db,storage),pair);
for(const bad of [null,{}, {...pair,database:storage}, {...pair,storage:db}, {...pair,version:2}, {...pair,extra:true}, {...pair,database:'invalid'}]){
 assert.throws(()=>validateFixturePair(bad,db,storage),/LAB_RESTIC_PAIR_INVALID/);
}
console.log('Z11 laboratorio: manifiesto incompleto o cruzado rechazado: OK');
