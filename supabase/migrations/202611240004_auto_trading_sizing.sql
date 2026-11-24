begin;
alter table pmoffice_private.auto_trading_items
 add column if not exists sizing jsonb not null default '{"mode":"fixed_notional","value":"10"}',
 add column if not exists sizing_version bigint not null default 0,
 add column if not exists sizing_actor uuid,
 add column if not exists sizing_request_id uuid,
 add column if not exists sizing_updated_at timestamptz;
create or replace function public.auto_trading_set_sizing(p_id uuid,p_version bigint,p_config jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t pmoffice_private.auto_trading_items;n numeric;cfg jsonb;
begin
 if not coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if p_request_id is null or jsonb_typeof(p_config) is distinct from 'object' or (p_config-'mode'-'value')<>'{}'::jsonb or jsonb_typeof(p_config->'value') is distinct from 'string' or coalesce(p_config->>'mode','') not in('fixed_notional','available_percent') or coalesce(p_config->>'value','') !~ '^(0|[1-9][0-9]{0,7})(\.[0-9]{1,4})?$' then raise invalid_parameter_value;end if;
 n:=(p_config->>'value')::numeric;
 if n<=0 or (p_config->>'mode'='available_percent' and n>100) then raise exception using errcode='22023',message='투자 비율은 0% 초과 100% 이하로 입력해 주세요.';end if;
 cfg:=jsonb_build_object('mode',p_config->>'mode','value',n::text);
 select * into t from pmoffice_private.auto_trading_items where id=p_id for update;
 if not found then raise no_data_found;end if;
 if t.sizing_request_id=p_request_id then
  if t.sizing<>cfg then raise invalid_parameter_value;end if;
  return jsonb_build_object('id',t.id,'sizing',t.sizing,'sizing_version',t.sizing_version);
 end if;
 if t.archived or t.worker_hash is null or t.last_seen is null or t.last_seen<now()-interval '15 seconds' then raise exception 'PC 연결을 확인한 뒤 투자금을 적용해 주세요.';end if;
 if p_version is distinct from t.sizing_version then raise exception using errcode='40001',message='투자금 설정이 바뀌었습니다. 최신 설정을 확인해 주세요.';end if;
 update pmoffice_private.auto_trading_items set sizing=cfg,sizing_version=sizing_version+1,sizing_actor=auth.uid(),sizing_request_id=p_request_id,sizing_updated_at=now() where id=p_id returning * into t;
 insert into pmoffice_private.auto_trading_audit(trading_id,actor_id,action,details) values(t.id,auth.uid(),'sizing.save',jsonb_build_object('version',t.sizing_version,'config',cfg,'request_id',p_request_id));
 return jsonb_build_object('id',t.id,'sizing',t.sizing,'sizing_version',t.sizing_version);
end$$;
revoke all on function public.auto_trading_set_sizing(uuid,bigint,jsonb,uuid) from public,anon;
grant execute on function public.auto_trading_set_sizing(uuid,bigint,jsonb,uuid) to authenticated;
create or replace function public.auto_trading_worker(p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t pmoffice_private.auto_trading_items;c pmoffice_private.auto_trading_commands;token text;item_id uuid;e jsonb;
begin
 if p_action='pair' then
 item_id:=split_part(p->>'code','.',1)::uuid;
 select * into t from pmoffice_private.auto_trading_items where id=item_id for update;
 if not found or t.archived or t.pair_expires<now() or t.pair_hash is null or t.pair_hash<>encode(extensions.digest(split_part(p->>'code','.',2),'sha256'),'hex') or not pmoffice_private.auto_trading_actor_ok(t.paired_by) then raise insufficient_privilege;end if;
 if t.symbol<>p->>'symbol' or t.timeframe<>p->>'timeframe' then raise exception '종목·시간봉이 등록 정보와 다릅니다.';end if;
 if coalesce(p->>'account_hash','') !~ '^[0-9a-f]{64}$' then raise invalid_parameter_value;end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 update pmoffice_private.auto_trading_items set worker_hash=encode(extensions.digest(token,'sha256'),'hex'),account_hash=p->>'account_hash',pair_hash=null,pair_expires=null,connected_at=now(),last_seen=null,snapshot_revision=0 where id=t.id;
 insert into pmoffice_private.auto_trading_audit(trading_id,actor_id,action) values(t.id,t.paired_by,'paired');
 return jsonb_build_object('id',t.id,'name',t.name,'token',token,'account_hash',p->>'account_hash');
 end if;
 select * into t from pmoffice_private.auto_trading_items where id=(p->>'id')::uuid for update;
 if not found or t.archived or t.worker_hash is null or t.worker_hash is distinct from encode(extensions.digest(p->>'token','sha256'),'hex') then raise insufficient_privilege;end if;
 if p_action='sync' then
 if (p->>'revision')::bigint>t.snapshot_revision then
 update pmoffice_private.auto_trading_items set snapshot=p->'snapshot',snapshot_revision=(p->>'revision')::bigint,last_seen=now() where id=t.id;
 elsif (p->>'revision')::bigint=t.snapshot_revision then update pmoffice_private.auto_trading_items set last_seen=now() where id=t.id;end if;
 for e in select value from jsonb_array_elements(coalesce(p->'events','[]')) loop
 insert into pmoffice_private.auto_trading_events(trading_id,event_id,revision,received_ms,data) values(t.id,e->>'event_id',(e->>'revision')::bigint,(e->>'received_ms')::bigint,e)
 on conflict(trading_id,event_id) do update set revision=excluded.revision,data=excluded.data where auto_trading_events.revision<excluded.revision;
 end loop;
 update pmoffice_private.auto_trading_commands set state='expired',completed_at=now() where trading_id=t.id and state='queued' and expires_at<=now();
 return jsonb_build_object('sizing',case when t.sizing_actor is null or pmoffice_private.auto_trading_actor_ok(t.sizing_actor) then t.sizing||jsonb_build_object('version',t.sizing_version) else null end,'server_time',now(),'commands',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from(select * from pmoffice_private.auto_trading_commands where trading_id=t.id and ((state='queued' and expires_at>now()) or state='executing') order by created_at limit 10)x),'[]'));
 elsif p_action='claim' then
 select * into c from pmoffice_private.auto_trading_commands where id=(p->>'command_id')::uuid and trading_id=t.id for update;
 if not found then raise no_data_found;end if;
 if c.state not in('queued','executing') then return to_jsonb(c);end if;
 if c.expires_at<=now() then update pmoffice_private.auto_trading_commands set state=case when state='executing' then 'uncertain' else 'expired' end,completed_at=now() where id=c.id returning * into c;
 elsif not pmoffice_private.auto_trading_actor_ok(c.requested_by) then update pmoffice_private.auto_trading_commands set state='failed',result='{"error":"관리자 권한이 회수되었습니다."}',completed_at=now() where id=c.id returning * into c;
 else update pmoffice_private.auto_trading_commands set state='executing',claimed_at=now() where id=c.id returning * into c;end if;
 return to_jsonb(c);
 elsif p_action='ack' then
 update pmoffice_private.auto_trading_commands set state=p->>'state',result=p->'result',completed_at=now() where id=(p->>'command_id')::uuid and trading_id=t.id and state in('executing','uncertain') and p->>'state' in('completed','failed','uncertain') returning * into c;
 return to_jsonb(c);
 else raise invalid_parameter_value;end if;
end$$;
revoke all on function public.auto_trading_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.auto_trading_worker(text,jsonb) to service_role;

commit;
