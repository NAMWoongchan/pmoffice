begin;

create table pmoffice_private.nexpharm_registration (
  slug text primary key references public.pms_projects(slug),
  actor uuid not null
);
create table pmoffice_private.nexpharm_comment (
  id bigint generated always as identity primary key,
  slug text not null references public.pms_projects(slug),
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index on pmoffice_private.nexpharm_comment (slug, id desc);
create table pmoffice_private.nexpharm_post (
  id bigint generated always as identity primary key,
  author text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);
alter table pmoffice_private.nexpharm_registration enable row level security;
alter table pmoffice_private.nexpharm_comment enable row level security;
alter table pmoffice_private.nexpharm_post enable row level security;
revoke all on pmoffice_private.nexpharm_registration, pmoffice_private.nexpharm_comment,
  pmoffice_private.nexpharm_post from public, anon, authenticated;

-- The file endpoint uses this same gate. Only the manager preparing a draft
-- may upload to it, while the catalog continues to expose published rows only.
create or replace function public.nexpharm_access(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'canRead', r.can_read and p.slug is not null,
    'canManage', r.can_manage and p.slug is not null,
    'project', case when r.can_read and p.slug is not null then
      jsonb_build_object('slug', p.slug, 'title', p.title, 'description', p.description,
        'version', p.version, 'status', p.status) end)
  from pmoffice_private.nexpharm_roles() r
  left join public.pms_projects p on p.slug = p_slug and p.slug ~ '^nexpharm-[0-9a-f]{12}$'
    and (p.status = 'published' or (p.status = 'draft' and r.can_manage and exists (
      select 1 from pmoffice_private.nexpharm_registration d where d.slug = p.slug and d.actor = auth.uid())))
$$;

create or replace function public.nexpharm_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('canRead', r.can_read, 'canManage', r.can_manage,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('slug', p.slug, 'title', p.title,
        'description', p.description, 'version', p.version, 'comment', c.body) order by p.title, p.slug)
      from public.pms_projects p
      left join lateral (
        select body from pmoffice_private.nexpharm_comment where slug = p.slug order by id desc limit 1
      ) c on true
      where r.can_read and p.slug ~ '^nexpharm-[0-9a-f]{12}$' and p.status = 'published'
    ), '[]'::jsonb))
  from pmoffice_private.nexpharm_roles() r
$$;

create function public.nexpharm_prepare_project(p_title text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare title_input text := btrim(p_title); s text;
begin
  if not (select can_manage from pmoffice_private.nexpharm_roles()) then raise insufficient_privilege; end if;
  if title_input is null or length(title_input) not between 1 and 160 then raise invalid_parameter_value; end if;
  perform pg_advisory_xact_lock(hashtextextended('nexpharm:' || lower(title_input), 0));
  if exists (select 1 from public.pms_projects p where p.slug ~ '^nexpharm-[0-9a-f]{12}$'
    and p.status = 'published' and lower(p.title) = lower(title_input)) then
    raise exception '이미 사용 중인 프로젝트 이름입니다.' using errcode = '23505';
  end if;
  select p.slug into s from public.pms_projects p join pmoffice_private.nexpharm_registration d on d.slug = p.slug
    where p.status = 'draft' and d.actor = auth.uid() and lower(p.title) = lower(title_input)
    order by p.slug limit 1;
  if not found then
    s := 'nexpharm-' || left(replace(gen_random_uuid()::text, '-', ''), 12);
    insert into public.pms_projects(slug, title, customer, access_mode, status, listed)
      values(s, title_input, '넥스팜', 'assigned', 'draft', false);
    insert into pmoffice_private.nexpharm_registration values(s, auth.uid());
  end if;
  return jsonb_build_object('slug', s);
end
$$;

create function public.nexpharm_publish_project(p_slug text, p_etag text) returns void
language plpgsql security definer set search_path = '' as $$
declare title_input text; project_status text; latest_file jsonb; latest_action text;
begin
  if not (select can_manage from pmoffice_private.nexpharm_roles()) or not exists (
    select 1 from pmoffice_private.nexpharm_registration where slug = p_slug and actor = auth.uid()
  ) then raise insufficient_privilege; end if;
  select title into title_input from public.pms_projects where slug = p_slug;
  perform pg_advisory_xact_lock(hashtextextended('nexpharm:' || lower(title_input), 0));
  select status into project_status from public.pms_projects where slug = p_slug for update;
  if project_status = 'published' then return; end if;
  if project_status is distinct from 'draft' then raise invalid_parameter_value; end if;
  select action, details into latest_action, latest_file from public.pms_audit
    where project_slug = p_slug and action in ('workbook.publish', 'workbook.remove') order by id desc limit 1;
  if latest_action is distinct from 'workbook.publish' or latest_file->>'blob' is distinct from p_etag
    or p_etag is null then raise exception '엑셀 등록을 확인할 수 없습니다.' using errcode = '40001'; end if;
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

create function pmoffice_private.nexpharm_author() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select nullif(btrim(display_name), '') from public.profiles where id = auth.uid()), '넥스팜 회원')
$$;
revoke all on function pmoffice_private.nexpharm_author() from public, anon, authenticated;

create function public.nexpharm_comments(p_slug text, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce((public.nexpharm_access(p_slug)->>'canRead')::boolean, false)
    or not exists (select 1 from public.pms_projects where slug = p_slug and status = 'published')
    then raise insufficient_privilege; end if;
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.id desc) from (
    select id, author, body, created_at from pmoffice_private.nexpharm_comment
    where slug = p_slug and (p_before is null or id < p_before) order by id desc limit 25
  ) c), '[]'::jsonb);
end
$$;
create function public.nexpharm_add_comment(p_slug text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((public.nexpharm_access(p_slug)->>'canRead')::boolean, false)
    or not exists (select 1 from public.pms_projects where slug = p_slug and status = 'published')
    then raise insufficient_privilege; end if;
  if p_body is null or length(btrim(p_body)) not between 1 and 12000 then raise invalid_parameter_value; end if;
  insert into pmoffice_private.nexpharm_comment(slug, author, body)
    values(p_slug, pmoffice_private.nexpharm_author(), p_body);
end
$$;

create function public.nexpharm_posts(p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select can_read from pmoffice_private.nexpharm_roles()) then raise insufficient_privilege; end if;
  return coalesce((select jsonb_agg(to_jsonb(p) order by p.id desc) from (
    select id, author, title, body, created_at from pmoffice_private.nexpharm_post
    where p_before is null or id < p_before order by id desc limit 25
  ) p), '[]'::jsonb);
end
$$;
create function public.nexpharm_add_post(p_title text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (select can_read from pmoffice_private.nexpharm_roles()) then raise insufficient_privilege; end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 160
    or p_body is null or length(btrim(p_body)) not between 1 and 6000 then raise invalid_parameter_value; end if;
  insert into pmoffice_private.nexpharm_post(author, title, body)
    values(pmoffice_private.nexpharm_author(), btrim(p_title), btrim(p_body));
end
$$;
revoke all on function public.nexpharm_prepare_project(text), public.nexpharm_publish_project(text,text),
  public.nexpharm_comments(text,bigint), public.nexpharm_add_comment(text,text),
  public.nexpharm_posts(bigint), public.nexpharm_add_post(text,text) from public, anon, authenticated;
grant execute on function public.nexpharm_prepare_project(text), public.nexpharm_publish_project(text,text),
  public.nexpharm_comments(text,bigint), public.nexpharm_add_comment(text,text),
  public.nexpharm_posts(bigint), public.nexpharm_add_post(text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
