-- PR-4: extend the v2 event allowlist without changing existing migrations or CAS semantics.
create or replace function public.commit_game_v2(p_id uuid,p_expected bigint,p_state jsonb,p_public jsonb,p_events jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare e jsonb; k text; allowed text[];
begin
 if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>1
  or jsonb_typeof(p_state->'v2') is distinct from 'object' or (p_state->>'id')::uuid is distinct from p_id
  or coalesce((p_state->>'version')::bigint,0)<=p_expected
  or p_public->'version' is distinct from p_state->'version' then
  raise exception 'INVALID_V2_COMMIT';
 end if;
 -- A stale CAS cannot append events or update the public projection.
 if not public.commit_game(p_id,p_expected,p_state,p_public) then return false; end if;
 for e in select value from jsonb_array_elements(p_events) loop
  if jsonb_typeof(e) is distinct from 'object'
   or not e ?& array['request_id','at','actor_member','action','stage_id','role','data']
   or e - array['request_id','at','actor_member','action','stage_id','role','data'] <> '{}'::jsonb
   or jsonb_typeof(e->'data') is distinct from 'object'
   or not exists(select 1 from jsonb_array_elements(p_state->'members') m
    where m->>'id'=e->>'actor_member' and m->'role'=e->'role') then
   raise exception 'INVALID_GAME_EVENT';
  end if;
  allowed = case e->>'action'
   when 'submit-step' then array['step_id','accepted','method']
   when 'request-hint' then array['target_role','level','penalty']
   when 'select-alt-mode' then array['mode_id']
   when 'report-arrival' then array['method']
   when 'open-lock' then array['opened','attempts']
   when 'open-after-explanation' then array['method']
   when 'join-game' then array[]::text[]
   when 'start-game' then array[]::text[]
   when 'set-ready' then array[]::text[]
   when 'begin-operation' then array[]::text[]
   when 'submit-report' then array[]::text[]
   when 'confirm-explanation' then array[]::text[]
   when 'depart-next-site' then array[]::text[]
   else null end;
  if allowed is null or (e->'data') - allowed <> '{}'::jsonb then raise exception 'INVALID_GAME_EVENT'; end if;
  if e->>'action'='select-alt-mode' and (
    e->>'stage_id' is distinct from 'yongbong' or e->>'role' is distinct from 'commander'
    or e->'data' is distinct from '{"mode_id":"outdoor"}'::jsonb
    or p_state->'v2'->'altMode'->>'yongbong' is distinct from 'outdoor'
  ) then raise exception 'INVALID_GAME_EVENT'; end if;
  for k in select jsonb_object_keys(e->'data') loop
   if jsonb_typeof(e->'data'->k) not in ('string','number','boolean') then raise exception 'INVALID_GAME_EVENT'; end if;
  end loop;
  -- Never accept arbitrary request payloads, records, answers, salts, hashes or GPS fields.
  insert into public.game_events(game_id,request_id,at,actor_member,action,stage_id,role,data)
   values(p_id,e->>'request_id',to_timestamp((e->>'at')::double precision/1000),e->>'actor_member',e->>'action',e->>'stage_id',e->>'role',e->'data');
 end loop;
 return true;
 -- Any validation or insertion failure rolls back commit_game in the same transaction.
end $$;
revoke execute on function public.commit_game_v2(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_game_v2(uuid,bigint,jsonb,jsonb,jsonb) to service_role;
