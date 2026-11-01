begin;
create function public.member_admin_view_list(p_search text default '',p_offset integer default 0,p_sort text default 'registered_at',p_direction text default 'desc',p_view text default 'valid') returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare expression text;statement text;result jsonb;begin
 perform pmoffice_private.require_admin();
 if p_direction not in('asc','desc') or p_offset<0 or p_search is null or length(p_search)>200 or p_view not in('valid','all','new','using','expired','withdrawn','partner') then raise exception '조회 조건을 확인해 주세요.';end if;
 expression:=case p_sort when 'registered_at' then 'coalesce(x.registered_at,x.created_at)' when 'display_name' then 'x.display_name' when 'email' then 'x.email' when 'company' then 'x.company' when 'position' then 'x.position' when 'member_kind' then 'x.member_kind' when 'groups' then 'x.groups::text' when 'member_state' then 'x.member_state_label' when 'status' then 'x.member_state_label' when 'services' then 'x.service_names::text' when 'last_sign_in_at' then 'x.last_sign_in_at' when 'login_status' then 'x.login_status' else null end;
 if expression is null then raise exception '정렬 열을 확인해 주세요.';end if;
 statement:=format($q$
 with raw as (select p.*,u.email,u.last_sign_in_at,exists(select 1 from public.admin_roles ar where ar.user_id=p.id) as system_admin,
 case when p.status<>'active' or p.withdrawn_at is not null or u.banned_until>statement_timestamp() then 'blocked'
 when exists(select 1 from auth.sessions s where s.user_id=p.id and (s.not_after is null or s.not_after>statement_timestamp())) then 'signed_in'
 else 'signed_out' end as login_status,
 coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'active',g.active and m.active and (m.expires_at is null or m.expires_at>statement_timestamp())) order by g.name,g.id)
 from public.pms_groups g join public.pms_group_members m on m.group_id=g.id where m.user_id=p.id),'[]') as groups
 from public.profiles p join auth.users u on u.id=p.id
 where length($1)<=200 and ($1='' or u.email ilike '%%'||$1||'%%' or p.display_name ilike '%%'||$1||'%%' or p.company ilike '%%'||$1||'%%')),facts as (
 select r.*,pmoffice_private.member_service_codes(r.id) services,
 (r.service_partner or exists(select 1 from public.user_memberships m where m.user_id=r.id and m.status='active' and m.starts_at<=statement_timestamp() and (m.expires_at is null or m.expires_at>statement_timestamp()))) has_service,
 (exists(select 1 from public.user_memberships m where m.user_id=r.id and m.status='active' and m.expires_at<=statement_timestamp()) or exists(select 1 from public.unified_regular_memberships m where m.user_id=r.id and m.status='active' and m.expires_at<=statement_timestamp())) has_expired,
 (exists(select 1 from public.user_memberships m where m.user_id=r.id and m.status='suspended') or exists(select 1 from public.unified_regular_memberships m where m.user_id=r.id and m.status='suspended')) has_suspended
 from raw r),states as (
 select f.*,case when f.withdrawn_at is not null then 'withdrawn' when f.status<>'active' or f.login_status='blocked' then 'suspended' when f.has_service then 'using' when f.has_expired then 'expired' when f.has_suspended then 'suspended' else 'new' end member_state from facts f),classified as (
 select t.*,case t.member_state when 'withdrawn' then '탈퇴' when 'suspended' then '이용 중지' when 'using' then '이용 중' when 'expired' then '멤버십 만료' else '신규 회원' end member_state_label,
 array(select coalesce((select c->>'name' from jsonb_array_elements(public.member_service_catalog()) c where c->>'id'=code),case split_part(code,':',1) when 'ai' then 'AI PM' when 'msp' then 'MS Project' when 'pm' then '프로젝트 관리' else code end||': '||case split_part(code,':',2) when 'prestige' then '프레스티지' else split_part(code,':',2) end) from unnest(t.services) code) service_names
 from states t)
 select coalesce(jsonb_agg(to_jsonb(r)-'__row'-'has_service'-'has_expired'-'has_suspended' order by r.__row),'[]') from (
 select x.*,row_number()over(order by %s %s nulls last,x.id) __row from classified x
 where $3='all' or ($3='valid' and x.member_state in('new','using')) or ($3='partner' and x.member_state='using' and x.service_partner) or ($3 in('new','using','expired','withdrawn') and x.member_state=$3)
 order by %s %s nulls last,x.id offset $2 limit 101) r$q$,expression,p_direction,expression,p_direction);
 execute statement into result using p_search,p_offset,p_view;return result;
end$fn$;
revoke all on function public.member_admin_view_list(text,integer,text,text,text) from public,anon;
grant execute on function public.member_admin_view_list(text,integer,text,text,text) to authenticated;
-- Expiry is time dependent; data-change events remain the only automatic synchronization trigger.
notify pgrst,'reload schema';
commit;
