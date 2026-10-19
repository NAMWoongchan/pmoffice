begin;
-- Extends the existing PMOffice profiles, account_ok and is_admin implementation.
create table public.pms_projects (
 slug text primary key check(slug ~ '^[a-z][a-z0-9-]{1,47}$' and slug not in ('app','callback','project','index','admin','assets')),
 title text not null check(length(title) between 1 and 160),
 customer text not null default '' check(length(customer)<=120),
 description text not null default '' check(length(description)<=1000),
 access_mode text not null default 'assigned' check(access_mode in ('public','members','assigned')),
 status text not null default 'draft' check(status in ('draft','published','archived')),
 listed boolean not null default false,
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
create table public.pms_members (
 project_slug text not null references public.pms_projects(slug),
 user_id uuid not null references auth.users(id),
 active boolean not null default true,
 expires_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key(project_slug,user_id)
);
create table public.pms_audit (
 id bigint generated always as identity primary key,
 actor uuid references auth.users(id), project_slug text not null,
 action text not null, details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
alter table public.pms_projects enable row level security;
alter table public.pms_members enable row level security;
alter table public.pms_audit enable row level security;
revoke all on public.pms_projects,public.pms_members,public.pms_audit from public,anon,authenticated;
-- No direct table grants; all requests go through bounded, authorization-checked RPCs.
create function pmoffice_private.pms_google_member() returns boolean
language sql stable security definer set search_path='' as $$
 select pmoffice_private.account_ok() and exists (
 select 1 from auth.users u join auth.identities i on i.user_id=u.id
 where u.id=auth.uid() and u.email_confirmed_at is not null
 and i.provider='google' and i.identity_data->>'email_verified'='true')
$$;
create function public.pms_access(p_slug text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.pms_projects; a boolean; ok boolean;
begin
 a:=coalesce(pmoffice_private.is_admin(),false);
 select * into p from public.pms_projects where slug=p_slug;
 if not found then return jsonb_build_object('allowed',false,'admin',a);end if;
 ok:=a or (p.status='published' and (p.access_mode='public' or
  (pmoffice_private.pms_google_member() and (p.access_mode='members' or exists(
    select 1 from public.pms_members m where m.project_slug=p.slug and m.user_id=auth.uid()
     and m.active and (m.expires_at is null or m.expires_at>now()))))));
 if not (ok or (p.listed and p.status='published')) then return jsonb_build_object('allowed',false,'admin',a);end if;
 return jsonb_build_object('allowed',ok,'admin',a,'project',to_jsonb(p));
end$$;
create function public.pms_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(p) order by p.customer,p.title),'[]') from public.pms_projects p
 where pmoffice_private.is_admin() or (p.status='published' and (p.listed or (public.pms_access(p.slug)->>'allowed')::boolean))
$$;
create function public.pms_account() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('signed_in',auth.uid() is not null,'member',pmoffice_private.pms_google_member(),
 'admin',pmoffice_private.is_admin(),'signup_version',(select signup_version from pmoffice_private.service_settings where singleton),
 'user_id',auth.uid())
$$;
create function public.pms_save_project(p_project jsonb,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old public.pms_projects; result public.pms_projects; s text:=p_project->>'slug';
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('pms:'||coalesce(s,''),0));
 select * into old from public.pms_projects where slug=s for update;
 if (found and old.version<>p_version) or (not found and p_version<>0) or p_version is null then raise exception '동시 수정이 감지되었습니다. 다시 조회해 주세요.' using errcode='40001';end if;
 insert into public.pms_projects(slug,title,customer,description,access_mode,status,listed)
 values(s,p_project->>'title',coalesce(p_project->>'customer',''),coalesce(p_project->>'description',''),
 p_project->>'access_mode',p_project->>'status',coalesce((p_project->>'listed')::boolean,false))
 on conflict(slug) do update set title=excluded.title,customer=excluded.customer,description=excluded.description,
 access_mode=excluded.access_mode,status=excluded.status,listed=excluded.listed,
 version=pms_projects.version+1,updated_at=now() returning * into result;
 insert into public.pms_audit(actor,project_slug,action,details) values(auth.uid(),s,'project.save',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(result)));
 return to_jsonb(result);
end$$;
create function public.pms_set_member(p_slug text,p_user uuid,p_active boolean,p_expires timestamptz default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if not exists(select 1 from auth.users u join auth.identities i on i.user_id=u.id where u.id=p_user and i.provider='google') then raise exception '먼저 Google로 가입한 회원만 지정할 수 있습니다.';end if;
 insert into public.pms_members(project_slug,user_id,active,expires_at) values(p_slug,p_user,p_active,p_expires)
 on conflict(project_slug,user_id) do update set active=excluded.active,expires_at=excluded.expires_at,updated_at=now();
 insert into public.pms_audit(actor,project_slug,action,details) values(auth.uid(),p_slug,'member.change',jsonb_build_object('user_id',p_user,'active',p_active,'expires_at',p_expires));
end$$;
create function public.pms_admin_members(p_slug text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(q)) from (select m.*,u.email from public.pms_members m join auth.users u on u.id=m.user_id where project_slug=p_slug order by updated_at desc limit 500) q),'[]');
end$$;
create function public.pms_find_members(p_search text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if length(trim(p_search))<3 then return '[]';end if;
 return coalesce((select jsonb_agg(to_jsonb(q)) from (
 select u.id,u.email,p.status from auth.users u join public.profiles p on p.id=u.id
 where u.email ilike '%'||left(trim(p_search),120)||'%' and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google')
 order by u.email limit 25) q),'[]');
end$$;
create function public.pms_history(p_slug text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(q)) from (select * from public.pms_audit where project_slug=p_slug order by id desc limit 100) q),'[]');
end$$;
create function public.pms_log_action(p_slug text,p_action text,p_details jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if p_action not in ('workbook.publish','route.publish') or octet_length(p_details::text)>4000 then raise exception 'Invalid audit event';end if;
 insert into public.pms_audit(actor,project_slug,action,details) values(auth.uid(),p_slug,p_action,p_details);
end$$;
revoke all on function pmoffice_private.pms_google_member() from public,anon,authenticated;
revoke all on function public.pms_access(text),public.pms_catalog(),public.pms_account(),
 public.pms_save_project(jsonb,integer),public.pms_set_member(text,uuid,boolean,timestamptz),
 public.pms_admin_members(text),public.pms_find_members(text),public.pms_history(text),public.pms_log_action(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pms_access(text),public.pms_catalog(),public.pms_account() to anon,authenticated;
grant execute on function public.pms_save_project(jsonb,integer),public.pms_set_member(text,uuid,boolean,timestamptz),
 public.pms_admin_members(text),public.pms_find_members(text),public.pms_history(text),public.pms_log_action(text,text,jsonb) to authenticated;
insert into public.pms_projects(slug,title,customer,description) values('korail','철도차량 차륜 자동검사시스템','한국철도공사','프로젝트 일정·마일스톤·기관별 현황과 보고서');
notify pgrst,'reload schema';
commit;

