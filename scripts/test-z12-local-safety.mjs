import assert from 'node:assert/strict';
import {localTestEnvironment} from './local-safety.mjs';
const status={API_URL:'http://127.0.0.1:54321',PUBLISHABLE_KEY:'public-test-key',ANON_KEY:'legacy-test-key'};
const env={NEXT_PUBLIC_SUPABASE_URL:status.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:status.PUBLISHABLE_KEY,RIUYA_ENABLE_ACCOUNT_DELETION:'1'};
assert.equal(localTestEnvironment(env,status).RIUYA_ENABLE_ACCOUNT_DELETION,'0');
assert.equal(env.RIUYA_ENABLE_ACCOUNT_DELETION,'1');
assert.equal(localTestEnvironment({...env,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:status.ANON_KEY},status).RIUYA_ENABLE_ACCOUNT_DELETION,'0');
for(const wrong of [
 {...env,NEXT_PUBLIC_SUPABASE_URL:'https://external.invalid'},
 {...env,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'wrong'},
 {...env,APP_ORIGIN:'https://external.invalid'}
])assert.throws(()=>localTestEnvironment(wrong,status));
assert.throws(()=>localTestEnvironment(env,{...status,API_URL:'https://external.invalid'}));
assert.throws(()=>localTestEnvironment({...env,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:''},{...status,ANON_KEY:'',PUBLISHABLE_KEY:''}));
console.log('Z12 arranque local: destino, clave, origen y baja deshabilitada OK');
