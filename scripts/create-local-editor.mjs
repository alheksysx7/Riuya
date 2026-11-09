import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
const url=process.env.TEST_LOCAL_URL,key=process.env.TEST_LOCAL_SERVICE;
if(url!=='http://127.0.0.1:54321'||!key) throw Error('Solo permitido en Supabase local');
const path='.env.editor-local'; if(existsSync(path)) { console.log('Ya existe un archivo de acceso local; no se modificó.'); process.exit(0); }
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const email=`editor-${randomBytes(6).toString('hex')}@example.invalid`; const password=randomBytes(20).toString('base64url'); let id;
try { const r=await admin.auth.admin.createUser({email,password,email_confirm:true}); if(r.error)throw r.error; id=r.data.user.id; if(!/^[0-9a-f-]{36}$/.test(id))throw Error('UUID inválido'); execFileSync('docker',['exec','-i','supabase_db_app','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q'],{input:`begin; insert into private.profiles(id) values ('${id}'); insert into private.user_roles(user_id,role) values ('${id}','editor'); commit;`,stdio:['pipe','ignore','pipe']}); writeFileSync(path,`# Cuenta ficticia exclusiva para desarrollo local\nEDITOR_EMAIL=${email}\nEDITOR_PASSWORD=${password}\n`,{flag:'wx'}); console.log('Cuenta editorial ficticia creada; acceso guardado en .env.editor-local.'); }
catch(e){if(id) await admin.auth.admin.deleteUser(id); throw e;}
