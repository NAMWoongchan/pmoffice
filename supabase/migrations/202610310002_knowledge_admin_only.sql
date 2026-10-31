-- Temporary knowledge-space restriction requested by the operator. No content is deleted.
begin;
create or replace function pmoffice_private.member_document_allowed(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(),false)
 and exists(select 1 from public.member_documents d where d.path=p_path)
$$;
create or replace function public.member_document_list() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.category,x.title),'[]') from (
 select d.path,d.title,d.category,d.toc from public.member_documents d where pmoffice_private.member_document_allowed(d.path)
 union all select '/knowledge/index.html?post='||p.id,p.title,b.title,'[]'::jsonb from public.posts p join public.boards b on b.id=p.board_id where pmoffice_private.can_read_post(p.id)) x);
end$$;
create or replace function public.member_document_get(p_path text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return (select to_jsonb(d) from public.member_documents d where d.path=p_path and pmoffice_private.member_document_allowed(d.path));
end$$;
create or replace function public.member_post_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return (select jsonb_build_object('title',p.title,'body',p.body,'attachments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'file_name',a.file_name)) from public.attachments a where a.post_id=p.id),'[]'))
 from public.posts p where pmoffice_private.can_read_post(p.id));
end$$;
create or replace function public.member_document_search(p_query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.account_ok() and pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select d.path,d.title,d.category from public.member_documents d where length(trim(p_query)) between 1 and 100
 and pmoffice_private.member_document_allowed(d.path) and (d.title ilike '%'||p_query||'%' or d.body_text ilike '%'||p_query||'%')
 union all select '/knowledge/index.html?post='||p.id,p.title,b.title from public.posts p join public.boards b on b.id=p.board_id
 where length(trim(p_query)) between 1 and 100 and pmoffice_private.can_read_post(p.id) and (p.title ilike '%'||p_query||'%' or p.body ilike '%'||p_query||'%') limit 50) x);
end$$;
commit;

