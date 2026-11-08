begin;

insert into public.pms_groups (id, name) values
 ('3d615d9d-c1a6-4aa2-8ab1-4335f54ec541', '넥스팜 PMS 열람 회원'),
 ('e99358b1-8880-4e2e-894f-d42c9d0efdd0', '넥스팜 PMS 운영자')
on conflict (id) do nothing;

create function pmoffice_private.nexpharm_roles() returns table (can_read boolean, can_manage boolean)
language sql stable security definer set search_path = '' as $$
 select
   coalesce(pmoffice_private.is_admin(), false)
     or coalesce(bool_or(g.id is not null), false),
   coalesce(pmoffice_private.is_admin(), false)
     or coalesce(bool_or(g.id = 'e99358b1-8880-4e2e-894f-d42c9d0efdd0'), false)
 from public.pms_groups g
 join public.pms_group_members m on m.group_id = g.id
 where g.id in ('3d615d9d-c1a6-4aa2-8ab1-4335f54ec541','e99358b1-8880-4e2e-894f-d42c9d0efdd0')
   and g.active and m.active and m.user_id = auth.uid()
   and (m.expires_at is null or m.expires_at > now())
   and coalesce(pmoffice_private.account_ok(), false)
$$;

create function public.nexpharm_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('canRead', r.can_read, 'canManage', r.can_manage,
   'projects', coalesce((
     select jsonb_agg(jsonb_build_object('slug', p.slug, 'title', p.title) order by p.title, p.slug)
     from public.pms_projects p
     where r.can_read and p.slug ~ '^nexpharm-[0-9a-f]{12}$' and p.status = 'published'
   ), '[]'::jsonb))
 from pmoffice_private.nexpharm_roles() r
$$;

create function public.nexpharm_access(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
   'canRead', r.can_read and p.slug is not null,
   'canManage', r.can_manage and p.slug is not null,
   'project', case when r.can_read and p.slug is not null
      then jsonb_build_object('slug',p.slug,'title',p.title) end)
 from pmoffice_private.nexpharm_roles() r
 left join public.pms_projects p on p.slug = p_slug
   and p.slug ~ '^nexpharm-[0-9a-f]{12}$' and p.status = 'published'
$$;

create function public.nexpharm_create_project(p_title text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare title_input text := btrim(p_title); project_slug text;
begin
 if not (select can_manage from pmoffice_private.nexpharm_roles()) then raise insufficient_privilege; end if;
 if title_input is null or length(title_input) not between 1 and 160 then
   raise exception '프로젝트 이름을 1~160자로 입력해 주세요.' using errcode = '22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('nexpharm:' || lower(title_input), 0));
 select slug into project_slug from public.pms_projects
  where slug ~ '^nexpharm-[0-9a-f]{12}$' and lower(title) = lower(title_input) and status = 'published'
  order by slug limit 1;
 if found then return jsonb_build_object('slug', project_slug); end if;

 project_slug := 'nexpharm-' || left(replace(gen_random_uuid()::text, '-', ''), 12);
 insert into public.pms_projects(slug, title, customer, access_mode, status, listed)
 values(project_slug, title_input, '넥스팜', 'assigned', 'published', false);
 insert into public.pms_group_grants(project_slug, group_id, role)
 values(project_slug, '3d615d9d-c1a6-4aa2-8ab1-4335f54ec541', 'viewer'),
       (project_slug, 'e99358b1-8880-4e2e-894f-d42c9d0efdd0', 'editor');
 insert into public.pms_audit(actor, project_slug, action, details)
 values(auth.uid(), project_slug, 'project.save', '{}'::jsonb);
 return jsonb_build_object('slug', project_slug);
end
$$;

create function public.nexpharm_file_audit(p_slug text, p_action text, p_details jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if not coalesce((public.nexpharm_access(p_slug)->>'canManage')::boolean, false) then
   raise insufficient_privilege;
 end if;
 if p_action not in ('workbook.publish','workbook.remove','reference.publish','reference.remove')
   or octet_length(p_details::text) > 4000 then raise invalid_parameter_value; end if;
 insert into public.pms_audit(actor, project_slug, action, details)
 values(auth.uid(), p_slug, p_action, p_details);
end
$$;

revoke all on function pmoffice_private.nexpharm_roles() from public, anon, authenticated;
revoke all on function public.nexpharm_catalog(), public.nexpharm_access(text),
 public.nexpharm_create_project(text), public.nexpharm_file_audit(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.nexpharm_catalog(), public.nexpharm_access(text),
 public.nexpharm_create_project(text), public.nexpharm_file_audit(text,text,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
