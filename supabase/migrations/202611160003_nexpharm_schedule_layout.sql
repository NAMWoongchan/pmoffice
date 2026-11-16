begin;

create table pmoffice_private.nexpharm_schedule_layout (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_slug text not null references public.pms_projects(slug) on delete cascade,
  layout jsonb not null,
  primary key (user_id, project_slug)
);
alter table pmoffice_private.nexpharm_schedule_layout enable row level security;
revoke all on pmoffice_private.nexpharm_schedule_layout from public, anon, authenticated;

create function public.nexpharm_schedule_layout(p_slug text, p_layout jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  viewer uuid := auth.uid();
  access jsonb;
  saved jsonb;
  field jsonb;
  field_name text;
  keys text[] := array['id','name','code','lot','quantity','duration','hours','start','finish',
    'resource','predecessor','unit','category','contractor','notes'];
  seen text[] := array[]::text[];
begin
  if viewer is null or p_slug is distinct from 'nexpharm-8088c44595a3' then
    raise insufficient_privilege;
  end if;
  access := public.nexpharm_access(p_slug);
  if (access->>'canRead') is distinct from 'true'
     or (access#>>'{project,status}') is distinct from 'published'
     or (access#>>'{project,template}') is distinct from 'production_outsourcing' then
    raise insufficient_privilege;
  end if;
  if p_layout is null then
    select layout into saved from pmoffice_private.nexpharm_schedule_layout
      where user_id = viewer and project_slug = p_slug;
    return saved;
  end if;
  if jsonb_typeof(p_layout) is distinct from 'object' or pg_column_size(p_layout) > 4096
     or jsonb_typeof(p_layout->'fields') is distinct from 'array'
     or jsonb_typeof(p_layout->'ganttVisible') is distinct from 'boolean'
     or jsonb_typeof(p_layout->'ganttWidth') is distinct from 'number'
     or (p_layout->>'ganttWidth') !~ '^[0-9]{2,3}$' then
    raise exception 'Invalid schedule layout' using errcode = '22023';
  end if;
  if jsonb_array_length(p_layout->'fields') <> cardinality(keys)
     or (p_layout->>'ganttWidth')::integer not between 36 and 180 then
    raise exception 'Invalid schedule layout' using errcode = '22023';
  end if;
  for field in select value from jsonb_array_elements(p_layout->'fields') loop
    field_name := field->>'key';
    if field_name is null or not (field_name = any(keys)) or field_name = any(seen)
       or jsonb_typeof(field->'visible') is distinct from 'boolean'
       or (field_name = 'name' and (field->>'visible') is distinct from 'true')
       or jsonb_typeof(field->'width') is distinct from 'number'
       or (field->>'width') !~ '^[0-9]{2,3}$' then
      raise exception 'Invalid schedule column' using errcode = '22023';
    end if;
    if (field->>'width')::integer not between 48 and 600 then
      raise exception 'Invalid schedule column width' using errcode = '22023';
    end if;
    seen := array_append(seen, field_name);
  end loop;
  insert into pmoffice_private.nexpharm_schedule_layout (user_id, project_slug, layout)
    values (viewer, p_slug, p_layout)
    on conflict (user_id, project_slug) do update set layout = excluded.layout
    returning layout into saved;
  return saved;
end;
$$;

revoke all on function public.nexpharm_schedule_layout(text,jsonb) from public, anon, authenticated;
grant execute on function public.nexpharm_schedule_layout(text,jsonb) to authenticated;

commit;
