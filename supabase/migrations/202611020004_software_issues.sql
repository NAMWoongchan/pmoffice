begin;
create table pmoffice_private.software_issues(id uuid primary key default gen_random_uuid(),issued_at timestamptz,work_name text not null default '',target text not null default '',software_name text not null default '',admin_id text not null default '',expires_at timestamptz,quantity numeric(14,3) not null default 0 check(quantity>=0),unit_price numeric(16,2) not null default 0 check(unit_price>=0),memo text not null default '',version bigint not null default 1,updated_at timestamptz not null default now(),updated_source text not null default 'web');
create table pmoffice_private.software_conflicts(id bigint generated always as identity primary key,record_id uuid not null references pmoffice_private.software_issues(id),incoming jsonb not null,resolved boolean not null default false,created_at timestamptz not null default now());
create unique index software_one_conflict on pmoffice_private.software_conflicts(record_id) where not resolved;
create table pmoffice_private.software_sync_nonces(nonce text primary key,created_at timestamptz not null default now());
create table pmoffice_private.software_sync_state(singleton boolean primary key default true,last_sync_at timestamptz,last_error text);
insert into pmoffice_private.software_sync_state(singleton) values(true);
alter table pmoffice_private.software_issues enable row level security;
alter table pmoffice_private.software_conflicts enable row level security;
alter table pmoffice_private.software_sync_nonces enable row level security;
alter table pmoffice_private.software_sync_state enable row level security;
revoke all on pmoffice_private.software_issues,pmoffice_private.software_conflicts,pmoffice_private.software_sync_nonces,pmoffice_private.software_sync_state from public,anon,authenticated;
create function pmoffice_private.software_row(r pmoffice_private.software_issues) returns jsonb language sql stable set search_path='' as $$
select to_jsonb(r)||jsonb_build_object('remaining_days',case when r.expires_at is null then null else (r.expires_at at time zone 'Asia/Seoul')::date-(now() at time zone 'Asia/Seoul')::date end,'total',round(r.quantity*r.unit_price,2),'conflict',exists(select 1 from pmoffice_private.software_conflicts c where c.record_id=r.id and not c.resolved))
$$;
create function public.software_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform pmoffice_private.require_admin();return jsonb_build_object('rows',coalesce((select jsonb_agg(pmoffice_private.software_row(r) order by r.issued_at desc nulls last,r.id) from pmoffice_private.software_issues r),'[]'),'sync',(select to_jsonb(s) from pmoffice_private.software_sync_state s),'conflicts',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from pmoffice_private.software_conflicts c where not c.resolved),'[]'));end$$;
create function pmoffice_private.software_write(p jsonb,origin text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r pmoffice_private.software_issues;previous jsonb;rid uuid:=nullif(p->>'id','')::uuid;begin
 if jsonb_typeof(p)<>'object' or origin not in('web','sheet') or octet_length(p::text)>20000 then raise exception '발급 행 형식을 확인해 주세요.';end if;
 if length(coalesce(p->>'work_name',''))>1000 or length(coalesce(p->>'target',''))>500 or length(coalesce(p->>'software_name',''))>500 or length(coalesce(p->>'admin_id',''))>500 or length(coalesce(p->>'memo',''))>5000 then raise exception '입력 길이를 확인해 주세요.';end if;
 if rid is not null then
  select * into r from pmoffice_private.software_issues where id=rid for update;if not found then raise exception '발급 행이 없습니다.';end if;
  if p->>'version' is null or (p->>'version')::bigint<>r.version then raise exception '다른 곳에서 수정되었습니다. 최신 행을 확인해 주세요.' using errcode='40001';end if;
  previous:=to_jsonb(r);
 else insert into pmoffice_private.software_issues default values returning * into r;rid:=r.id;end if;
 update pmoffice_private.software_issues set issued_at=nullif(p->>'issued_at','')::timestamptz,work_name=coalesce(p->>'work_name',''),target=coalesce(p->>'target',''),software_name=coalesce(p->>'software_name',''),admin_id=coalesce(p->>'admin_id',''),expires_at=nullif(p->>'expires_at','')::timestamptz,quantity=coalesce(nullif(p->>'quantity','')::numeric,0),unit_price=coalesce(nullif(p->>'unit_price','')::numeric,0),memo=coalesce(p->>'memo',''),version=case when previous is null then 1 else version+1 end,updated_at=clock_timestamp(),updated_source=origin where id=rid returning * into r;
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'software.saved',rid::text,jsonb_build_object('source',origin,'before',previous,'after',to_jsonb(r)));
 return pmoffice_private.software_row(r);
end$$;
create function public.software_save(p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb;out jsonb:='[]';begin
 perform pmoffice_private.require_admin();
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception '저장할 행을 확인해 주세요.';end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  if exists(select 1 from pmoffice_private.software_conflicts where record_id=nullif(item->>'id','')::uuid and not resolved) then raise exception '시트 충돌을 먼저 해결해 주세요.' using errcode='40001';end if;
  out:=out||jsonb_build_array(pmoffice_private.software_write(item,'web'));
 end loop;return out;
end$$;
create function public.software_resolve(p_conflict bigint,p_choice text,p_version bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare c pmoffice_private.software_conflicts;r pmoffice_private.software_issues;begin
 perform pmoffice_private.require_admin();select * into strict c from pmoffice_private.software_conflicts where id=p_conflict and not resolved for update;
 select * into strict r from pmoffice_private.software_issues where id=c.record_id for update;
 if r.version<>p_version or p_choice not in('web','sheet') then raise exception '최신 충돌 행을 다시 확인해 주세요.' using errcode='40001';end if;
 if p_choice='sheet' then perform pmoffice_private.software_write(c.incoming||jsonb_build_object('id',r.id,'version',r.version),'sheet');else update pmoffice_private.software_issues set version=version+1,updated_at=clock_timestamp() where id=r.id;end if;
 update pmoffice_private.software_conflicts set resolved=true where id=c.id;
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'software.conflict_resolved',r.id::text,jsonb_build_object('choice',p_choice,'conflict',c.id));return public.software_list();
end$$;
create function public.software_sheet_bridge(p_message text,p_signature text) returns jsonb language plpgsql security definer set search_path='' as $$
declare secret text;message jsonb;item jsonb;r pmoffice_private.software_issues;out jsonb:='[]';saved jsonb;begin
 select bridge_secret into secret from pmoffice_private.inquiry_settings where singleton;
 if secret is null or length(p_message)>2000000 or p_signature is null or p_signature<>encode(extensions.hmac(convert_to(p_message,'UTF8'),convert_to(secret,'UTF8'),'sha256'),'hex') then raise insufficient_privilege;end if;
 message:=p_message::jsonb;
 if message->>'ts' is null or message->>'nonce' is null or abs(extract(epoch from clock_timestamp())-(message->>'ts')::numeric)>300 or length(message->>'nonce') not between 20 and 100 then raise insufficient_privilege;end if;
 insert into pmoffice_private.software_sync_nonces(nonce) values(message->>'nonce');delete from pmoffice_private.software_sync_nonces where created_at<now()-interval '1 day';
 if message->>'action'='sync' then
  if jsonb_typeof(message->'rows')<>'array' or jsonb_array_length(message->'rows')>5000 then raise exception '동기화 행 수를 확인해 주세요.';end if;
  for item in select value from jsonb_array_elements(message->'rows') loop
   if nullif(item->>'id','') is not null then
    select * into r from pmoffice_private.software_issues where id=(item->>'id')::uuid for update;
    if not found then raise exception '알 수 없는 시트 행입니다.';end if;
    if exists(select 1 from pmoffice_private.software_conflicts where record_id=r.id and not resolved) then
     if coalesce((item->>'changed')::boolean,false) then update pmoffice_private.software_conflicts set incoming=item where record_id=r.id and not resolved;end if;
     continue;
    end if;
    if coalesce((item->>'changed')::boolean,false) then
     if (item->>'version')::bigint=r.version then saved:=pmoffice_private.software_write(item,'sheet');
     else insert into pmoffice_private.software_conflicts(record_id,incoming) values(r.id,item) on conflict(record_id) where not resolved do update set incoming=excluded.incoming;end if;
    end if;
   else saved:=pmoffice_private.software_write(item,'sheet');out:=out||jsonb_build_array(jsonb_build_object('row',item->'row','id',saved->'id'));end if;
  end loop;
  update pmoffice_private.software_sync_state set last_sync_at=clock_timestamp(),last_error=null where singleton;
  return jsonb_build_object('created',out,'rows',coalesce((select jsonb_agg(pmoffice_private.software_row(x) order by x.issued_at desc nulls last,x.id) from pmoffice_private.software_issues x),'[]'));
 elsif message->>'action'='error' then update pmoffice_private.software_sync_state set last_error=left(coalesce(message->>'error','동기화 확인 필요'),500) where singleton;return '{"ok":true}';end if;
 raise exception '지원하지 않는 동기화 요청';
end$$;
revoke all on function pmoffice_private.software_row(pmoffice_private.software_issues),pmoffice_private.software_write(jsonb,text) from public,anon,authenticated;
revoke all on function public.software_list(),public.software_save(jsonb),public.software_resolve(bigint,text,bigint) from public,anon;
grant execute on function public.software_list(),public.software_save(jsonb),public.software_resolve(bigint,text,bigint) to authenticated;
revoke all on function public.software_sheet_bridge(text,text) from public;
grant execute on function public.software_sheet_bridge(text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
