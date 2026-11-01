-- Project Online directory and independently controlled online education services.
begin;
create table pmoffice_private.education_services(
 user_id uuid not null references public.profiles(id),kind text not null check(kind in('msp','ai')),
 enabled boolean not null,origin text not null default 'manual' check(origin in('manual','legacy')),
 expires_at timestamptz,granted_by uuid references auth.users(id),updated_at timestamptz not null default now(),primary key(user_id,kind));
alter table pmoffice_private.education_services enable row level security;
revoke all on pmoffice_private.education_services from public,anon,authenticated;
-- Preserve eligible existing rights without turning expiring or revocable legacy grants into perpetual grants.
insert into pmoffice_private.education_services(user_id,kind,enabled,origin)
 select p.id,k.kind,true,'legacy' from public.profiles p cross join (values('msp'),('ai')) k(kind)
 where exists(select 1 from public.unified_regular_memberships u where u.user_id=p.id and u.status='active' and u.starts_at<=now() and (u.expires_at is null or u.expires_at>now()))
 or exists(select 1 from public.user_memberships m join public.membership_tiers t on t.id=m.tier_id where m.user_id=p.id and m.membership_id=k.kind and m.status='active' and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now()) and t.rank>=2);
create function pmoffice_private.education_service_enabled(u uuid,k text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from pmoffice_private.education_services s where s.user_id=u and s.kind=k and s.enabled and (s.expires_at is null or s.expires_at>now()) and
 (s.origin='manual' or exists(select 1 from public.unified_regular_memberships r where r.user_id=u and r.status='active' and r.starts_at<=now() and (r.expires_at is null or r.expires_at>now()))
 or exists(select 1 from public.user_memberships m join public.membership_tiers t on t.id=m.tier_id where m.user_id=u and m.membership_id=k and m.status='active' and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now()) and t.rank>=2)))
$$;
create or replace function pmoffice_private.has_course_membership(p_kind text) returns boolean language sql stable security definer set search_path='' as $$
 select case when p_kind in('msp','ai') then pmoffice_private.account_ok() and (coalesce(pmoffice_private.is_admin(),false) or pmoffice_private.education_service_enabled(auth.uid(),p_kind))
 else pmoffice_private.has_unified_regular() or (pmoffice_private.account_ok() and pmoffice_private.matches_rule(p_kind,'vip','minimum')) end
$$;
-- Existing group-only project authorization already includes administrators and all project states.
create or replace function public.pms_catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(p) order by p.customer,p.title),'[]') from public.pms_projects p where coalesce((public.pms_access(p.slug)->>'canRead')::boolean,false)
$$;
create function public.member_services() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid();adm boolean:=coalesce(pmoffice_private.is_admin(),false); result jsonb;
begin
 if not coalesce(pmoffice_private.account_ok(),false) then raise insufficient_privilege;end if;
 select jsonb_build_object('education',coalesce((select jsonb_agg(jsonb_build_object('kind',k.kind,'name',k.name)) from (values('msp','MS Project 교육'),('ai','AI 교육')) k(kind,name) where adm or pmoffice_private.education_service_enabled(u,k.kind)),'[]'),
 'projects',public.pms_catalog(),
 'ebook',jsonb_build_object('books',(select count(*) from pmoffice_private.ebook_books where owner_id=u and state<>'archived'),'ready',(select count(*) from pmoffice_private.ebook_books where owner_id=u and state='ready'),
 'bytes',(select coalesce(sum(source_bytes),0) from pmoffice_private.ebook_books where owner_id=u and state<>'archived'),'max',case when adm then null else 10 end,'enabled',adm or pmoffice_private.ebook_user_ok(u))) into result;
 return result;
end$$;
create function public.member_admin_education(p_user_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform pmoffice_private.require_admin();
 return (select jsonb_agg(jsonb_build_object('kind',k.kind,'name',k.name,'enabled',pmoffice_private.education_service_enabled(p_user_id,k.kind),'origin',s.origin,'expires_at',s.expires_at)) from (values('msp','MS Project 교육'),('ai','AI 교육')) k(kind,name) left join pmoffice_private.education_services s on s.user_id=p_user_id and s.kind=k.kind);
end$$;
create function public.member_admin_set_education(p_user_id uuid,p_kind text,p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous jsonb;
begin
 perform pmoffice_private.require_admin();
 if p_kind not in('msp','ai') or p_kind is null or p_enabled is null or not exists(select 1 from public.profiles where id=p_user_id) then raise exception '교육 종류와 회원을 확인해 주세요.' using errcode='22023';end if;
 perform 1 from public.profiles where id=p_user_id for update;
 select to_jsonb(s) into previous from pmoffice_private.education_services s where user_id=p_user_id and kind=p_kind;
 insert into pmoffice_private.education_services(user_id,kind,enabled,origin,granted_by) values(p_user_id,p_kind,p_enabled,'manual',auth.uid())
 on conflict(user_id,kind) do update set enabled=excluded.enabled,origin='manual',expires_at=null,granted_by=auth.uid(),updated_at=now();
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'education.service_changed',p_user_id::text,jsonb_build_object('kind',p_kind,'before',previous,'enabled',p_enabled));
 return public.member_admin_education(p_user_id);
end$$;
revoke all on function pmoffice_private.education_service_enabled(uuid,text),public.member_services(),public.member_admin_education(uuid),public.member_admin_set_education(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.member_services(),public.member_admin_education(uuid),public.member_admin_set_education(uuid,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
