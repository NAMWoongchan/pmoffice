begin;
alter table public.profiles add column position text not null default '' check(length(position)<=120);
create function public.member_position_save(p_user uuid,p_position text) returns void
language plpgsql security definer set search_path='' as $$begin
 if not coalesce(pmoffice_private.is_admin(),false) and (p_user is distinct from auth.uid() or not coalesce(pmoffice_private.account_ok(),false)) then raise insufficient_privilege;end if;
 if p_position is null or length(p_position)>120 then raise exception '직함을 확인해 주세요.';end if;
 update public.profiles set position=trim(p_position) where id=p_user;
 if not found then raise exception '회원이 없습니다.';end if;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'member.position',p_user::text);
end$$;
create table public.pms_org_grants(
 project_slug text not null references public.pms_projects(slug),
 org_name text not null check(length(trim(org_name)) between 1 and 200),
 group_id uuid not null references public.pms_groups(id), active boolean not null default true,
 primary key(project_slug,org_name)
);
alter table public.pms_org_grants enable row level security;
revoke all on public.pms_org_grants from public,anon,authenticated;
create function public.pms_task_policy(p_slug text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb:=public.pms_access(p_slug); orgs jsonb;
begin
 if not coalesce((a->>'canRead')::boolean,false) then raise insufficient_privilege;end if;
 select coalesce(jsonb_agg(distinct x.org_name),'[]') into orgs from public.pms_org_grants x
 join public.pms_groups g on g.id=x.group_id and g.active
 join public.pms_group_members m on m.group_id=g.id and m.active and m.user_id=auth.uid() and (m.expires_at is null or m.expires_at>now())
 join public.pms_group_grants p on p.group_id=g.id and p.project_slug=x.project_slug and p.active and (p.expires_at is null or p.expires_at>now())
 where x.project_slug=p_slug and x.active and coalesce(pmoffice_private.account_ok(),false);
 return jsonb_build_object('admin',coalesce((a->>'canManage')::boolean,false),'organizations',orgs);
end$$;
create function public.pms_org_grants_admin(p_slug text) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('group_name',g.name)) from public.pms_org_grants x join public.pms_groups g on g.id=x.group_id where x.project_slug=p_slug),'[]');
end$$;
create function public.pms_set_org_grant(p_slug text,p_org text,p_group uuid,p_active boolean) returns void
language plpgsql security definer set search_path='' as $$begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if p_org<>trim(p_org) or length(p_org) not between 1 and 200 then raise exception '기관명을 확인해 주세요.';end if;
 insert into public.pms_org_grants(project_slug,org_name,group_id,active) values(p_slug,p_org,p_group,p_active)
 on conflict(project_slug,org_name) do update set group_id=excluded.group_id,active=excluded.active;
 insert into public.pms_audit(actor,project_slug,action,details) values(auth.uid(),p_slug,'task.organization',jsonb_build_object('org',p_org,'group',p_group,'active',p_active));
end$$;
create function public.member_bulk_lookup(p_email text) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return (select to_jsonb(p)||jsonb_build_object('email',u.email,'banned_until',u.banned_until,'provision_request',u.raw_app_meta_data->>'member_request_id')
 from auth.users u join public.profiles p on p.id=u.id where lower(u.email)=lower(trim(p_email)));
end$$;
create function public.member_bulk_attach(p_user uuid,p_company text) returns void
language plpgsql security definer set search_path='' as $$
declare cname text; gid uuid; n integer;
begin
 if not coalesce(pmoffice_private.is_admin(),false) or p_company not in('한국철도공사','샬롬엔지니어링','투아이시스','알에프컴','KTL','국립한국교통대학교') then raise insufficient_privilege;end if;
 if not exists(select 1 from public.profiles where id=p_user and company=p_company and status='active' and withdrawn_at is null and (registered_at is not null or signup_accepted_at is not null)) then raise insufficient_privilege;end if;
 foreach cname in array array['Korail 철도차량 차륜 자동검사시스템',p_company] loop
  perform pg_advisory_xact_lock(hashtextextended('korail-group:'||cname,0));
  select count(*) into n from public.pms_groups where name=cname;
  if n>1 then raise exception '동일 이름 그룹이 중복되어 있습니다.';end if;
  if n=0 then insert into public.pms_groups(name) values(cname) returning id into gid;
  else select id into gid from public.pms_groups where name=cname and active;
   if gid is null then raise exception '중지 그룹은 자동 활성화하지 않습니다.';end if;
  end if;
  insert into public.pms_group_members(group_id,user_id,active) values(gid,p_user,true)
  on conflict(group_id,user_id) do update set active=true,expires_at=null;
  insert into public.pms_group_grants(project_slug,group_id,role,active) values('korail',gid,'viewer',true)
  on conflict(project_slug,group_id) do update set role='viewer',active=true,expires_at=null;
 end loop;
 insert into public.pms_org_grants(project_slug,org_name,group_id,active)
 values('korail',case when p_company='KTL' then '한국산업기술시험원' else p_company end,gid,true)
 on conflict(project_slug,org_name) do update set group_id=excluded.group_id,active=true;
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'member.bulk_group',p_user::text,jsonb_build_object('company',p_company,'project','korail'));
end$$;
create or replace function public.pms_log_action(p_slug text,p_action text,p_details jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare a jsonb:=public.pms_access(p_slug);begin
 if not coalesce((a->>'canManage')::boolean,false) and not(p_action='task.patch' and coalesce((a->>'canRead')::boolean,false) and jsonb_array_length(public.pms_task_policy(p_slug)->'organizations')>0) then raise insufficient_privilege;end if;
 if p_action not in('workbook.publish','route.publish','task.patch') or octet_length(p_details::text)>4000 then raise exception 'Invalid audit event';end if;
 insert into public.pms_audit(actor,project_slug,action,details) values(auth.uid(),p_slug,p_action,p_details);
end$$;
revoke all on function public.member_position_save(uuid,text),public.member_bulk_lookup(text),public.member_bulk_attach(uuid,text),public.pms_task_policy(text),public.pms_org_grants_admin(text),public.pms_set_org_grant(text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.member_position_save(uuid,text),public.member_bulk_lookup(text),public.member_bulk_attach(uuid,text),public.pms_task_policy(text),public.pms_org_grants_admin(text),public.pms_set_org_grant(text,text,uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
