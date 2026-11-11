import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
const rows=Object.fromEntries(readFileSync('.env.z07-demo','utf8').split(/\r?\n/).filter(x=>x.startsWith('DEMO_')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
const u=rows.DEMO_USER_ID;if(rows.DEMO_STATUS!=='ready'||!/^[0-9a-f-]{36}$/i.test(u))throw Error('Cuenta ficticia no disponible');
const sql=`begin;
do $$ begin if not exists(select 1 from auth.users where id='${u}' and raw_app_meta_data->>'fixture'='z07-demo') then raise exception 'NOT_A_FIXTURE';end if;end $$;
insert into private.notification_deliveries(id,user_id,channel,local_date,timezone,scheduled_at,status,sent_at,is_example) values
('9c41c12c-4c10-4abc-8a6d-460c3b6a3001','${u}','news','2000-01-01','America/Guayaquil','2000-01-01 13:00:00+00','sent','2000-01-01 13:00:00+00',true),
('9c41c12c-4c10-4abc-8a6d-460c3b6a3002','${u}','results','2000-01-01','America/Guayaquil','2000-01-01 13:00:00+00','sent','2000-01-01 13:00:00+00',true) on conflict do nothing;
do $$ begin if (select count(*) from private.notification_deliveries where id in ('9c41c12c-4c10-4abc-8a6d-460c3b6a3001','9c41c12c-4c10-4abc-8a6d-460c3b6a3002') and user_id='${u}' and is_example)<>2 then raise exception 'FIXTURE_CONFLICT';end if;end $$;
commit;`;
execFileSync('docker',['exec','-i','supabase_db_app','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:sql,stdio:['pipe','ignore','pipe']});
console.log('Ejemplos simulados preparados en la cuenta ficticia; no se modificó el consentimiento.');
