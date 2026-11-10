begin;
do $$
declare u uuid:=gen_random_uuid();req uuid:=gen_random_uuid();first_id uuid;result jsonb;i integer;
begin
 insert into auth.users(id,email) values(u,'z09-'||u||'@example.invalid');insert into private.profiles(id) values(u);insert into private.user_roles(user_id,role) values(u,'editor');perform set_config('request.jwt.claim.sub',u::text,true);
 result:=api.enqueue_fixture_draft(req);first_id:=(result->>'id')::uuid;
 if (api.enqueue_fixture_draft(req)->>'id')::uuid<>first_id then raise exception 'IDEMPOTENCY_FAILED';end if;
 for i in 1..4 loop perform api.enqueue_fixture_draft(gen_random_uuid());end loop;
 begin perform api.enqueue_fixture_draft(gen_random_uuid());raise exception 'RATE_LIMIT_BYPASSED';exception when sqlstate 'PT429' then null;end;
 if (api.enqueue_fixture_draft(req)->>'id')::uuid<>first_id then raise exception 'RETRY_BLOCKED';end if;
end $$;
rollback;
