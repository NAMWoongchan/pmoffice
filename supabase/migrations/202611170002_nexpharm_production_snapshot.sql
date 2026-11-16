begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nexpharm-production-originals', 'nexpharm-production-originals', false, 8388608, array['application/octet-stream'])
on conflict (id) do nothing;

create table pmoffice_private.nexpharm_production_version (
  id bigint generated always as identity primary key,
  project_slug text not null references public.pms_projects(slug) on delete cascade,
  active boolean not null,
  meta jsonb,
  schedule jsonb,
  original_path text,
  saved_at timestamptz not null default now(),
  check ((meta is null and schedule is null and original_path is null) or
         (meta is not null and schedule is not null and original_path is not null))
);
create unique index nexpharm_one_production_version on pmoffice_private.nexpharm_production_version(project_slug) where active;
alter table pmoffice_private.nexpharm_production_version enable row level security;
revoke all on pmoffice_private.nexpharm_production_version from public, anon, authenticated;

create function public.nexpharm_production_snapshot(p_slug text, p_meta_only boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare access jsonb; result jsonb;
begin
  access := public.nexpharm_access(p_slug);
  if auth.uid() is null or access->>'canRead' is distinct from 'true'
     or access#>>'{project,template}' is distinct from 'production_outsourcing' then raise insufficient_privilege; end if;
  select jsonb_build_object(
    'current', case when access->>'canManage' = 'true' then v.meta else v.meta - 'sha256' end,
    'canManage', access->>'canManage' = 'true',
    'schedule', case when p_meta_only then null else v.schedule end
  ) into result from pmoffice_private.nexpharm_production_version v where v.project_slug = p_slug and v.active;
  return result;
end
$$;

create function public.nexpharm_production_original_path(p_slug text, p_etag text) returns text
language sql stable security definer set search_path = '' as $$
  select original_path from pmoffice_private.nexpharm_production_version
  where project_slug = p_slug and active and (meta->>'etag') = p_etag
$$;

create function public.nexpharm_commit_production_snapshot(p_slug text, p_actor uuid, p_expected text,
  p_meta jsonb, p_schedule jsonb, p_path text, p_backfill boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  current_etag text; project_status text; reg pmoffice_private.nexpharm_registration%rowtype;
  recorded_etag text := p_meta->>'etag';
  initialized boolean;
begin
  if p_actor is null then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended('nexpharm-snapshot:' || p_slug, 0));
  select * into reg from pmoffice_private.nexpharm_registration where slug = p_slug;
  select status into project_status from public.pms_projects where slug = p_slug;
  if reg.template is distinct from 'production_outsourcing'
    or project_status is null or project_status not in ('published', 'draft') then raise invalid_parameter_value; end if;
  if project_status = 'draft' and (p_actor is distinct from reg.actor
    or p_meta is null or p_meta->>'sha256' is distinct from reg.source_sha256) then raise insufficient_privilege; end if;
  select meta->>'etag' into current_etag from pmoffice_private.nexpharm_production_version
    where project_slug = p_slug and active for update;
  initialized := found;
  if coalesce(current_etag, 'seed') is distinct from p_expected or (p_backfill and initialized) then raise serialization_failure; end if;
  if p_meta is not null then
    if jsonb_typeof(p_meta) is distinct from 'object' or recorded_etag is null or recorded_etag !~ '^[0-9a-f]{40,64}$'
      or coalesce(p_meta->>'sha256', '') !~ '^[0-9a-f]{64}$'
      or p_path is distinct from (p_slug || '/' || recorded_etag)
      or jsonb_typeof(p_schedule->'days') is distinct from 'array'
      or jsonb_typeof(p_schedule->'tasks') is distinct from 'array' then raise invalid_parameter_value; end if;
  elsif p_schedule is not null or p_path is not null or p_backfill then raise invalid_parameter_value;
  end if;
  update pmoffice_private.nexpharm_production_version set active = false where project_slug = p_slug and active;
  insert into pmoffice_private.nexpharm_production_version(project_slug, active, meta, schedule, original_path)
    values(p_slug, true, p_meta, p_schedule, p_path);
  if project_status = 'draft' then
    update pmoffice_private.nexpharm_registration set file_etag = recorded_etag where slug = p_slug;
  end if;
  insert into public.pms_audit(actor, project_slug, action, details)
    values(p_actor, p_slug, case when p_backfill then 'workbook.backfill' when p_meta is null then 'workbook.remove' else 'workbook.publish' end,
      jsonb_strip_nulls(jsonb_build_object('blob', recorded_etag, 'previous', current_etag,
        'name', p_meta->>'name', 'size', p_meta->'size')));
  return recorded_etag;
end
$$;

revoke all on function public.nexpharm_production_snapshot(text,boolean) from public, anon, authenticated;
grant execute on function public.nexpharm_production_snapshot(text,boolean) to authenticated;
revoke all on function public.nexpharm_production_original_path(text,text),
  public.nexpharm_commit_production_snapshot(text,uuid,text,jsonb,jsonb,text,boolean) from public, anon, authenticated;
grant execute on function public.nexpharm_production_original_path(text,text),
  public.nexpharm_commit_production_snapshot(text,uuid,text,jsonb,jsonb,text,boolean) to service_role;
commit;
