begin;

create table pmoffice_private.ai_work_prompts (
  id uuid primary key,
  item_id uuid not null references pmoffice_private.ai_work_items(id),
  body text not null check (length(btrim(body)) between 1 and 160000),
  memo text not null default '' check (length(memo) <= 20000),
  created_at timestamptz not null default clock_timestamp(),
  version integer not null default 1
);
create index ai_work_prompts_item_created on pmoffice_private.ai_work_prompts(item_id, created_at desc, id);
alter table pmoffice_private.ai_work_prompts enable row level security;
revoke all on pmoffice_private.ai_work_prompts from public, anon, authenticated;

create function public.admin_ai_work_prompts(
  p_action text, p_item_id uuid, p_id uuid default null, p_version integer default null,
  p_body text default null, p_memo text default '', p_created_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prompt pmoffice_private.ai_work_prompts%rowtype;
  is_archived boolean;
begin
  if auth.uid() is null or not coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(), false) then
    raise insufficient_privilege;
  end if;

  if p_action = 'list' then
    return coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id)
      from pmoffice_private.ai_work_prompts p where p.item_id = p_item_id
    ), '[]'::jsonb);
  end if;

  if p_action is distinct from 'save' or p_id is null then raise invalid_parameter_value; end if;
  select i.archived into is_archived from pmoffice_private.ai_work_items i
    where i.id = p_item_id for update;
  if not found or is_archived then raise invalid_parameter_value; end if;

  if p_version is null then
    insert into pmoffice_private.ai_work_prompts (id, item_id, body, memo, created_at)
      values (p_id, p_item_id, p_body, coalesce(p_memo, ''), least(p_created_at, clock_timestamp()))
      on conflict (id) do nothing returning * into prompt;
    if not found then
      select * into prompt from pmoffice_private.ai_work_prompts p where p.id = p_id and p.item_id = p_item_id;
      if not found or prompt.body is distinct from p_body or prompt.memo is distinct from coalesce(p_memo, '') then
        raise exception using errcode = '40001', message = 'AI work prompt has changed';
      end if;
    end if;
  else
    update pmoffice_private.ai_work_prompts p
      set body = p_body, memo = coalesce(p_memo, ''), version = p.version + 1
      where p.id = p_id and p.item_id = p_item_id and p.version = p_version
      returning * into prompt;
    if not found then raise exception using errcode = '40001', message = 'AI work prompt has changed'; end if;
  end if;

  return to_jsonb(prompt);
end;
$$;

revoke all on function public.admin_ai_work_prompts(text, uuid, uuid, integer, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_ai_work_prompts(text, uuid, uuid, integer, text, text, timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
