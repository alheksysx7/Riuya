begin;
do $$
declare u uuid:=gen_random_uuid();dn uuid:=gen_random_uuid();dr uuid:=gen_random_uuid();jn uuid:=gen_random_uuid();jr uuid:=gen_random_uuid();token uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,'z10-'||u||'@example.invalid');insert into private.profiles(id) values(u);
 perform set_config('request.jwt.claim.sub',u::text,true);perform api.update_notification_settings(true,true,8,'UTC',0);
 insert into private.notification_deliveries(id,user_id,channel,local_date,timezone,scheduled_at) values(dn,u,'news','2030-01-01','UTC',now()),(dr,u,'results','2030-01-01','UTC',now());
 insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values(jn,'notification.send',jsonb_build_object('deliveryId',dn),'z10-test-'||jn,u),(jr,'notification.send',jsonb_build_object('deliveryId',dr),'z10-test-'||jr,u);
 update private.jobs set status='running',locked_by='z10-test',lease_token=token,lease_until=now()+interval '60 seconds' where id=jr;
 perform api.update_notification_settings(true,false,8,'UTC',1);
 if (select status from private.notification_deliveries where id=dn)<>'queued' or (select status from private.jobs where id=jn)<>'queued' then raise exception 'NEWS_CANCELLED_BY_RESULTS_CHANGE';end if;
 if (select status from private.notification_deliveries where id=dr)<>'cancelled' or (select status from private.jobs where id=jr)<>'cancelled' then raise exception 'RESULTS_NOT_CANCELLED';end if;
 perform set_config('role','riuya_notification_worker',true);
 if private.complete_notification_at(jr,token,now()) then raise exception 'CANCELLED_RUNNING_JOB_SENT';end if;
 perform set_config('role','none',true);
end $$;
rollback;
