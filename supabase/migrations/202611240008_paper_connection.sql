begin;
alter table pmoffice_private.paper_tradings add column webhook_issued_at timestamptz,add column connection_health jsonb not null default '{}';

create or replace function pmoffice_private.paper_safe(t pmoffice_private.paper_tradings) returns jsonb language sql immutable set search_path='' as $$select (to_jsonb(t)-'webhook_hash')||jsonb_build_object('webhook_issued',t.webhook_hash is not null)$$;

create function pmoffice_private.paper_connection(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'webhook_issued',t.webhook_hash is not null,'webhook_revision',t.webhook_revision,'webhook_issued_at',t.webhook_issued_at,
 'signal_count',(select count(*) from pmoffice_private.paper_events e where e.trading_id=t.id and e.source='tradingview' and e.config_version=t.config_version and e.received_at>=coalesce(t.webhook_issued_at,t.created_at)),
 'last_received_at',(select max(e.received_at) from pmoffice_private.paper_events e where e.trading_id=t.id and e.source='tradingview' and e.config_version=t.config_version and e.received_at>=coalesce(t.webhook_issued_at,t.created_at)),
 'last_signal',(select e.event from pmoffice_private.paper_events e where e.trading_id=t.id and e.source='tradingview' and e.config_version=t.config_version and e.received_at>=coalesce(t.webhook_issued_at,t.created_at) order by e.seq desc limit 1),
 'latest_state',(select e.state from pmoffice_private.paper_events e where e.trading_id=t.id and e.config_version=t.config_version order by e.seq desc limit 1),
 'last_error',(select jsonb_build_object('message',e.note,'at',e.completed_at) from pmoffice_private.paper_events e where e.trading_id=t.id and e.config_version=t.config_version and e.state='error' order by e.seq desc limit 1),
 'health',t.connection_health)
 from pmoffice_private.paper_tradings t where t.id=p_id
$$;
revoke all on function pmoffice_private.paper_connection(uuid) from public,anon,authenticated;

-- Keep the verified trading transitions intact; add metadata/connection behavior outside them.
alter function public.auto_trading_paper_admin(text,jsonb) rename to auto_trading_paper_admin_base;
revoke all on function public.auto_trading_paper_admin_base(text,jsonb) from public,anon,authenticated,service_role;
create function public.auto_trading_paper_admin(p_action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare t pmoffice_private.paper_tradings;r jsonb;
begin
 if not coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if p_action='webhook' then
  select * into t from pmoffice_private.paper_tradings where id=(p->>'id')::uuid for update;
  if not found or t.archived then raise no_data_found;end if;
  if t.qty<>0 or exists(select 1 from pmoffice_private.paper_events where trading_id=t.id and state in('queued','awaiting_exit')) then raise exception '미보유·처리 대기 없음 상태에서 주소를 발급해 주세요.';end if;
 end if;
 if p_action='save' then
  select * into t from pmoffice_private.paper_tradings where id=(p->>'id')::uuid for update;
  if not found or t.archived then raise no_data_found;end if;
  if (p->>'version')::bigint is distinct from t.config_version then raise exception using errcode='40001',message='설정이 변경됐습니다. 다시 확인해 주세요.';end if;
  if p->'entry_conditions'=t.entry_conditions and p->'exit_conditions'=t.exit_conditions and p->>'sizing_mode'=t.sizing_mode and (p->>'sizing_value')::numeric=t.sizing_value then
   update pmoffice_private.paper_tradings set name=btrim(p->>'name'),description=coalesce(p->>'description',''),updated_at=now() where id=t.id returning * into t;
   insert into pmoffice_private.paper_audit(trading_id,actor,action,details) values(t.id,auth.uid(),'metadata',jsonb_build_object('config_version',t.config_version));
   return pmoffice_private.paper_safe(t);
  end if;
 end if;
 r:=public.auto_trading_paper_admin_base(p_action,p);
 if p_action='get' then return r||jsonb_build_object('connection',pmoffice_private.paper_connection((p->>'id')::uuid));end if;
 if p_action='webhook' then
  update pmoffice_private.paper_tradings set webhook_issued_at=clock_timestamp(),updated_at=now() where id=(p->>'id')::uuid returning * into t;
  insert into pmoffice_private.paper_audit(trading_id,actor,action,details) values(t.id,auth.uid(),'webhook',jsonb_build_object('revision',t.webhook_revision,'config_version',t.config_version));
  return r||jsonb_build_object('item',pmoffice_private.paper_safe(t));
 elsif p_action='save' then
  update pmoffice_private.paper_tradings set webhook_issued_at=null where id=(p->>'id')::uuid returning * into t;
  return pmoffice_private.paper_safe(t);
 end if;
 return r;
end$$;
revoke all on function public.auto_trading_paper_admin(text,jsonb) from public,anon;
grant execute on function public.auto_trading_paper_admin(text,jsonb) to authenticated;

alter function public.auto_trading_paper_worker(text,jsonb) rename to auto_trading_paper_worker_base;
revoke all on function public.auto_trading_paper_worker_base(text,jsonb) from public,anon,authenticated,service_role;
create function public.auto_trading_paper_worker(p_action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
 if p_action='health' then
  if p->>'code' is null or p->>'code' not in('OK','DEMO_QUOTE_FAILED','PROCESSING_FAILED') then raise invalid_parameter_value;end if;
  update pmoffice_private.paper_tradings set connection_health=jsonb_build_object('code',p->>'code','checked_at',clock_timestamp(),'quote_at_ms',case when p->>'code'='OK' then (p->>'quote_at_ms')::bigint else null end)
  where id=(p->>'id')::uuid and not archived;
  if not found then raise no_data_found;end if;
  return '{}';
 end if;
 return public.auto_trading_paper_worker_base(p_action,p);
end$$;
revoke all on function public.auto_trading_paper_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.auto_trading_paper_worker(text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
