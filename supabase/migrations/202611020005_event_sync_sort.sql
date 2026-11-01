begin;
create or replace function pmoffice_private.validate_service_codes(codes text[],require_base boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare k text;begin
 if codes is null or cardinality(codes)>15 or cardinality(codes)<>(select count(distinct x) from unnest(codes)x) or exists(select 1 from unnest(codes)c where not exists(select 1 from jsonb_array_elements(public.member_service_catalog())x where x->>'id'=c)) then raise exception '서비스 종류를 확인해 주세요.';end if;
 foreach k in array array['base','ai','msp','pm'] loop
  if (select count(*) from jsonb_array_elements(public.member_service_catalog())x where x->>'kind'=k and x->>'id'=any(codes))>1 then raise exception '같은 분야에서는 하나의 등급만 선택해 주세요.';end if;
 end loop;
 if require_base and cardinality(codes)=0 then raise exception '서비스 종류를 선택해 주세요.';end if;
 if 'seedling'=any(codes) and cardinality(codes)>1 then raise exception '새싹멤버는 다른 서비스 등급과 함께 선택할 수 없습니다.';end if;
end$$;
create or replace function pmoffice_private.member_service_codes(u uuid) returns text[] language sql stable security definer set search_path='' as $$
select case when exists(select 1 from public.unified_regular_memberships r where r.user_id=u and r.status='active' and r.starts_at<=now() and (r.expires_at is null or r.expires_at>now())) then array['regular'] when exists(select 1 from public.user_memberships m where m.user_id=u and m.status='active' and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now())) or coalesce((select service_partner from public.profiles where id=u),false) then '{}'::text[] else array['seedling'] end
||coalesce((select array_agg(m.membership_id||':'||m.tier_id order by m.membership_id) from public.user_memberships m where m.user_id=u and m.status='active' and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now())),'{}')
||case when (select service_partner from public.profiles where id=u) then array['partner'] else '{}' end
$$;
create or replace function public.member_admin_bulk(p_request uuid,p_users uuid[],p_action text,p_reason text,p_codes text[] default '{}',p_versions jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid;pr public.profiles;service_kind text;code text;tier text;previous jsonb;result jsonb:='[]';r public.user_memberships;cached pmoffice_private.member_bulk_requests;begin
 perform pmoffice_private.require_admin();
 if p_request is null or p_action not in('grade','suspend','resume','withdraw') or length(coalesce(trim(p_reason),''))>2000 or (p_action<>'grade' and length(coalesce(trim(p_reason),''))=0) or p_users is null or cardinality(p_users) not between 1 and 100 or cardinality(p_users)<>(select count(distinct x) from unnest(p_users)x) then raise exception '대상·조치·변경 사유를 확인해 주세요.';end if;
 p_reason:=coalesce(nullif(trim(p_reason),''),'사유 미입력');
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into cached from pmoffice_private.member_bulk_requests where id=p_request;
 if cached.id is not null then if cached.actor_id<>auth.uid() then raise insufficient_privilege;end if;return cached.result;end if;
 if p_action='grade' then perform pmoffice_private.validate_service_codes(p_codes);end if;
 for u in select id from public.profiles where id=any(p_users) order by id for update loop
  select * into strict pr from public.profiles where id=u;
  if u=auth.uid() or exists(select 1 from public.admin_roles where user_id=u) then raise exception '시스템 관리자 계정은 일괄 조치 대상에서 제외해 주세요.';end if;
  if not(p_versions ? u::text) or (p_versions->>u::text)::bigint<>pr.services_revision then raise exception '회원 상태가 변경되었습니다. 목록을 새로고침해 주세요.' using errcode='40001';end if;
  previous:=jsonb_build_object('services',pmoffice_private.member_service_codes(u),'status',pr.status,'withdrawn_at',pr.withdrawn_at);
  if p_action='grade' then
   if pr.withdrawn_at is not null or pr.status<>'active' then raise exception '정상 활동 중인 회원만 등급을 변경할 수 있습니다.';end if;
   if not exists(select 1 from pmoffice_private.service_settings ss where ss.singleton and (
    (pr.registration_source='legacy' and pr.signup_accepted_at is not null and pr.signup_version=ss.signup_version)
    or (pr.registration_source in('self','google') and pr.registered_at is not null and pr.signup_accepted_at is not null and pr.signup_version=ss.member_signup_version)
    or (pr.registration_source='admin' and pr.registered_at is not null and pr.registered_by is not null and pr.registration_version=ss.member_signup_version))) then raise exception '가입 확인이 완료된 회원만 등급을 변경할 수 있습니다.';end if;
   if 'regular'=any(p_codes) then
    if not exists(select 1 from public.unified_regular_memberships where user_id=u and status='active' and (expires_at is null or expires_at>now())) then perform public.admin_set_unified_regular(u,'active',null,p_reason);end if;
   else update public.unified_regular_memberships set status='revoked',reason=p_reason,granted_by=auth.uid(),updated_at=now() where user_id=u;end if;
   foreach service_kind in array array['ai','msp','pm'] loop
    code:=null;select c into code from unnest(p_codes)c where split_part(c,':',1)=service_kind limit 1;
    select * into r from public.user_memberships where user_id=u and membership_id=service_kind;
    if code is not null then
     tier:=split_part(code,':',2);
     if r.user_id is null or r.tier_id<>tier or r.status<>'active' or r.expires_at<=now() then
      insert into public.user_memberships(user_id,membership_id,tier_id,status,starts_at,expires_at,granted_by,reason)
      values(u,service_kind,tier,'active',case when r.status='active' and (r.expires_at is null or r.expires_at>now()) then r.starts_at else now() end,case when r.status='active' and r.expires_at>now() then r.expires_at else null end,auth.uid(),trim(p_reason))
      on conflict(user_id,membership_id) do update set tier_id=excluded.tier_id,status='active',starts_at=excluded.starts_at,expires_at=excluded.expires_at,granted_by=auth.uid(),reason=excluded.reason,updated_at=now();
     end if;
     if service_kind in('ai','msp') and not exists(select 1 from pmoffice_private.education_services es where es.user_id=u and es.kind=service_kind and es.enabled) and (r.user_id is null or r.starts_at<=now()) then perform public.member_admin_set_education(u,service_kind,true);end if;
    elsif r.user_id is not null and r.tier_id<>'prestige' then
     update public.user_memberships set status='revoked',reason=p_reason,granted_by=auth.uid(),updated_at=now() where user_id=u and membership_id=service_kind;
     if service_kind in('ai','msp') then perform public.member_admin_set_education(u,service_kind,false);end if;
    end if;
   end loop;
   update public.profiles set service_base=case when 'regular'=any(p_codes) then 'regular' else 'seedling' end,service_partner='partner'=any(p_codes) where id=u;
  elsif p_action='suspend' then
   if pr.withdrawn_at is not null then raise exception '이미 탈퇴한 회원입니다.';end if;
   update public.profiles set status='suspended' where id=u;
  elsif p_action='resume' then
   if pr.withdrawn_at is not null then raise exception '강제 탈퇴 회원은 활동 재개할 수 없습니다.';end if;
   update public.profiles set status='active' where id=u;
  else perform public.member_admin_withdraw(u);
  end if;
  update public.profiles set services_revision=services_revision+1 where id=u;
  insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'member.bulk_'||p_action,u::text,jsonb_build_object('request',p_request,'reason',trim(p_reason),'before',previous,'after',jsonb_build_object('services',pmoffice_private.member_service_codes(u),'status',(select status from public.profiles where id=u),'withdrawn_at',(select withdrawn_at from public.profiles where id=u))));
  result:=result||jsonb_build_array(jsonb_build_object('user_id',u,'action',p_action,'ok',true));
 end loop;
 if jsonb_array_length(result)<>cardinality(p_users) then raise exception '대상 회원을 다시 확인해 주세요.';end if;
 insert into pmoffice_private.member_bulk_requests(id,actor_id,result) values(p_request,auth.uid(),result);return result;
end$$;
-- Membership is assigned only by administrators. A course click must not create a regular grant.

create function public.member_admin_list_sorted(p_search text default '',p_offset integer default 0,p_sort text default 'registered_at',p_direction text default 'desc') returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare expression text;statement text;result jsonb;begin
 perform pmoffice_private.require_admin();
 if p_direction not in('asc','desc') or p_offset<0 or length(p_search)>200 then raise exception '정렬 조건을 확인해 주세요.';end if;
 expression:=case p_sort when 'registered_at' then 'coalesce(x.registered_at,x.created_at)' when 'display_name' then 'x.display_name' when 'email' then 'x.email' when 'company' then 'x.company' when 'position' then 'x.position' when 'member_kind' then 'x.member_kind' when 'groups' then 'x.groups::text' when 'status' then 'case when x.withdrawn_at is not null then ''탈퇴'' when x.status=''active'' then ''이용 중'' else ''중지'' end' when 'last_sign_in_at' then 'x.last_sign_in_at' when 'login_status' then 'x.login_status' else null end;
 if expression is null then raise exception '정렬 열을 확인해 주세요.';end if;
 statement:=format($q$select coalesce(jsonb_agg(to_jsonb(r)-'__row' order by r.__row),'[]') from (select x.*,row_number()over(order by %s %s nulls last,x.id) __row from (select p.*,u.email,u.last_sign_in_at,exists(select 1 from public.admin_roles ar where ar.user_id=p.id) as system_admin,
 case when p.status<>'active' or p.withdrawn_at is not null or u.banned_until>statement_timestamp() then 'blocked'
 when exists(select 1 from auth.sessions s where s.user_id=p.id and (s.not_after is null or s.not_after>statement_timestamp())) then 'signed_in'
 else 'signed_out' end as login_status,
 coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'active',g.active and m.active and (m.expires_at is null or m.expires_at>statement_timestamp())) order by g.name,g.id)
 from public.pms_groups g join public.pms_group_members m on m.group_id=g.id where m.user_id=p.id),'[]') as groups
 from public.profiles p join auth.users u on u.id=p.id
 where length($1)<=200 and ($1='' or u.email ilike '%%'||$1||'%%' or p.display_name ilike '%%'||$1||'%%' or p.company ilike '%%'||$1||'%%')) x order by %s %s nulls last,x.id offset $2 limit 101)r$q$,expression,p_direction,expression,p_direction);
 execute statement into result using p_search,p_offset;return result;
end$fn$;
revoke all on function public.member_admin_list_sorted(text,integer,text,text) from public,anon;
grant execute on function public.member_admin_list_sorted(text,integer,text,text) to authenticated;

-- Shared change signals contain no business data. Only verified admins can subscribe.
create table public.admin_change_signals(scope text primary key,revision bigint not null default 0,updated_at timestamptz not null default now());
alter table public.admin_change_signals enable row level security;
revoke all on public.admin_change_signals from public,anon,authenticated;
grant select on public.admin_change_signals to authenticated;
create policy verified_admin_signal on public.admin_change_signals for select to authenticated using(pmoffice_private.is_admin());
insert into public.admin_change_signals(scope) values('inquiry'),('software'),('members'),('projects'),('ebooks');
alter publication supabase_realtime add table public.admin_change_signals;
create function pmoffice_private.change_signal() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='UPDATE' and new is not distinct from old then return new;end if;
 insert into public.admin_change_signals(scope,revision) values(tg_argv[0],1) on conflict(scope)do update set revision=public.admin_change_signals.revision+1,updated_at=clock_timestamp();
 return coalesce(new,old);end$$;
create function pmoffice_private.event_wake(scope text) returns void language plpgsql security definer set search_path='' as $$
declare c pmoffice_private.inquiry_settings;m text;k text:='pmo.wake_'||scope;begin
 if scope not in('inquiry','software') then raise exception 'Unknown event scope';end if;
 if current_setting(k,true)=txid_current()::text then return;end if;
 perform set_config(k,txid_current()::text,true);
 select * into c from pmoffice_private.inquiry_settings where singleton;if c.bridge_url is null or c.bridge_secret is null then return;end if;
 m:=jsonb_build_object('action','wake','scope',scope,'ts',extract(epoch from clock_timestamp())::bigint,'nonce',gen_random_uuid())::text;
 perform net.http_post(url:=c.bridge_url,body:=jsonb_build_object('message',m,'signature',encode(extensions.hmac(convert_to(m,'UTF8'),convert_to(c.bridge_secret,'UTF8'),'sha256'),'hex')),timeout_milliseconds:=30000);
end$$;
create or replace function pmoffice_private.inquiry_wake() returns void language plpgsql security definer set search_path='' as $$begin perform pmoffice_private.event_wake('inquiry');end$$;
create function pmoffice_private.software_event_wake() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_table_name='software_conflicts' then
  if new.resolved and not old.resolved then perform pmoffice_private.event_wake('software');end if;
 elsif new.updated_source='web' and (tg_op='INSERT' or new is distinct from old) then perform pmoffice_private.event_wake('software');end if;
 return new;end$$;
create trigger software_web_event after update on pmoffice_private.software_issues for each row execute function pmoffice_private.software_event_wake();
create trigger software_resolved_event after update on pmoffice_private.software_conflicts for each row execute function pmoffice_private.software_event_wake();
create function pmoffice_private.mail_event_wake() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='INSERT' then perform pmoffice_private.inquiry_wake();end if;return new;end$$;
create trigger pmo_change_signal after insert or update or delete on public.customer_inquiries for each row execute function pmoffice_private.change_signal('inquiry');
create trigger pmo_change_signal after insert or update or delete on pmoffice_private.software_issues for each row execute function pmoffice_private.change_signal('software');
create trigger pmo_change_signal after insert or update or delete on pmoffice_private.software_conflicts for each row execute function pmoffice_private.change_signal('software');
create trigger pmo_change_signal after insert or update or delete on pmoffice_private.software_sync_state for each row execute function pmoffice_private.change_signal('software');
create trigger pmo_change_signal after insert or update or delete on public.profiles for each row execute function pmoffice_private.change_signal('members');
create trigger pmo_change_signal after insert or update or delete on public.user_memberships for each row execute function pmoffice_private.change_signal('members');
create trigger pmo_change_signal after insert or update or delete on public.unified_regular_memberships for each row execute function pmoffice_private.change_signal('members');
create trigger pmo_change_signal after insert or update or delete on public.pms_group_members for each row execute function pmoffice_private.change_signal('members');
create trigger pmo_change_signal after insert or update or delete on public.pms_projects for each row execute function pmoffice_private.change_signal('projects');
create trigger pmo_change_signal after insert or update or delete on pmoffice_private.ebook_books for each row execute function pmoffice_private.change_signal('ebooks');
create trigger member_mail_event after insert on public.member_mail_jobs for each row execute function pmoffice_private.mail_event_wake();
revoke all on function pmoffice_private.event_wake(text),pmoffice_private.change_signal(),pmoffice_private.software_event_wake(),pmoffice_private.mail_event_wake() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
