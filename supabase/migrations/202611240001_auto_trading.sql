begin;
create table pmoffice_private.auto_trading_items(
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 160),
 account_alias text not null check(length(btrim(account_alias)) between 1 and 80),
 exchange text not null default 'BINANCE DEMO' check(exchange='BINANCE DEMO'),
 symbol text not null check(symbol ~ '^[A-Z0-9]{2,24}$'), timeframe text not null,
 archived boolean not null default false, version bigint not null default 1,
 snapshot jsonb not null default '{}', snapshot_revision bigint not null default 0,
 connected_at timestamptz, last_seen timestamptz, worker_hash text, account_hash text,
 pair_hash text, pair_expires timestamptz, paired_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index auto_trading_active_symbol on pmoffice_private.auto_trading_items(account_alias,symbol) where not archived;
create unique index auto_trading_paired_account_symbol on pmoffice_private.auto_trading_items(account_hash,symbol) where not archived and worker_hash is not null;
create table pmoffice_private.auto_trading_events(
 trading_id uuid not null references pmoffice_private.auto_trading_items(id),event_id text not null,
 revision bigint not null, received_ms bigint not null, data jsonb not null,primary key(trading_id,event_id)
);
create index auto_trading_events_page on pmoffice_private.auto_trading_events(trading_id,received_ms desc,event_id);
create table pmoffice_private.auto_trading_commands(
 id uuid primary key, trading_id uuid not null references pmoffice_private.auto_trading_items(id),
 action text not null check(action in('start','stop','close')), requested_by uuid not null,
 expected_position text,expected_entry text, state text not null default 'queued'
 check(state in('queued','executing','completed','failed','expired','uncertain','superseded')),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 seconds',
 claimed_at timestamptz,completed_at timestamptz,result jsonb
);
create table pmoffice_private.auto_trading_audit(
 id bigint generated always as identity primary key,trading_id uuid,actor_id uuid,action text not null,
 details jsonb not null default '{}',created_at timestamptz not null default now()
);
alter table pmoffice_private.auto_trading_items enable row level security;
alter table pmoffice_private.auto_trading_events enable row level security;
alter table pmoffice_private.auto_trading_commands enable row level security;
alter table pmoffice_private.auto_trading_audit enable row level security;
revoke all on pmoffice_private.auto_trading_items,pmoffice_private.auto_trading_events,pmoffice_private.auto_trading_commands,pmoffice_private.auto_trading_audit from public,anon,authenticated;

-- Re-evaluate the existing administrator policy as the recorded actor, then restore request context.
-- Not callable by browsers/workers; only the service-only worker RPC uses it.
create function pmoffice_private.auto_trading_actor_ok(actor uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare old_claims text:=current_setting('request.jwt.claims',true);old_sub text:=current_setting('request.jwt.claim.sub',true);email text;ok boolean;
begin
 select u.email into email from auth.users u where u.id=actor and u.email_confirmed_at is not null;
 if email is null then return false;end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'email',email,'role','authenticated')::text,true);
 ok:=coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(),false);
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 return ok;
exception when others then
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);raise;
end$$;
revoke all on function pmoffice_private.auto_trading_actor_ok(uuid) from public,anon,authenticated;

create function public.auto_trading_admin(p_action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare t pmoffice_private.auto_trading_items;c pmoffice_private.auto_trading_commands;actor uuid:=auth.uid();item_id uuid;result jsonb;pair text;ver bigint;
begin
 if not coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if p_action='list' then
 return coalesce((select jsonb_agg((to_jsonb(x)-'worker_hash'-'pair_hash'-'pair_expires') order by x.created_at) from pmoffice_private.auto_trading_items x where x.archived=coalesce((p->>'archived')::boolean,false)),'[]');end if;
 if p_action='save' and coalesce(p->>'id','')='' then
 insert into pmoffice_private.auto_trading_items(name,account_alias,symbol,timeframe) values(btrim(p->>'name'),btrim(p->>'account_alias'),p->>'symbol',p->>'timeframe') returning * into t;
 else
 item_id:=(p->>'id')::uuid;
 select * into t from pmoffice_private.auto_trading_items where id=item_id for update;
 if not found then raise no_data_found;end if;
 if p_action in('save','archive','restore','disconnect') and (p->>'version')::bigint is distinct from t.version then raise exception using errcode='40001',message='Trading item changed';end if;
 if p_action='get' then
 update pmoffice_private.auto_trading_commands set state='expired',completed_at=now() where trading_id=t.id and state='queued' and expires_at<=now();
 return jsonb_build_object('item',to_jsonb(t)-'worker_hash'-'pair_hash'-'pair_expires','commands',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from(select * from pmoffice_private.auto_trading_commands where trading_id=t.id order by created_at desc limit 50)x),'[]'),'audit',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from(select * from pmoffice_private.auto_trading_audit where trading_id=t.id order by id desc limit 50)x),'[]'));
 elsif p_action='events' then
 return jsonb_build_object('rows',coalesce((select jsonb_agg(x.data order by x.received_ms desc,x.event_id) from(select * from pmoffice_private.auto_trading_events where trading_id=t.id and received_ms>=coalesce((p->>'since')::bigint,0) order by received_ms desc,event_id limit 100 offset least(greatest(coalesce((p->>'offset')::integer,0),0),1000000))x),'[]'),'total',(select count(*) from pmoffice_private.auto_trading_events where trading_id=t.id and received_ms>=coalesce((p->>'since')::bigint,0)),'offset',greatest(coalesce((p->>'offset')::integer,0),0));
 elsif p_action='save' then
 update pmoffice_private.auto_trading_items set name=btrim(p->>'name'),version=version+1,updated_at=now() where id=t.id returning * into t;
 elsif p_action in('archive','restore','disconnect') then
 if p_action<>'restore' and t.worker_hash is not null and (t.last_seen is null or t.last_seen<now()-interval '15 seconds') then raise exception 'PC 연결을 복구하고 미보유 상태를 확인해 주세요.';end if;
 if p_action in('archive','disconnect') and (coalesce(t.snapshot->>'position','0')<>'0' or coalesce((t.snapshot->>'entries')::boolean,false)) then raise exception '먼저 신규 진입을 중지하고 미보유 상태를 확인해 주세요.';end if;
 update pmoffice_private.auto_trading_items set archived=case when p_action='archive' then true when p_action='restore' then false else archived end,worker_hash=case when p_action<>'restore' then null else worker_hash end,pair_hash=null,version=version+1,updated_at=now() where id=t.id returning * into t;
 update pmoffice_private.auto_trading_commands set state='superseded',completed_at=now() where trading_id=t.id and state='queued';
 elsif p_action='pair' then
 if t.archived then raise insufficient_privilege;end if;
 if t.worker_hash is not null then raise exception '기존 PC 연결을 먼저 해제해 주세요.';end if;
 pair:=encode(extensions.gen_random_bytes(20),'hex');
 update pmoffice_private.auto_trading_items set pair_hash=encode(extensions.digest(pair,'sha256'),'hex'),pair_expires=now()+interval '10 minutes',paired_by=actor where id=t.id;
 return jsonb_build_object('code',t.id::text||'.'||pair,'expires_at',now()+interval '10 minutes');
 elsif p_action='command' then
 if t.archived or t.worker_hash is null or t.last_seen is null or t.last_seen<now()-interval '15 seconds' then raise exception '거래 PC가 연결되지 않았습니다.';end if;
 if p->>'action' not in('start','stop','close') then raise invalid_parameter_value;end if;
 if p->>'action' in('stop','close') then update pmoffice_private.auto_trading_commands set state='superseded',completed_at=now() where trading_id=t.id and action='start' and state='queued';end if;
 insert into pmoffice_private.auto_trading_commands(id,trading_id,action,requested_by,expected_position,expected_entry) values((p->>'command_id')::uuid,t.id,p->>'action',actor,p->>'expected_position',p->>'expected_entry') on conflict(id) do nothing;
 select * into c from pmoffice_private.auto_trading_commands where id=(p->>'command_id')::uuid;
 if c.trading_id<>t.id or c.requested_by<>actor or c.action<>p->>'action' then raise insufficient_privilege;end if;
 insert into pmoffice_private.auto_trading_audit(trading_id,actor_id,action,details) values(t.id,actor,'command.'||c.action,jsonb_build_object('command_id',c.id));
 return to_jsonb(c);
 else raise invalid_parameter_value;end if;
 end if;
 insert into pmoffice_private.auto_trading_audit(trading_id,actor_id,action) values(t.id,actor,p_action);
 return to_jsonb(t)-'worker_hash'-'pair_hash'-'pair_expires';
end$$;
revoke all on function public.auto_trading_admin(text,jsonb) from public,anon;
grant execute on function public.auto_trading_admin(text,jsonb) to authenticated;

create function public.auto_trading_worker(p_action text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 return jsonb_build_object('server_time',now(),'commands',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from(select * from pmoffice_private.auto_trading_commands where trading_id=t.id and ((state='queued' and expires_at>now()) or state='executing') order by created_at limit 10)x),'[]'));
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
