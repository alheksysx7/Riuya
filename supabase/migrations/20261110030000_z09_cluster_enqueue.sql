grant create on schema private to riuya_job_executor;
set local role riuya_job_executor;
create or replace function private.complete_source_job(p_job uuid,p_token uuid,p_items jsonb,p_etag text,p_modified text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare j private.jobs%rowtype;s private.sources%rowtype;x jsonb;
begin
 select * into j from private.jobs where id=p_job and status='running' and job_type='source.fetch' and lease_token=p_token and lease_until>now() for update;
 if not found then return false;end if;
 select * into s from private.sources where id=(j.payload->>'sourceId')::uuid and version=(j.payload->>'sourceVersion')::integer and is_active and verified and verified_by is not null for update;
 if not found then return false;end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>50 or length(p_items::text)>150000 or length(coalesce(p_etag,''))>512 or length(coalesce(p_modified,''))>512 then raise exception 'INVALID_ITEMS' using errcode='22023';end if;
 for x in select * from jsonb_array_elements(p_items) loop
  if jsonb_typeof(x)<>'object' or not(x ?& array['url','title','date']) or (select count(*) from jsonb_object_keys(x))<>3 then raise exception 'INVALID_ITEMS' using errcode='22023';end if;
  insert into private.source_items(source_id,canonical_url,title,external_date) values(s.id,x->>'url',x->>'title',(x->>'date')::timestamptz) on conflict(canonical_url) do nothing;
 end loop;
 update private.sources set etag=p_etag,last_modified=p_modified,last_fetched_at=now() where id=s.id;
 if jsonb_array_length(p_items)>0 then
  insert into private.jobs(job_type,payload,dedupe_key,created_by) values('event.cluster',jsonb_build_object('sourceJobId',j.id),'cluster:'||j.id,j.created_by) on conflict(dedupe_key) do nothing;
 end if;
 update private.jobs set status='succeeded',locked_by=null,lease_token=null,lease_until=null,last_error=null,updated_at=now() where id=j.id;
 return true;
end $$;
reset role;
revoke create on schema private from riuya_job_executor;
