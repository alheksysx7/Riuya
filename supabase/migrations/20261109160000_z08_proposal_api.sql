-- Editors submit only their own independent assessment; other submissions are never returned.
grant select,insert,update on private.aspect_annotation_proposals to riuya_editor_executor;
grant select on private.aspect_catalogs to riuya_editor_executor;
create policy editor_aspect_catalog_read on private.aspect_catalogs for select to riuya_editor_executor using(true);
create policy editor_own_proposal_select on private.aspect_annotation_proposals for select to riuya_editor_executor using(reviewer_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy editor_own_proposal_insert on private.aspect_annotation_proposals for insert to riuya_editor_executor with check(reviewer_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);
create policy editor_own_proposal_update on private.aspect_annotation_proposals for update to riuya_editor_executor using(reviewer_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid) with check(reviewer_id=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid);

grant create on schema api to riuya_editor_executor;
set local role riuya_editor_executor;
create function api.submit_aspect_proposal(p_opinion_id uuid,p_expected_version integer,p_dimension text,p_proposal jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; a private.articles%rowtype; normal jsonb; weights integer[];
begin
 if uid is null or not exists(select 1 from private.user_roles x join private.profiles p on p.id=x.user_id where x.user_id=uid and x.role in ('editor','admin') and p.account_status='active') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select a0.* into a from private.opinions o join private.article_revisions r on r.id=o.revision_id join private.articles a0 on a0.id=r.article_id where o.id=p_opinion_id and r.id=a0.current_revision_id for update of a0;
 if not found then raise exception 'NOT_FOUND' using errcode='P0002';end if;
 if a.status<>'draft' or a.version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='PT409';end if;
 if p_dimension not in ('emotion','approach','stance') or jsonb_typeof(p_proposal) is distinct from 'array' or jsonb_array_length(p_proposal)>3 or length(p_proposal::text)>12000 then raise exception 'INVALID_PROPOSAL' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_proposal) x where jsonb_typeof(x)<>'object' or (select count(*) from jsonb_object_keys(x))<>3 or not(x ?& array['labelId','weight','evidence']) or jsonb_typeof(x->'labelId')<>'string' or jsonb_typeof(x->'weight')<>'number' or jsonb_typeof(x->'evidence')<>'string' or length(btrim(x->>'evidence')) not between 1 and 2000) then raise exception 'INVALID_PROPOSAL' using errcode='22023';end if;
 begin
  select coalesce(jsonb_agg(jsonb_build_object('labelId',l.id,'weight',(x->>'weight')::integer,'evidence',x->>'evidence') order by l.id),'[]'::jsonb),array_agg((x->>'weight')::integer order by (x->>'weight')::integer desc)
  into normal,weights from jsonb_array_elements(p_proposal) x join private.aspect_labels l on l.id=(x->>'labelId')::uuid join private.aspect_catalogs c on c.id=l.catalog_id where l.dimension=p_dimension and c.status in ('proposed','validated');
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVALID_PROPOSAL' using errcode='22023';end;
 if jsonb_array_length(normal)<>jsonb_array_length(p_proposal) or (select count(distinct x->>'labelId') from jsonb_array_elements(normal) x)<>jsonb_array_length(normal) or (weights is not null and weights not in (array[10000],array[7000,3000],array[6000,2500,1500])) then raise exception 'INVALID_PROPOSAL' using errcode='22023';end if;
 insert into private.aspect_annotation_proposals(opinion_id,dimension,reviewer_id,proposal) values(p_opinion_id,p_dimension,uid,normal)
 on conflict(opinion_id,dimension,reviewer_id) do update set proposal=excluded.proposal,created_at=now();
 return jsonb_build_object('saved',true,'opinionId',p_opinion_id,'dimension',p_dimension);
end $$;
revoke all on function api.submit_aspect_proposal(uuid,integer,text,jsonb) from public,anon;
grant execute on function api.submit_aspect_proposal(uuid,integer,text,jsonb) to authenticated;
reset role;
revoke create on schema api from riuya_editor_executor;
