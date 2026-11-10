import assert from 'node:assert/strict';
import {jaccard,communityCoincidence,COINCIDENCE_FORMULA_VERSION} from '../src/lib/coincidence.ts';
const none={kind:'none'},a={kind:'voices',keys:['rami']},ab={kind:'voices',keys:['rami','beatriz']};
assert.equal(COINCIDENCE_FORMULA_VERSION,'T07-v1');assert.equal(jaccard(none,none),1);assert.equal(jaccard(none,a),0);assert.equal(jaccard(ab,a),0.5);
assert.equal(communityCoincidence(a,Array(8).fill(a)),null);assert.equal(communityCoincidence(a,[...Array(8).fill(a),none]),800/9);
assert.throws(()=>jaccard({kind:'voices',keys:['none']},none));assert.throws(()=>jaccard({kind:'voices',keys:[]},none));console.log('Z08 fórmula propuesta T07: OK');
