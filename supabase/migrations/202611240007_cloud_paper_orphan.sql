begin;
create or replace function public.auto_trading_paper_worker(p_action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
 if e.source='tradingview' then update pmoffice_private.paper_tradings set last_exit_bar_ms=greatest(last_exit_bar_ms,e.bar_open_ms),reason='미보유 청산 건너뜀 · 다음 새 진입 신호 대기' where id=t.id;end if;
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
commit;
