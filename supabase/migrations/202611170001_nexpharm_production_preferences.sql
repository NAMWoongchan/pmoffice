begin;

alter table pmoffice_private.nexpharm_schedule_layout add column common_revision bigint not null default 0;
create sequence pmoffice_private.nexpharm_layout_revision;
create table pmoffice_private.nexpharm_production_template (
  template text primary key check (template = 'production_outsourcing'),
  source_project text not null references public.pms_projects(slug),
  revision bigint not null,
  layout jsonb not null,
  settings jsonb not null,
  updated_at timestamptz not null default now()
);
create table pmoffice_private.nexpharm_production_common (
  project_slug text primary key references public.pms_projects(slug) on delete cascade,
  revision bigint not null,
  layout jsonb not null
);
alter table pmoffice_private.nexpharm_production_template enable row level security;
alter table pmoffice_private.nexpharm_production_common enable row level security;
revoke all on pmoffice_private.nexpharm_production_template, pmoffice_private.nexpharm_production_common from public, anon, authenticated;

insert into pmoffice_private.nexpharm_production_template(template, source_project, revision, layout, settings)
values ('production_outsourcing', 'nexpharm-8088c44595a3', 0,
  '{"fields":[{"key":"id","width":52,"visible":true},{"key":"name","width":260,"visible":true},{"key":"code","width":144,"visible":true},{"key":"lot","width":70,"visible":true},{"key":"quantity","width":88,"visible":true},{"key":"duration","width":64,"visible":true},{"key":"hours","width":90,"visible":true},{"key":"start","width":100,"visible":true},{"key":"finish","width":100,"visible":true},{"key":"resource","width":214,"visible":true},{"key":"predecessor","width":96,"visible":true},{"key":"unit","width":86,"visible":true},{"key":"category","width":90,"visible":true},{"key":"contractor","width":112,"visible":true},{"key":"notes","width":180,"visible":true}],"ganttVisible":true,"ganttWidth":60}',
  '{"navigation":["schedule","calendar","files","project_info"],"defaultOutline":1,"defaultTimescale":"day","timescales":["day","week"],"weekStartsOn":"monday","calendar":"workbook","taskPane":"adjacent","quantityAlignment":"right","hoursAlignment":"right","dateAlignment":"right","hoursDecimals":1,"titleScale":2}');

create function pmoffice_private.nexpharm_inherit_production_layout() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.template = 'production_outsourcing' then
    insert into pmoffice_private.nexpharm_production_common(project_slug, revision, layout)
    select new.slug, revision, layout from pmoffice_private.nexpharm_production_template where template = new.template
    on conflict (project_slug) do nothing;
  end if;
  return new;
end
$$;
create trigger nexpharm_inherit_production_layout after insert on pmoffice_private.nexpharm_registration
for each row execute function pmoffice_private.nexpharm_inherit_production_layout();

create function pmoffice_private.nexpharm_validate_production_layout(layout jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  field jsonb; key text;
  clean jsonb := '[]'::jsonb;
  allowed text[] := array['id','name','code','lot','quantity','duration','hours','start','finish','resource','predecessor','unit','category','contractor','notes'];
  seen text[] := array[]::text[];
  title text;
begin
  if jsonb_typeof(layout) is distinct from 'object' or pg_column_size(layout) > 12000
    or jsonb_typeof(layout->'fields') is distinct from 'array'
    or jsonb_typeof(layout->'ganttVisible') is distinct from 'boolean'
    or jsonb_typeof(layout->'ganttWidth') is distinct from 'number'
    or (layout->>'ganttWidth') !~ '^[0-9]{2,3}$' then raise invalid_parameter_value; end if;
  if jsonb_array_length(layout->'fields') <> cardinality(allowed)
    or (layout->>'ganttWidth')::integer not between 36 and 180 then raise invalid_parameter_value; end if;
  for field in select value from jsonb_array_elements(layout->'fields') loop
    key := field->>'key';
    title := null;
    if key is null or not (key = any(allowed)) or key = any(seen)
      or jsonb_typeof(field->'visible') is distinct from 'boolean'
      or (key = 'name' and field->>'visible' is distinct from 'true')
      or jsonb_typeof(field->'width') is distinct from 'number'
      or (field->>'width') !~ '^[0-9]{2,3}$' then raise invalid_parameter_value; end if;
    if (field->>'width')::integer not between 48 and 600 then raise invalid_parameter_value; end if;
    if field ? 'title' then
      title := btrim(field->>'title');
      if jsonb_typeof(field->'title') is distinct from 'string' or char_length(title) not between 1 and 80
        or title ~ '[[:cntrl:]]' then raise invalid_parameter_value; end if;
    end if;
    clean := clean || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'key', key, 'width', field->'width', 'visible', field->'visible', 'title', title)));
    seen := array_append(seen, key);
  end loop;
  return jsonb_build_object('fields', clean, 'ganttVisible', layout->'ganttVisible', 'ganttWidth', layout->'ganttWidth');
end
$$;

create function public.nexpharm_schedule_preferences(p_slug text, p_action text default 'read',
  p_layout jsonb default null, p_revision bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid(); access jsonb; system_admin boolean;
  common jsonb; effective jsonb; revision_id bigint; source text;
begin
  access := public.nexpharm_access(p_slug);
  if viewer is null or access->>'canRead' is distinct from 'true'
    or access#>>'{project,status}' is distinct from 'published'
    or access#>>'{project,template}' is distinct from 'production_outsourcing' then raise insufficient_privilege; end if;
  system_admin := coalesce(pmoffice_private.is_admin(), false) and coalesce(pmoffice_private.account_ok(), false);
  if p_action is null or p_action not in ('read', 'personal', 'global') then raise invalid_parameter_value; end if;
  if p_action = 'global' and not system_admin then raise insufficient_privilege; end if;
  if p_action <> 'read' then perform pg_advisory_xact_lock(hashtextextended('nexpharm-layout:' || p_slug, 0)); end if;
  select source_project into source from pmoffice_private.nexpharm_production_template where template = 'production_outsourcing';
  select c.layout, c.revision into common, revision_id from pmoffice_private.nexpharm_production_common c where c.project_slug = p_slug;
  if not found then
    select t.layout, t.revision into common, revision_id from pmoffice_private.nexpharm_production_template t
      where t.template = 'production_outsourcing';
  end if;
  if p_action <> 'read' then
    if p_revision is distinct from revision_id then raise serialization_failure; end if;
    effective := pmoffice_private.nexpharm_validate_production_layout(p_layout);
    if p_action = 'global' then
      revision_id := nextval('pmoffice_private.nexpharm_layout_revision');
      common := effective;
      insert into pmoffice_private.nexpharm_production_common(project_slug, revision, layout)
      values (p_slug, revision_id, common)
      on conflict (project_slug) do update set revision = excluded.revision, layout = excluded.layout;
      if p_slug = source then
        update pmoffice_private.nexpharm_production_template set revision = revision_id, layout = common, updated_at = now()
        where template = 'production_outsourcing';
      end if;
      insert into public.pms_audit (actor, project_slug, action, details)
      values (viewer, p_slug, 'schedule.layout.global', jsonb_build_object('revision', revision_id));
    else
      insert into pmoffice_private.nexpharm_schedule_layout(user_id, project_slug, layout, common_revision)
      values (viewer, p_slug, effective, revision_id)
      on conflict (user_id, project_slug) do update set layout = excluded.layout, common_revision = excluded.common_revision;
    end if;
  else
    select layout into effective from pmoffice_private.nexpharm_schedule_layout
      where user_id = viewer and project_slug = p_slug and common_revision = revision_id;
  end if;
  return jsonb_build_object('layout', coalesce(effective, common), 'common', common,
    'revision', revision_id, 'canApplyGlobal', system_admin);
end
$$;

-- Existing cached viewers can still read the same effective layout while the new viewer rolls out.
create or replace function public.nexpharm_schedule_layout(p_slug text, p_layout jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare settings jsonb;
begin
  settings := public.nexpharm_schedule_preferences(p_slug);
  if p_layout is not null then
    settings := public.nexpharm_schedule_preferences(p_slug, 'personal', p_layout, (settings->>'revision')::bigint);
  end if;
  return settings->'layout';
end
$$;

revoke all on function public.nexpharm_schedule_preferences(text,text,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.nexpharm_schedule_preferences(text,text,jsonb,bigint) to authenticated;
commit;
