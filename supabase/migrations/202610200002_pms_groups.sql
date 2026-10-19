begin;
alter table public.pms_projects alter column access_mode set default 'public';
alter table public.pms_members add column role text not null default 'viewer' check(role in ('viewer','editor'));
create table public.pms_groups (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 120),
 active boolean not null default true,
 updated_at timestamptz not null default now()
);
create table public.pms_group_members (
 group_id uuid not null references public.pms_groups(id),
 user_id uuid not null references auth.users(id),
 active boolean not null default true,
 primary key(group_id,user_id)
);
create table public.pms_group_grants (
 project_slug text not null references public.pms_projects(slug),
 group_id uuid not null references public.pms_groups(id),
 role text not null check(role in ('viewer','editor')),
 active boolean not null default true,
 expires_at timestamptz,
 primary key(project_slug,group_id)
);
alter table public.pms_groups enable row level security;
alter table public.pms_group_members enable row level security;
alter table public.pms_group_grants enable row level security;
revoke all on public.pms_groups,public.pms_group_members,public.pms_group_grants from public,anon,authenticated;

create or replace function public.pms_access(p_slug text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.pms_projects; a boolean; r boolean:=false; e boolean:=false; granted boolean:=false; edit_granted boolean:=false; result jsonb;
begin
 a:=coalesce(pmoffice_private.is_admin(),false);
 select * into p from public.pms_projects where slug=p_slug;
 if not found then return jsonb_build_object('allowed',false,'admin',a,'canRead',false,'canPublish',false,'canManage',false);end if;
 if coalesce(pmoffice_private.pms_google_member(),false) then
  select count(*)>0,coalesce(bool_or(g.role='editor'),false) into granted,edit_granted from (
   select role from public.pms_members where project_slug=p_slug and user_id=auth.uid() and active and (expires_at is null or expires_at>now())
   union all
   select x.role from public.pms_group_grants x join public.pms_groups g on g.id=x.group_id and g.active
   join public.pms_group_members m on m.group_id=g.id and m.user_id=auth.uid() and m.active
   where x.project_slug=p_slug and x.active and (x.expires_at is null or x.expires_at>now())
  ) g;
  r:=p.status='published' and (p.access_mode='members' or granted);
  e:=p.status='published' and edit_granted;
 end if;
 r:=a or (p.status='published' and p.access_mode='public') or r;
 e:=a or e;
 result:=jsonb_build_object('allowed',r,'admin',a,'canRead',r,'canPublish',e,'canManage',a);
 if r or (p.listed and p.status='published') then result:=result||jsonb_build_object('project',to_jsonb(p));end if;
 return result;
end$$;

create function public.pms_set_person(p_slug text,p_user uuid,p_role text,p_active boolean,p_expires timestamptz default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if not exists(select 1 from auth.identities i join public.profiles p on p.id=i.user_id where i.user_id=p_user and i.provider='google' and p.signup_accepted_at is not null) then raise exception '가입을 완료한 Google 회원을 선택하세요.';end if;
 insert into public.pms_members(project_slug,user_id,role,active,expires_at) values(p_slug,p_user,p_role,p_active,p_expires)
 on conflict(project_slug,user_id) do update set role=excluded.role,active=excluded.active,expires_at=excluded.expires_at,updated_at=now();
 insert into public.pms_audit(actor,project_slug,action,details) values(auth.uid(),p_slug,'person.grant',jsonb_build_object('user',p_user,'role',p_role,'active',p_active,'expires',p_expires));
end$$;

create function public.pms_groups_list() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(g) order by g.name) from public.pms_groups g),'[]');
end$$;
create function public.pms_save_group(p_id uuid,p_name text,p_active boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare gid uuid;
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if p_id is null then
  insert into public.pms_groups(name,active) values(trim(p_name),p_active) returning id into gid;
 else
  update public.pms_groups set name=trim(p_name),active=p_active,updated_at=now() where id=p_id returning id into gid;
  if not found then raise exception '그룹이 없습니다.';end if;
 end if;
 insert into public.pms_audit(actor,project_slug,action,details) values(auth.uid(),'@groups','group.save',jsonb_build_object('id',gid,'name',p_name,'active',p_active));
 return gid;
end$$;
create function public.pms_group_people(p_group uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
 select m.user_id,m.active,u.email from public.pms_group_members m join auth.users u on u.id=m.user_id where m.group_id=p_group order by u.email
 ) x),'[]');
end$$;
create function public.pms_set_group_person(p_group uuid,p_user uuid,p_active boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if not exists(select 1 from auth.identities i join public.profiles p on p.id=i.user_id where i.user_id=p_user and i.provider='google' and p.signup_accepted_at is not null) then raise exception '가입을 완료한 Google 회원을 선택하세요.';end if;
 insert into public.pms_group_members(group_id,user_id,active) values(p_group,p_user,p_active)
 on conflict(group_id,user_id) do update set active=excluded.active;
 insert into public.pms_audit(actor,project_slug,action,details) values(auth.uid(),'@groups','group.member',jsonb_build_object('group',p_group,'user',p_user,'active',p_active));
end$$;
create function public.pms_project_groups(p_slug text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
 select a.*,g.name,g.active as group_active from public.pms_group_grants a join public.pms_groups g on g.id=a.group_id where a.project_slug=p_slug order by g.name
 ) x),'[]');
end$$;
create function public.pms_set_group_grant(p_slug text,p_group uuid,p_role text,p_active boolean,p_expires timestamptz default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 insert into public.pms_group_grants(project_slug,group_id,role,active,expires_at) values(p_slug,p_group,p_role,p_active,p_expires)
 on conflict(project_slug,group_id) do update set role=excluded.role,active=excluded.active,expires_at=excluded.expires_at;
 insert into public.pms_audit(actor,project_slug,action,details) values(auth.uid(),p_slug,'group.grant',jsonb_build_object('group',p_group,'role',p_role,'active',p_active,'expires',p_expires));
end$$;
create or replace function public.pms_log_action(p_slug text,p_action text,p_details jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare a jsonb:=public.pms_access(p_slug);
begin
 if not coalesce((a->>'canManage')::boolean,false) and not (p_action='workbook.publish' and coalesce((a->>'canPublish')::boolean,false)) then raise insufficient_privilege;end if;
 if p_action not in ('workbook.publish','route.publish') or octet_length(p_details::text)>4000 then raise exception 'Invalid audit event';end if;
 insert into public.pms_audit(actor,project_slug,action,details) values(auth.uid(),p_slug,p_action,p_details);
end$$;
revoke all on function public.pms_set_person(text,uuid,text,boolean,timestamptz),public.pms_groups_list(),public.pms_save_group(uuid,text,boolean),public.pms_group_people(uuid),public.pms_set_group_person(uuid,uuid,boolean),public.pms_project_groups(text),public.pms_set_group_grant(text,uuid,text,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.pms_set_person(text,uuid,text,boolean,timestamptz),public.pms_groups_list(),public.pms_save_group(uuid,text,boolean),public.pms_group_people(uuid),public.pms_set_group_person(uuid,uuid,boolean),public.pms_project_groups(text),public.pms_set_group_grant(text,uuid,text,boolean,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
