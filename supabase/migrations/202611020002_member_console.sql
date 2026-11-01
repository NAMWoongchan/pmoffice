-- Read-only admin member overview; no authentication/session identifiers are returned.
begin;
create or replace function public.member_admin_list(p_search text default '',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by coalesce(x.registered_at,x.created_at) desc,x.id) from (
 select p.*,u.email,u.last_sign_in_at,exists(select 1 from public.admin_roles ar where ar.user_id=p.id) as system_admin,
 case when p.status<>'active' or p.withdrawn_at is not null or u.banned_until>statement_timestamp() then 'blocked'
 when exists(select 1 from auth.sessions s where s.user_id=p.id and (s.not_after is null or s.not_after>statement_timestamp())) then 'signed_in'
 else 'signed_out' end as login_status,
 coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'active',g.active and m.active and (m.expires_at is null or m.expires_at>statement_timestamp())) order by g.name,g.id)
 from public.pms_groups g join public.pms_group_members m on m.group_id=g.id where m.user_id=p.id),'[]') as groups
 from public.profiles p join auth.users u on u.id=p.id
 where length(p_search)<=200 and (p_search='' or u.email ilike '%'||p_search||'%' or p.display_name ilike '%'||p_search||'%' or p.company ilike '%'||p_search||'%')
 order by coalesce(p.registered_at,p.created_at) desc,p.id offset greatest(0,p_offset) limit 101
 ) x),'[]');
end$$;
revoke all on function public.member_admin_list(text,integer) from public,anon;
grant execute on function public.member_admin_list(text,integer) to authenticated;
notify pgrst,'reload schema';

-- Appended by the release builder to the additive member-console migration.
alter table public.profiles add column service_base text not null default 'seedling' check(service_base in('seedling','regular'));
alter table public.profiles add column service_partner boolean not null default false;
alter table public.profiles add column services_revision bigint not null default 0;
update public.profiles p set service_base='regular' where exists(select 1 from public.unified_regular_memberships r where r.user_id=p.id and r.status='active' and r.starts_at<=now() and (r.expires_at is null or r.expires_at>now()));
create table pmoffice_private.member_details(user_id uuid primary key references public.profiles(id),signup_answers jsonb,corrected_answers jsonb,requested_services text[] not null default '{}',admin_memo text not null default '',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table pmoffice_private.member_bulk_requests(id uuid primary key,actor_id uuid not null,result jsonb not null,created_at timestamptz not null default now());
alter table pmoffice_private.member_details enable row level security;
alter table pmoffice_private.member_bulk_requests enable row level security;
revoke all on pmoffice_private.member_details,pmoffice_private.member_bulk_requests from public,anon,authenticated;
create function public.member_service_catalog() returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_array(
jsonb_build_object('id','seedling','name','새싹멤버','kind','base'),jsonb_build_object('id','regular','name','정회원','kind','base'),
jsonb_build_object('id','ai:vip','name','AI PM: VIP','kind','ai'),jsonb_build_object('id','ai:vip-plus','name','AI PM: VIP+','kind','ai'),jsonb_build_object('id','ai:vvip','name','AI PM: VVIP','kind','ai'),jsonb_build_object('id','ai:premium','name','AI PM: 프리미엄','kind','ai'),
jsonb_build_object('id','msp:vip','name','MS Project: VIP','kind','msp'),jsonb_build_object('id','msp:vip-plus','name','MS Project: VIP+','kind','msp'),jsonb_build_object('id','msp:vvip','name','MS Project: VVIP','kind','msp'),jsonb_build_object('id','msp:premium','name','MS Project: 프리미엄','kind','msp'),
jsonb_build_object('id','pm:vip','name','프로젝트 관리: VIP','kind','pm'),jsonb_build_object('id','pm:vip-plus','name','프로젝트 관리: VIP+','kind','pm'),jsonb_build_object('id','pm:vvip','name','프로젝트 관리: VVIP','kind','pm'),jsonb_build_object('id','pm:premium','name','프로젝트 관리: 프리미엄','kind','pm'),jsonb_build_object('id','partner','name','파트너','kind','partner'))
$$;
create function pmoffice_private.validate_service_codes(codes text[],require_base boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare k text;begin
 if codes is null or cardinality(codes)>15 or cardinality(codes)<>(select count(distinct x) from unnest(codes)x) or exists(select 1 from unnest(codes)c where not exists(select 1 from jsonb_array_elements(public.member_service_catalog())x where x->>'id'=c)) then raise exception '서비스 종류를 확인해 주세요.';end if;
 foreach k in array array['base','ai','msp','pm'] loop
  if (select count(*) from jsonb_array_elements(public.member_service_catalog())x where x->>'kind'=k and x->>'id'=any(codes))>1 then raise exception '같은 분야에서는 하나의 등급만 선택해 주세요.';end if;
 end loop;
 if require_base and not ('seedling'=any(codes) or 'regular'=any(codes)) then raise exception '새싹멤버 또는 정회원을 선택해 주세요.';end if;
end$$;
create function pmoffice_private.member_service_codes(u uuid) returns text[] language sql stable security definer set search_path='' as $$
select array[case when exists(select 1 from public.unified_regular_memberships r where r.user_id=u and r.status='active' and r.starts_at<=now() and (r.expires_at is null or r.expires_at>now())) then 'regular' else 'seedling' end]
||coalesce((select array_agg(m.membership_id||':'||m.tier_id order by m.membership_id) from public.user_memberships m where m.user_id=u and m.status='active' and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now())),'{}')
||case when (select service_partner from public.profiles where id=u) then array['partner'] else '{}' end
$$;
create function public.member_detail(p_user uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=coalesce(p_user,auth.uid());adm boolean:=coalesce(pmoffice_private.is_admin(),false);result jsonb;begin
 if auth.uid() is null or (not adm and (u<>auth.uid() or not coalesce(pmoffice_private.account_ok(),false))) then raise insufficient_privilege;end if;
 select jsonb_build_object('profile',to_jsonb(p)||jsonb_build_object('email',a.email,'last_sign_in_at',a.last_sign_in_at),
 'services',pmoffice_private.member_service_codes(u),'catalog',public.member_service_catalog(),
 'answers',coalesce(d.corrected_answers,d.signup_answers),'original_answers',d.signup_answers,'requested_services',coalesce(to_jsonb(d.requested_services),'[]'),
 'admin_memo',case when adm then d.admin_memo else null end,
 'activity',jsonb_build_object('joined_at',coalesce(p.registered_at,p.created_at),'last_sign_in_at',a.last_sign_in_at,'ebook_count',(select count(*) from pmoffice_private.ebook_books b where b.owner_id=u),'deleted_ebook_count',(select count(*) from pmoffice_private.ebook_books b where b.owner_id=u and b.state='archived'),'group_count',(select count(*) from public.pms_group_members gm where gm.user_id=u and gm.active)),
 'management_history',case when adm then coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select action,details,actor_id,created_at from public.audit_log where target_id=u::text and action like 'member.%' order by created_at desc limit 100)x),'[]') else '[]'::jsonb end)
 into result from public.profiles p join auth.users a on a.id=p.id left join pmoffice_private.member_details d on d.user_id=p.id where p.id=u;
 if result is null then raise insufficient_privilege;end if;return result;
end$$;
create function public.member_signup_service_request(p_codes text[],p_position text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();p public.profiles;begin
 if u is null or not coalesce(pmoffice_private.account_ok(),false) then raise insufficient_privilege;end if;
 perform pmoffice_private.validate_service_codes(p_codes,false);
 select * into strict p from public.profiles where id=u for update;
 if exists(select 1 from pmoffice_private.member_details where user_id=u and signup_answers is not null) then raise exception '가입 신청 정보는 이미 접수되었습니다. 수정은 관리자에게 요청해 주세요.';end if;
 if p_position is null or length(p_position)>120 then raise exception '직함을 확인해 주세요.';end if;
 update public.profiles set position=p_position where id=u;
 insert into pmoffice_private.member_details(user_id,signup_answers,requested_services) values(u,jsonb_build_object('이름',p.display_name,'이메일', (select email from auth.users where id=u),'회사·소속',p.company,'직함',p_position,'회원 구분',p.member_kind),p_codes)
 on conflict(user_id) do update set signup_answers=excluded.signup_answers,requested_services=excluded.requested_services,updated_at=now();
 insert into public.audit_log(actor_id,action,target_id,details) values(u,'member.service_requested',u::text,jsonb_build_object('requested',p_codes,'grants_changed',false));
 return jsonb_build_object('requested',p_codes,'grants_changed',false);
end$$;
create function public.member_admin_detail_save(p_user uuid,p_answers jsonb,p_memo text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous jsonb;begin
 perform pmoffice_private.require_admin();
 if p_reason is null or length(trim(p_reason)) not between 1 and 2000 or p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>10000 or length(coalesce(p_memo,''))>5000 then raise exception '답변·메모·변경 사유를 확인해 주세요.';end if;
 perform 1 from public.profiles where id=p_user for update;if not found then raise insufficient_privilege;end if;
 select to_jsonb(d) into previous from pmoffice_private.member_details d where d.user_id=p_user;
 insert into pmoffice_private.member_details(user_id,corrected_answers,admin_memo) values(p_user,p_answers,coalesce(p_memo,'')) on conflict(user_id) do update set corrected_answers=excluded.corrected_answers,admin_memo=excluded.admin_memo,updated_at=clock_timestamp();
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'member.answers_corrected',p_user::text,jsonb_build_object('reason',trim(p_reason),'before',previous,'answers',p_answers));
 return public.member_detail(p_user);
end$$;
create function public.member_admin_bulk(p_request uuid,p_users uuid[],p_action text,p_reason text,p_codes text[] default '{}',p_versions jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid;pr public.profiles;service_kind text;code text;tier text;previous jsonb;result jsonb:='[]';r public.user_memberships;cached pmoffice_private.member_bulk_requests;begin
 perform pmoffice_private.require_admin();
 if p_request is null or p_action not in('grade','suspend','resume','withdraw') or p_reason is null or length(trim(p_reason)) not between 1 and 2000 or p_users is null or cardinality(p_users) not between 1 and 100 or cardinality(p_users)<>(select count(distinct x) from unnest(p_users)x) then raise exception '대상·조치·변경 사유를 확인해 주세요.';end if;
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
create or replace function public.register_unified_regular() returns public.unified_regular_memberships language plpgsql security definer set search_path='' as $$
declare r public.unified_regular_memberships;begin
 if not coalesce(pmoffice_private.account_ok(),false) then raise insufficient_privilege;end if;
 select * into r from public.unified_regular_memberships where user_id=auth.uid() and status='active' and starts_at<=now() and (expires_at is null or expires_at>now());
 if r.user_id is null and not exists(select 1 from public.user_memberships where user_id=auth.uid() and status='active' and starts_at<=now() and (expires_at is null or expires_at>now())) and not pmoffice_private.education_service_enabled(auth.uid(),'msp') and not pmoffice_private.education_service_enabled(auth.uid(),'ai') then raise exception '관리자의 서비스 승인이 필요합니다.' using errcode='42501';end if;return r;
end$$;
revoke all on function pmoffice_private.validate_service_codes(text[],boolean),pmoffice_private.member_service_codes(uuid) from public,anon,authenticated;
revoke all on function public.member_detail(uuid),public.member_signup_service_request(text[],text),public.member_admin_detail_save(uuid,jsonb,text,text),public.member_admin_bulk(uuid,uuid[],text,text,text[],jsonb) from public,anon;
grant execute on function public.member_service_catalog() to anon,authenticated;
grant execute on function public.member_detail(uuid),public.member_signup_service_request(text[],text),public.member_admin_detail_save(uuid,jsonb,text,text),public.member_admin_bulk(uuid,uuid[],text,text,text[],jsonb) to authenticated;
create or replace function public.member_admin_history() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform pmoffice_private.require_admin();return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
select * from (select 'member-'||id::text as id,actor_id,action,target_id,created_at,'recorded'::text as state,details from public.audit_log where action like 'member.%'
union all select 'pms-'||id::text,actor,'pms.'||action,project_slug,created_at,'recorded',jsonb_build_object('project',project_slug) from public.pms_audit
union all select 'operation-'||request_id::text,actor_id,'member.operation.'||action,coalesce(target_id::text,request_id::text),updated_at,state,jsonb_build_object('request',request_id) from public.member_admin_operations where state in('failed','recovery_required')) events order by created_at desc limit 200)x),'[]');end$$;
notify pgrst,'reload schema';
commit;

