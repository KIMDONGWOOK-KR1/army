-- Server-private snapshots plus safe Realtime projections. No raw GPS coordinates are stored.
create table public.courses_private (id text primary key, state jsonb not null);
create table public.games_private (id uuid primary key, join_code text unique not null, version bigint not null, state jsonb not null);
create table public.member_access (game_id uuid not null references public.games_private(id) on delete cascade, user_id uuid not null, primary key(game_id,user_id));
create table public.game_public (game_id uuid primary key references public.games_private(id) on delete cascade, version bigint not null, state jsonb not null);
create table public.create_receipts (user_id uuid not null, request_id text not null, request_hash text not null, game_id uuid not null references public.games_private(id), primary key(user_id,request_id));
create table public.join_failures (user_id uuid primary key, count integer not null default 0, retry_at timestamptz);
alter table public.courses_private enable row level security;
alter table public.games_private enable row level security;
alter table public.member_access enable row level security;
alter table public.game_public enable row level security;
alter table public.create_receipts enable row level security;
alter table public.join_failures enable row level security;
revoke all on public.courses_private,public.games_private,public.create_receipts,public.join_failures from anon,authenticated;
revoke all on public.member_access,public.game_public from anon,authenticated;
grant select on public.member_access,public.game_public to authenticated;
grant all on public.courses_private,public.games_private,public.member_access,public.game_public,public.create_receipts,public.join_failures to service_role;
create policy own_membership on public.member_access for select to authenticated using (user_id=auth.uid());
create policy team_projection on public.game_public for select to authenticated using (exists(select 1 from public.member_access a where a.game_id=game_public.game_id and a.user_id=auth.uid()));

create function public.commit_game(p_id uuid,p_expected bigint,p_state jsonb,p_public jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
 update games_private set state=p_state,version=(p_state->>'version')::bigint where id=p_id and version=p_expected;
 get diagnostics changed=row_count;
 if changed=0 then return false; end if;
 insert into member_access(game_id,user_id) select p_id,(m->>'userId')::uuid from jsonb_array_elements(p_state->'members') m on conflict do nothing;
 insert into game_public(game_id,version,state) values(p_id,(p_state->>'version')::bigint,p_public)
 on conflict(game_id) do update set version=excluded.version,state=excluded.state;
 return true;
end $$;

create function public.create_game_atomic(p_user uuid,p_request text,p_hash text,p_state jsonb,p_public jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare previous create_receipts; gid uuid; active_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into previous from create_receipts where user_id=p_user and request_id=p_request;
 if found then
  if previous.request_hash<>p_hash then raise exception 'REQUEST_CONFLICT'; end if;
  return previous.game_id;
 end if;
 select count(*) into active_count from member_access a join games_private g on g.id=a.game_id
 where a.user_id=p_user and g.state->>'status'<>'done' and (g.state->>'expiresAt')::bigint>extract(epoch from now())*1000;
 if active_count>=5 then raise exception 'RATE_LIMITED'; end if;
 gid=(p_state->>'id')::uuid;
 insert into games_private(id,join_code,version,state) values(gid,p_state->>'code',(p_state->>'version')::bigint,p_state);
 insert into member_access(game_id,user_id) values(gid,p_user);
 insert into game_public(game_id,version,state) values(gid,(p_state->>'version')::bigint,p_public);
 insert into create_receipts values(p_user,p_request,p_hash,gid);
 return gid;
end $$;

create function public.join_guard(p_user uuid,p_mode text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare f join_failures;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,1));
 insert into join_failures(user_id) values(p_user) on conflict do nothing;
 select * into f from join_failures where user_id=p_user for update;
 if f.retry_at is not null and f.retry_at<=now() then f.count=0;f.retry_at=null;end if;
 if p_mode='success' then f.count=0;f.retry_at=null;
 elsif p_mode='failure' then f.count=f.count+1;if f.count>=5 then f.retry_at=now()+interval '30 seconds';end if;end if;
 update join_failures set count=f.count,retry_at=f.retry_at where user_id=p_user;
 return jsonb_build_object('blocked',f.retry_at>now(),'retry_at',extract(epoch from f.retry_at)*1000);
end $$;

revoke execute on function public.commit_game(uuid,bigint,jsonb,jsonb),public.create_game_atomic(uuid,text,text,jsonb,jsonb),public.join_guard(uuid,text) from public,anon,authenticated;
grant execute on function public.commit_game(uuid,bigint,jsonb,jsonb),public.create_game_atomic(uuid,text,text,jsonb,jsonb),public.join_guard(uuid,text) to service_role;

alter publication supabase_realtime add table public.game_public;
create function public.broadcast_game_stage() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' or new.state->>'status' is distinct from old.state->>'status'
  or new.state->>'site_phase' is distinct from old.state->>'site_phase'
  or new.state->>'current_site_seq' is distinct from old.state->>'current_site_seq' then
  perform realtime.send(jsonb_build_object('version',new.version,'reveal_at',new.state->'reveal_at'),'stage','game:'||new.game_id::text,true);
 end if;
 return new;
end $$;
revoke execute on function public.broadcast_game_stage() from public,anon,authenticated;
create trigger broadcast_game_stage after insert or update on public.game_public for each row execute function public.broadcast_game_stage();
create policy team_presence on realtime.messages for select to authenticated using (
 extension in ('presence','broadcast') and exists(select 1 from public.member_access a where a.user_id=auth.uid() and realtime.topic()='game:'||a.game_id::text)
);
create policy team_broadcast on realtime.messages for insert to authenticated with check (
 extension in ('presence','broadcast') and exists(select 1 from public.member_access a where a.user_id=auth.uid() and realtime.topic()='game:'||a.game_id::text)
);
