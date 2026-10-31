-- Keep server-issued publication URLs on the verified customer hostname.
begin;
create or replace function pmoffice_private.ebook_public_book(b pmoffice_private.ebook_books)
returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(b)-'share_hash'-'shared_users'||jsonb_build_object(
  'url','https://pmoffice.co.kr/ebooks/view.html?book='||b.id::text,
  'can_manage',pmoffice_private.ebook_manage(b))
$$;
commit;
