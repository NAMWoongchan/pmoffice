begin;
alter table pmoffice_private.auto_trading_items add column if not exists entry_conditions text[] not null default '{}', add column if not exists exit_conditions text[] not null default '{}', add column if not exists conditions_source text, add column if not exists description text not null default '' check(char_length(description)<=200);
create or replace function public.auto_trading_admin(p_action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare t pmoffice_private.auto_trading_items;c pmoffice_private.auto_trading_commands;actor uuid:=auth.uid();item_id uuid;result jsonb;pair text;ver bigint;
begin
 if not coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if p_action='save' and p?'description' and (jsonb_typeof(p->'description') is distinct from 'string' or char_length(p->>'description')>200) then raise exception using errcode='22023',message='설명은 200자 이내로 입력해 주세요.';end if;
 if p_action='list' then
 return coalesce((select jsonb_agg((to_jsonb(x)-'worker_hash'-'pair_hash'-'pair_expires') order by x.created_at) from pmoffice_private.auto_trading_items x where x.archived=coalesce((p->>'archived')::boolean,false)),'[]');end if;
 if p_action='save' and coalesce(p->>'id','')='' then
 insert into pmoffice_private.auto_trading_items(name,account_alias,symbol,timeframe,description) values(btrim(p->>'name'),btrim(p->>'account_alias'),p->>'symbol',p->>'timeframe',coalesce(p->>'description','')) returning * into t;
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
 update pmoffice_private.auto_trading_items set name=btrim(p->>'name'),description=case when p?'description' then p->>'description' else description end,version=version+1,updated_at=now() where id=t.id returning * into t;
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


commit;
