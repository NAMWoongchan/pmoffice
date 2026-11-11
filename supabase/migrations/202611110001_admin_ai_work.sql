begin;

create table pmoffice_private.ai_work_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  problem text not null check (length(btrim(problem)) between 1 and 20000),
  expected_result text not null default '',
  references_text text not null default '',
  constraints_text text not null default '',
  acceptance_criteria text not null default '',
  development_plan text not null default '',
  next_step text not null default '',
  status text not null default 'idea'
    check (status in ('idea', 'review', 'planning', 'development', 'done', 'hold')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null,
  updated_by_name text not null,
  archived boolean not null default false,
  version integer not null default 1,
  check (greatest(length(expected_result), length(references_text), length(constraints_text),
    length(acceptance_criteria), length(development_plan), length(next_step)) <= 20000)
);

create index ai_work_items_recent on pmoffice_private.ai_work_items (archived, updated_at desc, id);

create table pmoffice_private.ai_work_events (
  item_id uuid not null references pmoffice_private.ai_work_items(id),
  version integer not null,
  event_type text not null check (event_type in ('created', 'status', 'archived', 'restored')),
  previous_status text,
  status text not null,
  occurred_at timestamptz not null,
  actor_name text not null,
  actor_id uuid not null,
  primary key (item_id, version)
);

alter table pmoffice_private.ai_work_items enable row level security;
alter table pmoffice_private.ai_work_events enable row level security;
revoke all on pmoffice_private.ai_work_items, pmoffice_private.ai_work_events from public, anon, authenticated;

create function public.admin_ai_work(
  p_action text,
  p_id uuid default null,
  p_version integer default null,
  p_values jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  item pmoffice_private.ai_work_items%rowtype;
  previous_status text;
  event_type text;
  actor_name text;
  actor_id uuid := auth.uid();
  changed_at timestamptz;
begin
  if actor_id is null or not coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(), false) then
    raise insufficient_privilege;
  end if;

  if p_action = 'list' then
    return coalesce((
      select jsonb_agg(to_jsonb(i) order by i.updated_at desc, i.id)
      from pmoffice_private.ai_work_items i
      where i.archived = coalesce((p_values->>'archived')::boolean, false)
    ), '[]'::jsonb);
  end if;

  if p_action = 'get' then
    select * into item from pmoffice_private.ai_work_items where id = p_id;
    if not found then return null; end if;
  elsif p_action in ('save', 'archive', 'restore') then
    select coalesce(nullif(btrim(p.display_name), ''), '시스템 관리자') into actor_name
    from public.profiles p where p.id = actor_id;
    actor_name := coalesce(actor_name, '시스템 관리자');

    if p_id is not null then
      select * into item from pmoffice_private.ai_work_items where id = p_id for update;
      if not found or p_version is distinct from item.version then
        raise exception using errcode = '40001', message = 'AI work item has changed';
      end if;
      previous_status := item.status;
    elsif p_action <> 'save' then
      raise invalid_parameter_value;
    end if;

    if p_action = 'save' then
      if item.archived then raise invalid_parameter_value; end if;
      if p_id is null then
        changed_at := clock_timestamp();
        insert into pmoffice_private.ai_work_items (
          title, problem, status, priority, expected_result, references_text, constraints_text,
          acceptance_criteria, development_plan, next_step, updated_by, updated_by_name, created_at, updated_at
        ) values (
          btrim(p_values->>'title'), btrim(p_values->>'problem'), coalesce(p_values->>'status', 'idea'),
          coalesce(p_values->>'priority', 'normal'), coalesce(p_values->>'expected_result', ''),
          coalesce(p_values->>'references_text', ''), coalesce(p_values->>'constraints_text', ''),
          coalesce(p_values->>'acceptance_criteria', ''), coalesce(p_values->>'development_plan', ''),
          coalesce(p_values->>'next_step', ''), actor_id, actor_name, changed_at, changed_at
        ) returning * into item;
        event_type := 'created';
      else
        update pmoffice_private.ai_work_items set
          title = btrim(p_values->>'title'),
          problem = btrim(p_values->>'problem'),
          status = p_values->>'status',
          priority = p_values->>'priority',
          expected_result = coalesce(p_values->>'expected_result', ''),
          references_text = coalesce(p_values->>'references_text', ''),
          constraints_text = coalesce(p_values->>'constraints_text', ''),
          acceptance_criteria = coalesce(p_values->>'acceptance_criteria', ''),
          development_plan = coalesce(p_values->>'development_plan', ''),
          next_step = coalesce(p_values->>'next_step', ''),
          updated_at = clock_timestamp(),
          updated_by = actor_id,
          updated_by_name = actor_name,
          version = version + 1
        where id = p_id returning * into item;
        if previous_status <> item.status then event_type := 'status'; end if;
      end if;
    else
      if item.archived = (p_action = 'archive') then raise invalid_parameter_value; end if;
      update pmoffice_private.ai_work_items set
        archived = (p_action = 'archive'),
        updated_at = clock_timestamp(),
        updated_by = actor_id,
        updated_by_name = actor_name,
        version = version + 1
      where id = p_id returning * into item;
      event_type := case when item.archived then 'archived' else 'restored' end;
    end if;

    if event_type is not null then
      insert into pmoffice_private.ai_work_events
        (item_id, version, event_type, previous_status, status, occurred_at, actor_name, actor_id)
      values (item.id, item.version, event_type, previous_status, item.status, item.updated_at, actor_name, actor_id);
    end if;
  else
    raise invalid_parameter_value;
  end if;

  return to_jsonb(item) || jsonb_build_object('events', coalesce((
    select jsonb_agg(to_jsonb(e) order by e.version desc)
    from pmoffice_private.ai_work_events e where e.item_id = item.id
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.admin_ai_work(text, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.admin_ai_work(text, uuid, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
