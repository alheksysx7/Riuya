import assert from 'node:assert/strict';
import {requestAccountDeletion,recoverDeletedAccount} from '../src/lib/account-deletion.ts';
const user={id:'11111111-1111-4111-8111-111111111111',email:'fixture@example.invalid',email_confirmed_at:'2026-01-01'};
function fixture({current=user,currentError=null,loginUser=user,loginError=null,rpcData={status:'deletion_pending',recoverUntil:'2026-11-17T12:00:00Z'},rpcError=null}={}){
 const calls=[];
 return {calls,db:{auth:{
  async getUser(){calls.push('getUser');return {data:{user:current},error:currentError};},
  async signInWithPassword(input){calls.push(['signIn',input.email]);return {data:{user:loginUser},error:loginError};},
  async signOut(options){calls.push(['signOut',options.scope]);return {error:null};},
 },schema(name){assert.equal(name,'api');return {async rpc(method){calls.push(['rpc',method]);return {data:rpcData,error:rpcError};}};}}};
}
let f=fixture({current:null});
assert.deepEqual(await requestAccountDeletion(f.db,'x'),{status:'unauthenticated'});assert.deepEqual(f.calls,['getUser']);
f=fixture({loginUser:null,loginError:{message:'invalid'}});
assert.deepEqual(await requestAccountDeletion(f.db,'x'),{status:'invalid'});assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='rpc'),false);
f=fixture({loginUser:{...user,id:'22222222-2222-4222-8222-222222222222'}});
assert.deepEqual(await requestAccountDeletion(f.db,'x'),{status:'unavailable'});assert.deepEqual(f.calls.at(-1),['signOut','local']);
f=fixture({rpcData:null,rpcError:{message:'failed'}});
assert.deepEqual(await requestAccountDeletion(f.db,'x'),{status:'unavailable'});assert.equal(f.calls.some(x=>Array.isArray(x)&&x[0]==='signOut'),false);
f=fixture();assert.deepEqual(await requestAccountDeletion(f.db,'x'),{status:'requested',userId:user.id,recoverUntil:'2026-11-17T12:00:00Z'});assert.deepEqual(f.calls.at(-1),['signOut','local']);
f=fixture();assert.deepEqual(await recoverDeletedAccount(f.db,user.email,'x'),{status:'signed_in'});assert.deepEqual(f.calls,['getUser']);
f=fixture({current:null,currentError:{name:'NetworkError'}});
assert.deepEqual(await recoverDeletedAccount(f.db,user.email,'x'),{status:'unavailable'});assert.deepEqual(f.calls,['getUser']);
f=fixture({current:null,loginUser:null,loginError:{message:'invalid'}});
assert.deepEqual(await recoverDeletedAccount(f.db,user.email,'x'),{status:'unavailable'});
f=fixture({current:null,rpcError:{message:'failed'},rpcData:null});
assert.deepEqual(await recoverDeletedAccount(f.db,user.email,'x'),{status:'unavailable'});assert.deepEqual(f.calls.at(-1),['signOut','local']);
f=fixture({current:null,rpcData:{status:'active'}});
assert.deepEqual(await recoverDeletedAccount(f.db,user.email,'x'),{status:'recovered'});assert.deepEqual(f.calls.at(-1),['rpc','recover_account_deletion']);
console.log('Z11 interfaz: identidad, reautenticación, recuperación y errores: OK');
