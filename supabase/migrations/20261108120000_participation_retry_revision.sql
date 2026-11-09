-- Un reintento idéntico recupera su recibo incluso tras una corrección editorial.
grant create on schema api to riuya_participation_executor;
set local role riuya_participation_executor;
create or replace function api.confirm_participation(p_article_id uuid,p_revision_id uuid,p_operation_id uuid,p_choice_kind text,p_opinion_ids uuid[]) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid; account_state text; a private.articles%rowtype; state private.article_user_state%rowtype; existing private.participations%rowtype; canonical uuid[]; hash text; result private.participations%rowtype;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='PT401'; end if;
 select account_status into account_state from private.profiles where id=uid for share;
 if account_state is distinct from 'active' then raise exception 'ACCOUNT_INACTIVE' using errcode='42501'; end if;
 select * into a from private.articles where id=p_article_id for share;
 if not found then raise exception 'NOT_FOUND' using errcode='PT404'; end if;
 if p_operation_id is null or (p_choice_kind is null or p_choice_kind not in ('voices','none')) or p_opinion_ids is null or array_position(p_opinion_ids,null) is not null then raise exception 'INVALID_SELECTION' using errcode='22023'; end if;
 if cardinality(p_opinion_ids)<>(select count(distinct x) from unnest(p_opinion_ids) x) or (p_choice_kind='none' and cardinality(p_opinion_ids)<>0) or (p_choice_kind='voices' and cardinality(p_opinion_ids) not between 1 and 8) then raise exception 'INVALID_SELECTION' using errcode='22023'; end if;
 select coalesce(array_agg(x order by x),'{}'::uuid[]) into canonical from unnest(p_opinion_ids) x;
 hash:=encode(extensions.digest(convert_to(jsonb_build_object('article',p_article_id,'revision',p_revision_id,'kind',p_choice_kind,'opinions',to_jsonb(canonical))::text,'UTF8'),'sha256'),'hex');
 insert into private.article_user_state(user_id,article_id) values(uid,a.id) on conflict(user_id,article_id) do nothing;
 select * into state from private.article_user_state where user_id=uid and article_id=a.id for update;
 select * into existing from private.participations where user_id=uid and operation_id=p_operation_id;
 if found then if existing.payload_hash is distinct from hash then raise exception 'OPERATION_CONFLICT' using errcode='PT409'; end if; return jsonb_build_object('id',existing.id,'status','confirmed','choiceKind',existing.choice_kind,'confirmedAt',existing.confirmed_at); end if;
 if p_revision_id is distinct from a.current_revision_id then raise exception 'CONTENT_CHANGED' using errcode='PT409'; end if;
 select * into existing from private.participations where user_id=uid and article_id=a.id;
 if found then raise exception 'ALREADY_CONFIRMED' using errcode='PT409'; end if;
 if state.full_results_seen_at is not null then raise exception 'PARTICIPATION_LOCKED' using errcode='PT409'; end if;
 if exists(select 1 from unnest(canonical) x where not exists(select 1 from private.opinions o where o.id=x and o.revision_id=a.current_revision_id)) then raise exception 'INVALID_OPINION' using errcode='22023'; end if;
 begin insert into private.participations(user_id,article_id,revision_id,choice_kind,operation_id,payload_hash) values(uid,a.id,p_revision_id,p_choice_kind,p_operation_id,hash) returning * into result;
 exception when unique_violation then raise exception 'OPERATION_CONFLICT' using errcode='PT409'; end;
 insert into private.participation_choices(participation_id,opinion_id) select result.id,x from unnest(canonical) x;
 return jsonb_build_object('id',result.id,'status','confirmed','choiceKind',result.choice_kind,'confirmedAt',result.confirmed_at);
end $$;
reset role;
revoke create on schema api from riuya_participation_executor;
