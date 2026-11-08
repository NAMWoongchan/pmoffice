begin;

update public.pms_groups set name = '넥스팜 PMS 관리자'
 where id = 'e99358b1-8880-4e2e-894f-d42c9d0efdd0' and name = '넥스팜 PMS 운영자';
update public.pms_groups set name = '넥스팜 PMS 직원'
 where id = '3d615d9d-c1a6-4aa2-8ab1-4335f54ec541' and name = '넥스팜 PMS 열람 회원';

create or replace function public.nexpharm_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('canRead', r.can_read, 'canManage', r.can_manage,
   'projects', coalesce((
     select jsonb_agg(jsonb_build_object('slug', p.slug, 'title', p.title,
       'description', p.description, 'version', p.version) order by p.title, p.slug)
     from public.pms_projects p
     where r.can_read and p.slug ~ '^nexpharm-[0-9a-f]{12}$' and p.status = 'published'
   ), '[]'::jsonb))
 from pmoffice_private.nexpharm_roles() r
$$;

create or replace function public.nexpharm_access(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
   'canRead', r.can_read and p.slug is not null,
   'canManage', r.can_manage and p.slug is not null,
   'project', case when r.can_read and p.slug is not null
     then jsonb_build_object('slug', p.slug, 'title', p.title, 'description', p.description, 'version', p.version) end)
 from pmoffice_private.nexpharm_roles() r
 left join public.pms_projects p on p.slug = p_slug
   and p.slug ~ '^nexpharm-[0-9a-f]{12}$' and p.status = 'published'
$$;

create function public.nexpharm_update_project(p_slug text, p_version integer, p_title text, p_description text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 title_input text := btrim(p_title);
 description_input text := btrim(coalesce(p_description, ''));
 previous public.pms_projects;
 saved public.pms_projects;
begin
 if not coalesce((public.nexpharm_access(p_slug)->>'canManage')::boolean, false) then raise insufficient_privilege; end if;
 if p_version is null or title_input is null or length(title_input) not between 1 and 160 or length(description_input) > 1000 then
   raise exception '프로젝트 이름 또는 설명을 확인해 주세요.' using errcode = '22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('nexpharm:' || lower(title_input), 0));
 select * into previous from public.pms_projects where slug = p_slug and status = 'published' for update;
 if not found or previous.version <> p_version then
   raise exception '다른 수정이 있습니다. 다시 확인해 주세요.' using errcode = '40001';
 end if;
 if exists (select 1 from public.pms_projects where slug ~ '^nexpharm-[0-9a-f]{12}$'
    and slug <> p_slug and status = 'published' and lower(title) = lower(title_input)) then
   raise exception '이미 사용 중인 프로젝트 이름입니다.' using errcode = '23505';
 end if;
 update public.pms_projects set title = title_input, description = description_input,
   version = version + 1, updated_at = now() where slug = p_slug returning * into saved;
 insert into public.pms_audit(actor, project_slug, action, details)
 values(auth.uid(), p_slug, 'project.save', jsonb_build_object('before_version', previous.version, 'after_version', saved.version));
 return jsonb_build_object('slug', saved.slug, 'title', saved.title, 'description', saved.description, 'version', saved.version);
end
$$;

create function public.nexpharm_admin_members() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if not coalesce(pmoffice_private.is_admin(), false) then raise insufficient_privilege; end if;
 return coalesce((
   select jsonb_agg(to_jsonb(q) order by lower(q.email), q.user_id) from (
     select distinct on (m.user_id) m.user_id, u.email, p.display_name,
       case when m.group_id = 'e99358b1-8880-4e2e-894f-d42c9d0efdd0' then 'manager' else 'staff' end as role,
       m.expires_at,
       case when not g.active then 'group_inactive'
         when p.status <> 'active' or p.withdrawn_at is not null then 'account_inactive'
         when m.expires_at <= now() then 'expired'
         else 'assigned' end as state
     from public.pms_group_members m
     join public.pms_groups g on g.id = m.group_id
     join auth.users u on u.id = m.user_id
     join public.profiles p on p.id = u.id
     where m.active and m.group_id in ('3d615d9d-c1a6-4aa2-8ab1-4335f54ec541','e99358b1-8880-4e2e-894f-d42c9d0efdd0')
     order by m.user_id,
       (g.active and (m.expires_at is null or m.expires_at > now())) desc,
       (m.group_id = 'e99358b1-8880-4e2e-894f-d42c9d0efdd0') desc
   ) q
 ), '[]'::jsonb);
end
$$;

create function public.nexpharm_set_member_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
 manager constant uuid := 'e99358b1-8880-4e2e-894f-d42c9d0efdd0';
 staff constant uuid := '3d615d9d-c1a6-4aa2-8ab1-4335f54ec541';
 target_group uuid;
begin
 if not coalesce(pmoffice_private.is_admin(), false) then raise insufficient_privilege; end if;
 if p_user is null or p_role is null or p_role not in ('manager', 'staff', 'none') then raise invalid_parameter_value; end if;
 perform pg_advisory_xact_lock(hashtextextended('nexpharm-member:' || p_user::text, 0));
 if p_role <> 'none' then
   if not exists (select 1 from public.profiles p where p.id = p_user and p.status = 'active'
       and p.withdrawn_at is null and (p.registered_at is not null or p.signup_accepted_at is not null)) then
     raise exception '등록된 활성 회원을 선택해 주세요.' using errcode = '22023';
   end if;
   target_group := case when p_role = 'manager' then manager else staff end;
   if not exists(select 1 from public.pms_groups where id = target_group and active) then
     raise exception '선택한 넥스팜 그룹이 사용 중지 상태입니다.' using errcode = '22023';
   end if;
 end if;

 update public.pms_group_members set active = false
 where user_id = p_user and group_id in (manager, staff) and group_id is distinct from target_group and active;
 if target_group is not null then
   insert into public.pms_group_members as m(group_id, user_id, active) values(target_group, p_user, true)
   on conflict(group_id, user_id) do update set active = true,
     expires_at = case when m.active and m.expires_at > now() then m.expires_at else null end;
 end if;
 insert into public.pms_audit(actor, project_slug, action, details)
 values(auth.uid(), '@groups', 'group.member', jsonb_build_object('workspace', 'nexpharm', 'user', p_user, 'role', p_role));
end
$$;

revoke all on function public.nexpharm_update_project(text,integer,text,text),
 public.nexpharm_admin_members(), public.nexpharm_set_member_role(uuid,text) from public, anon, authenticated;
grant execute on function public.nexpharm_update_project(text,integer,text,text),
 public.nexpharm_admin_members(), public.nexpharm_set_member_role(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
