begin;
create table pmoffice_private.paper_tradings(
 id uuid primary key default gen_random_uuid(),name text not null check(length(btrim(name)) between 1 and 160),
 description text not null default '' check(length(description)<=200),entry_conditions jsonb not null default '[]',exit_conditions jsonb not null default '[]',
 symbol text not null default 'SOXLUSDT' check(symbol='SOXLUSDT'),timeframe text not null default '10S' check(timeframe='10S'),
 mode text not null default 'SERVER PAPER' check(mode='SERVER PAPER'),config_version bigint not null default 1,
 initial_cash numeric not null default 1000 check(initial_cash between 10 and 1000000),wallet numeric not null default 1000,
 sizing_mode text not null default 'fixed_notional' check(sizing_mode in('fixed_notional','available_percent')),
 sizing_value numeric not null default 10 check(sizing_value>0),leverage integer not null default 30 check(leverage=30),
 fee_rate numeric not null default 0.0004 check(fee_rate=0.0004),data_enabled boolean not null default false,auto_entries boolean not null default false,started_at_ms bigint not null default 0,authorized_by uuid,
 qty numeric not null default 0,entry_price numeric not null default 0,margin numeric not null default 0,
 entry_event text,entry_time_ms bigint not null default 0,entry_bar_ms bigint not null default 0,last_exit_bar_ms bigint not null default 0,
 quote jsonb,reason text not null default '실행 전',webhook_hash text,webhook_revision bigint not null default 1,
 archived boolean not null default false,created_by uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table pmoffice_private.paper_events(
 seq bigint generated always as identity primary key,trading_id uuid not null references pmoffice_private.paper_tradings(id),event_id text not null,
 event text not null check(event in('LONG_ENTRY','SHORT_ENTRY','LONG_EXIT','SHORT_EXIT')),source text not null check(source in('manual','tradingview')),
 actor uuid,config_version bigint not null,event_time_ms bigint not null,bar_open_ms bigint not null,received_at timestamptz not null default clock_timestamp(),
 state text not null default 'queued' check(state in('queued','awaiting_exit','ignored','expired','filled','error')),note text not null default '',
 payload jsonb not null default '{}',fill jsonb,completed_at timestamptz,unique(trading_id,event_id)
);
create index paper_events_pending on pmoffice_private.paper_events(trading_id,event_time_ms,seq) where state in('queued','awaiting_exit');
create table pmoffice_private.paper_audit(id bigint generated always as identity primary key,trading_id uuid,actor uuid,action text not null,details jsonb not null default '{}',created_at timestamptz not null default now());
alter table pmoffice_private.paper_tradings enable row level security;alter table pmoffice_private.paper_events enable row level security;alter table pmoffice_private.paper_audit enable row level security;
revoke all on pmoffice_private.paper_tradings,pmoffice_private.paper_events,pmoffice_private.paper_audit from public,anon,authenticated;

create function pmoffice_private.paper_safe(t pmoffice_private.paper_tradings) returns jsonb language sql immutable set search_path='' as $$select to_jsonb(t)-'webhook_hash'$$;
revoke all on function pmoffice_private.paper_safe(pmoffice_private.paper_tradings) from public,anon,authenticated;

create function public.auto_trading_paper_admin(p_action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare t pmoffice_private.paper_tradings;actor uuid:=auth.uid();secret text;evt text;eid text;tm bigint:=floor(extract(epoch from clock_timestamp())*1000);br bigint;result jsonb;
begin
 if not coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if p_action='list' then return coalesce((select jsonb_agg(pmoffice_private.paper_safe(x) order by x.created_at) from pmoffice_private.paper_tradings x where not x.archived),'[]');end if;
 if p_action='create' then
 if jsonb_typeof(coalesce(p->'entry_conditions','[]'))<>'array' or jsonb_typeof(coalesce(p->'exit_conditions','[]'))<>'array' then raise invalid_parameter_value;end if;
 insert into pmoffice_private.paper_tradings(name,description,entry_conditions,exit_conditions,initial_cash,wallet,created_by)
 values(btrim(p->>'name'),coalesce(p->>'description',''),coalesce(p->'entry_conditions','[]'),coalesce(p->'exit_conditions','[]'),coalesce((p->>'initial_cash')::numeric,1000),coalesce((p->>'initial_cash')::numeric,1000),actor) returning * into t;
 else
 select * into t from pmoffice_private.paper_tradings where id=(p->>'id')::uuid for update;
 if not found or t.archived then raise no_data_found;end if;
 if p_action='get' then return jsonb_build_object('item',pmoffice_private.paper_safe(t),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.seq desc) from(select * from pmoffice_private.paper_events where trading_id=t.id order by seq desc limit 60)e),'[]'));end if;
 if p_action='save' then
 if (p->>'version')::bigint is distinct from t.config_version then raise exception using errcode='40001',message='설정이 변경됐습니다. 다시 확인해 주세요.';end if;
 if t.auto_entries or t.qty<>0 or exists(select 1 from pmoffice_private.paper_events where trading_id=t.id and state in('queued','awaiting_exit')) then raise exception '진입을 중지하고 미보유 상태에서 설정을 변경해 주세요.';end if;
 if jsonb_typeof(p->'entry_conditions')<>'array' or jsonb_typeof(p->'exit_conditions')<>'array' then raise invalid_parameter_value;end if;
 if p->>'sizing_mode' not in('fixed_notional','available_percent') or coalesce((p->>'sizing_value')::numeric,0)<=0 or (p->>'sizing_value')::numeric>(case when p->>'sizing_mode'='available_percent' then 100 else 100000 end) then raise exception '투자금 범위를 확인해 주세요.';end if;
 update pmoffice_private.paper_tradings set name=btrim(p->>'name'),description=coalesce(p->>'description',''),entry_conditions=p->'entry_conditions',exit_conditions=p->'exit_conditions',sizing_mode=p->>'sizing_mode',sizing_value=(p->>'sizing_value')::numeric,config_version=config_version+1,webhook_revision=webhook_revision+1,webhook_hash=null,updated_at=now() where id=t.id returning * into t;
 elsif p_action in('start','stop') then
 if p_action='start' and t.webhook_hash is null then raise exception '전용 Webhook을 발급하고 TradingView 알림을 만든 뒤 진입을 시작해 주세요.';end if;
 update pmoffice_private.paper_tradings set data_enabled=data_enabled or p_action='start',auto_entries=p_action='start',started_at_ms=case when p_action='start' then tm else started_at_ms end,authorized_by=case when p_action='start' then actor else authorized_by end,reason=case when p_action='start' then '서버 자동 진입 허용 · 새 신호 대기' else '신규 자동 진입 중지 · 보유 청산 신호 유지' end,updated_at=now() where id=t.id returning * into t;
 if p_action='stop' then update pmoffice_private.paper_events set state='ignored',note='사용자 신규 진입 중지',completed_at=now() where trading_id=t.id and state in('queued','awaiting_exit') and event like '%ENTRY';end if;
 elsif p_action in('long','short','close') then
 eid:=(p->>'request_id')::uuid::text;
 if exists(select 1 from pmoffice_private.paper_events where trading_id=t.id and event_id=eid) then return jsonb_build_object('item',pmoffice_private.paper_safe(t),'request_id',eid);end if;
 if (p->>'expected_entry') is distinct from t.entry_event or (p->>'expected_qty')::numeric is distinct from t.qty then raise exception using errcode='40001',message='보유 상태가 바뀌었습니다. 다시 확인해 주세요.';end if;
 if p_action<>'close' and (t.qty<>0 or t.auto_entries) then raise exception '수동 진입은 자동 진입 중지 및 미보유 상태에서 실행해 주세요.';end if;
 if p_action='close' and t.qty=0 then raise exception '청산할 서버 모의 포지션이 없습니다.';end if;
 evt:=case p_action when 'long' then 'LONG_ENTRY' when 'short' then 'SHORT_ENTRY' else case when t.qty>0 then 'LONG_EXIT' else 'SHORT_EXIT' end end;
 if p_action='close' then update pmoffice_private.paper_tradings set auto_entries=false,reason='수동 청산 요청 · 신규 자동 진입 중지' where id=t.id returning * into t;end if;
 update pmoffice_private.paper_tradings set data_enabled=true where id=t.id returning * into t;
 br:=(tm/10000)*10000;
 insert into pmoffice_private.paper_events(trading_id,event_id,event,source,actor,config_version,event_time_ms,bar_open_ms,payload) values(t.id,eid,evt,'manual',actor,t.config_version,tm,br,jsonb_build_object('expected_entry',t.entry_event,'expected_qty',t.qty));
 elsif p_action='webhook' then
 if t.auto_entries then raise exception '자동 진입을 중지한 뒤 Webhook 주소를 발급해 주세요.';end if;
 secret:=encode(extensions.gen_random_bytes(32),'hex');
 update pmoffice_private.paper_tradings set webhook_hash=encode(extensions.digest(secret,'sha256'),'hex'),webhook_revision=webhook_revision+1 where id=t.id returning * into t;
 return jsonb_build_object('item',pmoffice_private.paper_safe(t),'secret',secret,'revision',t.webhook_revision);
 elsif p_action='archive' then
 if t.qty<>0 or t.auto_entries or exists(select 1 from pmoffice_private.paper_events where trading_id=t.id and state in('queued','awaiting_exit')) then raise exception '중지 및 미보유 상태에서 보관해 주세요.';end if;
 update pmoffice_private.paper_tradings set archived=true,webhook_hash=null,updated_at=now() where id=t.id returning * into t;
 else raise invalid_parameter_value;end if;
 end if;
 insert into pmoffice_private.paper_audit(trading_id,actor,action) values(t.id,actor,p_action);
 return pmoffice_private.paper_safe(t);
end$$;
revoke all on function public.auto_trading_paper_admin(text,jsonb) from public,anon;
grant execute on function public.auto_trading_paper_admin(text,jsonb) to authenticated;

create function public.auto_trading_paper_worker(p_action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare t pmoffice_private.paper_tradings;e pmoffice_private.paper_events;q jsonb;evt text;tm bigint:=floor(extract(epoch from clock_timestamp())*1000);v_state text:='filled';v_note text:='서버 모의 체결';px numeric;step numeric;minqty numeric;maxqty numeric;minnotional numeric;v_qty numeric;budget numeric;notional numeric;fee numeric;profit numeric;beforeqty numeric;v_fill jsonb;
begin
 if p_action='pending' then return coalesce((select jsonb_agg(x.id) from(select distinct trading_id id from pmoffice_private.paper_events where state in('queued','awaiting_exit') order by trading_id limit 100)x),'[]');end if;
 select * into t from pmoffice_private.paper_tradings where id=(p->>'id')::uuid for update;
 if not found or t.archived then raise insufficient_privilege;end if;
 if p_action='ingest' then
 if t.webhook_hash is null or t.webhook_hash is distinct from encode(extensions.digest(p->>'secret','sha256'),'hex') or (p->>'revision')::bigint is distinct from t.webhook_revision then raise insufficient_privilege;end if;
 q:=p->'signal';evt:=q->>'event';
 -- Edge validates exact legacy payload. Repeat essential identity and clock checks here.
 if q->>'symbol'<>'BINANCE:SOXLUSDT.P' or q->>'timeframe'<>'10S' or q->>'version'<>'0.11' or evt not in('LONG_ENTRY','SHORT_ENTRY','LONG_EXIT','SHORT_EXIT') or (q->>'event_time_ms')::bigint>tm+2000 then raise invalid_parameter_value;end if;
 select * into e from pmoffice_private.paper_events where trading_id=t.id and event_id=q->>'event_id';
 if found then if e.payload<>q then raise exception '중복 ID 내용 불일치';end if;return jsonb_build_object('accepted',true,'event_id',e.event_id,'state',e.state);end if;
 v_state:='queued';v_note:='수신 저장';
 if evt like '%ENTRY' and (not t.auto_entries or (q->>'event_time_ms')::bigint<t.started_at_ms) then v_state:='ignored';v_note:='신규 자동 진입 중지 또는 시작 이전 신호';end if;
 if evt like '%EXIT' and t.qty=0 and not t.auto_entries then v_state:='ignored';v_note:='중지·미보유 상태';end if;
 if (select count(*) from pmoffice_private.paper_events where trading_id=t.id and received_at>now()-interval '1 minute')>120 then raise exception '수신 빈도 초과';end if;
 insert into pmoffice_private.paper_events(trading_id,event_id,event,source,config_version,event_time_ms,bar_open_ms,payload,state,note)
 values(t.id,q->>'event_id',evt,'tradingview',t.config_version,(q->>'event_time_ms')::bigint,(q->>'bar_open_ms')::bigint,q,v_state,v_note) on conflict(trading_id,event_id) do nothing;
 select * into e from pmoffice_private.paper_events where trading_id=t.id and event_id=q->>'event_id';
 if e.payload<>q then raise exception '중복 ID 내용 불일치';end if;
 return jsonb_build_object('accepted',true,'event_id',e.event_id,'state',e.state);
 elsif p_action='next' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.event_time_ms,x.seq) from(select * from pmoffice_private.paper_events where trading_id=t.id and state in('queued','awaiting_exit') order by event_time_ms,seq limit 30)x),'[]');
 elsif p_action='quote' then
 update pmoffice_private.paper_tradings set quote=p->'quote' where id=t.id;return '{}';
 elsif p_action='apply' then
 select * into e from pmoffice_private.paper_events where trading_id=t.id and seq=(p->>'seq')::bigint for update;
 if not found or e.state not in('queued','awaiting_exit') then return jsonb_build_object('state','already_processed');end if;
 evt:=e.event;beforeqty:=t.qty;
 if not pmoffice_private.auto_trading_actor_ok(case when e.source='manual' then e.actor else t.authorized_by end) then v_state:='ignored';v_note:='관리자 실행 권한 회수';
 elsif e.config_version<>t.config_version then v_state:='ignored';v_note:='설정 버전 불일치';
 elsif e.source='tradingview' and evt like '%ENTRY' and (not t.auto_entries or e.event_time_ms<t.started_at_ms) then v_state:='ignored';v_note:='신규 자동 진입 중지 또는 시작 이전 신호';
 elsif evt like '%ENTRY' and tm-e.event_time_ms>10000 then v_state:='expired';v_note:='진입 유효시간 10초 초과';
 elsif e.source='manual' and (coalesce(e.payload->>'expected_entry','')<>coalesce(t.entry_event,'') or (e.payload->>'expected_qty')::numeric<>t.qty) then v_state:='ignored';v_note:='수동 요청 후 보유 상태 변경';
 elsif evt like '%ENTRY' and t.qty<>0 then
 if e.source='tradingview' and ((evt='LONG_ENTRY' and t.qty<0) or (evt='SHORT_ENTRY' and t.qty>0)) and e.bar_open_ms>t.entry_bar_ms then v_state:='awaiting_exit';v_note:='기존 포지션의 앞선 청산 신호 대기';else v_state:='ignored';v_note:='보유 중복 또는 같은 봉 반전 차단';end if;
 elsif evt like '%ENTRY' and e.source='tradingview' and e.bar_open_ms<=t.last_exit_bar_ms then v_state:='ignored';v_note:='청산 이전 또는 같은 봉 진입 차단';
 elsif evt like '%EXIT' and t.qty=0 then
 v_state:='ignored';v_note:='청산할 서버 모의 보유 없음';
 if e.source='tradingview' and e.bar_open_ms>t.last_exit_bar_ms then update pmoffice_private.paper_tradings set auto_entries=false,reason='미보유 청산 수신 · 차트/설정 확인 후 진입 시작 필요' where id=t.id;end if;
 elsif evt like '%EXIT' and ((evt='LONG_EXIT' and t.qty<0) or (evt='SHORT_EXIT' and t.qty>0) or e.event_time_ms<t.entry_time_ms or e.bar_open_ms<t.entry_bar_ms) then v_state:='ignored';v_note:='보유 방향 또는 진입 이전 청산 차단';
 end if;
 if v_state='filled' then
 q:=p->'quote';px:=(q->>'price')::numeric;step:=(q->>'step')::numeric;minqty:=(q->>'min_qty')::numeric;maxqty:=(q->>'max_qty')::numeric;minnotional:=(q->>'min_notional')::numeric;
 if px<=0 or step<=0 or minqty<=0 or maxqty<minqty or minnotional<=0 or abs(tm-(q->>'at_ms')::bigint)>5000 or q->>'symbol'<>t.symbol then raise exception '검증 가능한 최신 Demo 시세 없음';end if;
 if evt like '%ENTRY' then
 if t.sizing_mode='fixed_notional' then notional:=t.sizing_value;else budget:=greatest(0,t.wallet)*t.sizing_value/100;notional:=budget/(1.0/t.leverage+t.fee_rate);end if;
 v_qty:=floor(notional/px/step)*step;fee:=v_qty*px*t.fee_rate;
 if v_qty<minqty or v_qty>maxqty or v_qty*px<minnotional or v_qty*px/t.leverage+fee>t.wallet or notional>100000 then v_state:='error';v_note:='모의 잔고·최소금액·수량 단위 한도 미달';
 else
 v_qty:=case when evt='LONG_ENTRY' then v_qty else -v_qty end;
 update pmoffice_private.paper_tradings set qty=v_qty,entry_price=px,margin=abs(v_qty)*px/t.leverage,wallet=wallet-fee,entry_event=e.event_id,entry_time_ms=e.event_time_ms,entry_bar_ms=e.bar_open_ms,quote=q,reason='서버 모의 보유 중',updated_at=now() where id=t.id;
 v_fill:=jsonb_build_object('mode','SERVER PAPER','paper_order_id','paper-'||e.seq,'qty',v_qty,'price',px,'fee',fee,'realized_pnl',0,'before_qty',beforeqty,'after_qty',v_qty,'quote_at_ms',q->'at_ms');
 end if;
 else
 v_qty:=abs(t.qty);fee:=v_qty*px*t.fee_rate;profit:=t.qty*(px-t.entry_price);
 update pmoffice_private.paper_tradings set qty=0,entry_price=0,margin=0,wallet=wallet+profit-fee,entry_event=null,last_exit_bar_ms=greatest(last_exit_bar_ms,e.bar_open_ms),quote=q,reason='서버 모의 청산 완료',updated_at=now() where id=t.id;
 v_fill:=jsonb_build_object('mode','SERVER PAPER','paper_order_id','paper-'||e.seq,'qty',v_qty,'price',px,'fee',fee,'realized_pnl',profit,'before_qty',beforeqty,'after_qty',0,'quote_at_ms',q->'at_ms');
 end if;
 end if;
 update pmoffice_private.paper_events set state=v_state,note=v_note,fill=v_fill,completed_at=case when v_state='awaiting_exit' then null else clock_timestamp() end where seq=e.seq;
 return jsonb_build_object('state',v_state,'event_id',e.event_id,'fill',v_fill);
 else raise invalid_parameter_value;end if;
end$$;
revoke all on function public.auto_trading_paper_worker(text,jsonb) from public,anon,authenticated;
grant execute on function public.auto_trading_paper_worker(text,jsonb) to service_role;
commit;
