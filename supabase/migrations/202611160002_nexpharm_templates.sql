begin;

alter table pmoffice_private.nexpharm_registration
  add column template text not null default 'rd' check (template in ('rd', 'production_outsourcing')),
  add column source_sha256 text check (source_sha256 ~ '^[0-9a-f]{64}$'),
  add column file_etag text;

create or replace function public.nexpharm_access(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'canRead', r.can_read and p.slug is not null,
    'canManage', r.can_manage and p.slug is not null,
    'project', case when r.can_read and p.slug is not null then
      jsonb_build_object('slug', p.slug, 'title', p.title, 'description', p.description,
        'version', p.version, 'status', p.status, 'template', coalesce(d.template, 'rd'),
        'sourceSha256', case when p.status = 'draft' then d.source_sha256 end) end)
  from pmoffice_private.nexpharm_roles() r
  left join public.pms_projects p on p.slug = p_slug and p.slug ~ '^nexpharm-[0-9a-f]{12}$'
    and (p.status = 'published' or (p.status = 'draft' and r.can_manage and exists (
      select 1 from pmoffice_private.nexpharm_registration d where d.slug = p.slug and d.actor = auth.uid())))
  left join pmoffice_private.nexpharm_registration d on d.slug = p.slug
$$;

create or replace function public.nexpharm_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('canRead', r.can_read, 'canManage', r.can_manage,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('slug', p.slug, 'title', p.title,
        'description', p.description, 'version', p.version, 'comment', c.body,
        'template', coalesce(d.template, 'rd')) order by p.title, p.slug)
      from public.pms_projects p
      left join pmoffice_private.nexpharm_registration d on d.slug = p.slug
      left join lateral (
        select body from pmoffice_private.nexpharm_comment where slug = p.slug order by id desc limit 1
      ) c on true
      where r.can_read and p.slug ~ '^nexpharm-[0-9a-f]{12}$' and p.status = 'published'
    ), '[]'::jsonb))
  from pmoffice_private.nexpharm_roles() r
$$;

create function public.nexpharm_member_entry() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(pmoffice_private.account_ok(), false) and exists (
    select 1 from public.pms_group_members m join public.pms_groups g on g.id = m.group_id
    where m.user_id = auth.uid() and m.active and g.active
      and m.group_id in ('3d615d9d-c1a6-4aa2-8ab1-4335f54ec541', 'e99358b1-8880-4e2e-894f-d42c9d0efdd0')
      and (m.expires_at is null or m.expires_at > now())
  )
$$;

create function public.nexpharm_prepare_typed_project(p_title text, p_template text, p_sha256 text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare title_input text := btrim(p_title); s text; same_file boolean;
begin
  if not (select can_manage from pmoffice_private.nexpharm_roles()) then raise insufficient_privilege; end if;
  if title_input is null or length(title_input) not between 1 and 160
     or p_template is null or p_template not in ('rd', 'production_outsourcing')
     or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise invalid_parameter_value; end if;
  perform pg_advisory_xact_lock(hashtextextended('nexpharm:' || lower(title_input), 0));
  select p.slug, coalesce(d.template = p_template and d.source_sha256 = p_sha256, false)
    into s, same_file
    from public.pms_projects p left join pmoffice_private.nexpharm_registration d on d.slug = p.slug
    where p.slug ~ '^nexpharm-[0-9a-f]{12}$' and p.status = 'published'
      and lower(p.title) = lower(title_input);
  if found then
    if same_file then return jsonb_build_object('slug', s, 'published', true); end if;
    raise exception '이미 사용 중인 프로젝트 이름입니다.' using errcode = '23505';
  end if;
  select p.slug into s from public.pms_projects p join pmoffice_private.nexpharm_registration d on d.slug = p.slug
    where p.status = 'draft' and d.actor = auth.uid() and lower(p.title) = lower(title_input)
      and d.template = p_template and d.source_sha256 = p_sha256 order by p.slug limit 1;
  if not found then
    s := 'nexpharm-' || left(replace(gen_random_uuid()::text, '-', ''), 12);
    insert into public.pms_projects(slug, title, customer, access_mode, status, listed)
      values(s, title_input, '넥스팜', 'assigned', 'draft', false);
    insert into pmoffice_private.nexpharm_registration(slug, actor, template, source_sha256)
      values(s, auth.uid(), p_template, p_sha256);
  end if;
  return jsonb_build_object('slug', s, 'published', false);
end
$$;

create function public.nexpharm_record_typed_upload(p_slug text, p_sha256 text, p_etag text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_etag is null or p_etag !~ '^[0-9a-f]{40,64}$' then raise invalid_parameter_value; end if;
  update pmoffice_private.nexpharm_registration d set file_etag = p_etag
  from public.pms_projects p
  where p.slug = d.slug and d.slug = p_slug and p.status = 'draft'
    and d.source_sha256 = p_sha256;
  if not found then raise invalid_parameter_value; end if;
end
$$;

create or replace function public.nexpharm_publish_project(p_slug text, p_etag text) returns void
language plpgsql security definer set search_path = '' as $$
declare title_input text; project_status text; latest_file jsonb; latest_action text;
        source_digest text; confirmed_etag text;
begin
  if not (select can_manage from pmoffice_private.nexpharm_roles()) then raise insufficient_privilege; end if;
  select source_sha256, file_etag into source_digest, confirmed_etag
    from pmoffice_private.nexpharm_registration where slug = p_slug and actor = auth.uid();
  if not found then raise insufficient_privilege; end if;
  select title into title_input from public.pms_projects where slug = p_slug;
  perform pg_advisory_xact_lock(hashtextextended('nexpharm:' || lower(title_input), 0));
  select status into project_status from public.pms_projects where slug = p_slug for update;
  if project_status = 'published' then return; end if;
  if project_status is distinct from 'draft' then raise invalid_parameter_value; end if;
  select action, details into latest_action, latest_file from public.pms_audit
    where project_slug = p_slug and action in ('workbook.publish', 'workbook.remove') order by id desc limit 1;
  if p_etag is null or latest_action is distinct from 'workbook.publish' or latest_file->>'blob' is distinct from p_etag
    or (source_digest is not null and confirmed_etag is distinct from p_etag) then
      raise exception '엑셀 등록을 확인할 수 없습니다.' using errcode = '40001';
  end if;
  if exists (select 1 from public.pms_projects p where p.slug ~ '^nexpharm-[0-9a-f]{12}$'
    and p.status = 'published' and lower(p.title) = lower(title_input)) then
    raise exception '이미 사용 중인 프로젝트 이름입니다.' using errcode = '23505';
  end if;
  insert into public.pms_group_grants(project_slug, group_id, role)
    values(p_slug, '3d615d9d-c1a6-4aa2-8ab1-4335f54ec541', 'viewer'),
          (p_slug, 'e99358b1-8880-4e2e-894f-d42c9d0efdd0', 'editor');
  update public.pms_projects set status = 'published', updated_at = now() where slug = p_slug;
  insert into public.pms_audit(actor, project_slug, action, details)
    values(auth.uid(), p_slug, 'project.save', jsonb_build_object('workbook', p_etag));
end
$$;

revoke all on function public.nexpharm_member_entry(), public.nexpharm_prepare_typed_project(text,text,text)
  from public, anon, authenticated;
grant execute on function public.nexpharm_member_entry(), public.nexpharm_prepare_typed_project(text,text,text) to authenticated;
revoke all on function public.nexpharm_record_typed_upload(text,text,text) from public, anon, authenticated;
grant execute on function public.nexpharm_record_typed_upload(text,text,text) to service_role;
notify pgrst, 'reload schema';
commit;
