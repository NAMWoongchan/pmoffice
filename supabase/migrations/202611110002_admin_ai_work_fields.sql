begin;

alter table pmoffice_private.ai_work_items
  add column priority_rating smallint check (priority_rating between 0 and 5),
  add column fields text[] not null default '{}';

update pmoffice_private.ai_work_items
set priority_rating = case priority when 'high' then 5 when 'low' then 1 else 3 end;

alter table pmoffice_private.ai_work_items alter column priority_rating set not null;
alter table pmoffice_private.ai_work_items alter column priority_rating set default 3;

create table pmoffice_private.ai_work_fields (
  field_key text primary key,
  label text not null check (length(label) between 1 and 80)
);
alter table pmoffice_private.ai_work_fields enable row level security;
revoke all on pmoffice_private.ai_work_fields from public, anon, authenticated;

alter function public.admin_ai_work(text, uuid, integer, jsonb) set schema pmoffice_private;
alter function pmoffice_private.admin_ai_work(text, uuid, integer, jsonb) rename to admin_ai_work_core;
revoke all on function pmoffice_private.admin_ai_work_core(text, uuid, integer, jsonb) from public, anon, authenticated;

create function public.admin_ai_work(
  p_action text,
  p_id uuid default null,
  p_version integer default null,
  p_values jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  item pmoffice_private.ai_work_items%rowtype;
  result jsonb;
  rating smallint;
  labels text[];
begin
  if auth.uid() is null or not coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(), false) then
    raise insufficient_privilege;
  end if;

  if p_action = 'fields' then
    return coalesce((
      select jsonb_agg(f.label order by f.label, f.field_key)
      from pmoffice_private.ai_work_fields f
    ), '[]'::jsonb);
  end if;

  if p_action <> 'save' then
    return pmoffice_private.admin_ai_work_core(p_action, p_id, p_version, p_values);
  end if;

  if p_id is not null then
    select * into item from pmoffice_private.ai_work_items where id = p_id for update;
    if not found or p_version is distinct from item.version then
      raise exception using errcode = '40001', message = 'AI work item has changed';
    end if;
  end if;

  if p_values ? 'priority_rating' then
    if coalesce(p_values->>'priority_rating', '') !~ '^[0-5]$' then
      raise invalid_parameter_value;
    end if;
    rating := (p_values->>'priority_rating')::smallint;
  else
    rating := coalesce(item.priority_rating,
      case p_values->>'priority' when 'high' then 5 when 'low' then 1 else 3 end);
  end if;

  p_values := p_values || jsonb_build_object('priority',
    case when rating >= 4 then 'high' when rating <= 2 then 'low' else 'normal' end);

  if p_values ? 'fields' then
    if jsonb_typeof(p_values->'fields') <> 'array' then raise invalid_parameter_value; end if;
    if jsonb_array_length(p_values->'fields') > 50 or exists (
      select 1 from jsonb_array_elements(p_values->'fields') as v(value)
      where jsonb_typeof(value) <> 'string'
        or length(regexp_replace(value #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g')) not between 1 and 80
    ) then raise invalid_parameter_value; end if;

    select coalesce(array_agg(label order by first_position), '{}') into labels
    from (
      select distinct on (lower(label collate "C")) label, position as first_position
      from (
        select regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g') as label, position
        from jsonb_array_elements_text(p_values->'fields') with ordinality as v(value, position)
      ) trimmed
      order by lower(label collate "C"), position
    ) unique_labels;

    insert into pmoffice_private.ai_work_fields(field_key, label)
    select lower(v.label collate "C"), v.label from unnest(labels) as v(label)
    order by lower(v.label collate "C")
    on conflict (field_key) do nothing;

    select coalesce(array_agg(f.label order by v.position), '{}') into labels
    from unnest(labels) with ordinality as v(label, position)
    join pmoffice_private.ai_work_fields f on f.field_key = lower(v.label collate "C");
  else
    labels := coalesce(item.fields, '{}');
  end if;

  result := pmoffice_private.admin_ai_work_core(p_action, p_id, p_version, p_values);

  update pmoffice_private.ai_work_items
  set priority_rating = rating, fields = labels
  where id = (result->>'id')::uuid;

  return result || jsonb_build_object('priority_rating', rating, 'fields', to_jsonb(labels));
end;
$$;

revoke all on function public.admin_ai_work(text, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.admin_ai_work(text, uuid, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
