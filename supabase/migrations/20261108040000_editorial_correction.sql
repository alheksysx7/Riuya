-- Corrección menor atómica: la versión publicada anterior permanece visible hasta el commit.
create function api.editor_correct(p_id uuid,p_expected_version integer,p_data jsonb,p_reason text,p_confirm boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; a private.articles%rowtype; saved jsonb; reviewed jsonb; published jsonb; existing_events uuid[];
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_confirm is distinct from true then raise exception 'APPROVAL_REQUIRED' using errcode='22023'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
 select * into a from private.articles where id=p_id for update;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
 if a.status <> 'published' or a.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into existing_events from private.editorial_events where article_id=a.id;
 update private.articles set status='draft' where id=a.id;
 saved:=api.editor_save(a.id,a.version,p_data);
 update private.article_revisions set correction_note=p_reason where id=(saved->>'revisionId')::uuid;
 reviewed:=api.editor_review(a.id,(saved->>'version')::integer);
 published:=api.editor_publish(a.id,(reviewed->>'version')::integer,(reviewed->>'revisionId')::uuid,reviewed->>'reviewHash',true);
 update private.articles set published_at=a.published_at where id=a.id;
 update private.editorial_events set event_type='correct',reason=p_reason where article_id=a.id and event_type='publish' and not(id=any(existing_events));
 return jsonb_build_object('id',a.id,'status','published','version',(published->>'version')::integer,'publishedAt',a.published_at);
end $$;
grant create on schema api to riuya_editor_executor;
alter function api.editor_correct(uuid,integer,jsonb,text,boolean) owner to riuya_editor_executor;
revoke create on schema api from riuya_editor_executor;
set local role riuya_editor_executor;
revoke all on function api.editor_correct(uuid,integer,jsonb,text,boolean) from public,anon;
grant execute on function api.editor_correct(uuid,integer,jsonb,text,boolean) to authenticated;
reset role;
