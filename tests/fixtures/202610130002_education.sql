-- Online education extends (does not replace) the 18-group membership model.
-- No private authored lesson content or actual media is seeded into public source.
begin;
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title text not null check(length(btrim(title)) between 1 and 200),
  membership_id text not null references public.membership_types(id),
  published boolean not null default false,
  auto_enroll boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  slug text not null check(slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  ordinal integer not null check(ordinal between 1 and 1000),
  title text not null check(length(btrim(title)) between 1 and 200),
  access_mode text not null check(access_mode in ('preview','member')),
  published boolean not null default false,
  media_ready boolean not null default false,
  duration_seconds integer not null default 0 check(duration_seconds between 0 and 14400),
  post_id uuid references public.posts(id) on delete restrict,
  preview_video_url text,
  preview_vtt_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(course_id,slug), unique(course_id,ordinal),
  check(access_mode<>'preview' or (ordinal=1 and post_id is null)),
  check(access_mode='preview' or (preview_video_url is null and preview_vtt_url is null)),
  check(preview_video_url is null or preview_video_url ~ '^/academy-preview/[a-z0-9/_-]+\.(mp4|webm)$'),
  check(preview_vtt_url is null or preview_vtt_url ~ '^/academy-preview/[a-z0-9/_-]+\.vtt$'),
  check(not published or (media_ready and duration_seconds>0))
);
create index lessons_course_ordinal on public.lessons(course_id,ordinal);
create table public.lesson_content (
  lesson_id uuid primary key references public.lessons(id) on delete cascade,
  body text not null check(length(body)<=1000000),
  transcript text not null check(length(transcript)<=1000000),
  quizzes jsonb not null default '[]' check(jsonb_typeof(quizzes)='array'),
  source_ref text not null check(length(btrim(source_ref)) between 1 and 2000),
  updated_at timestamptz not null default now()
);
create table public.lesson_media (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  kind text not null check(kind in ('video','vtt','attachment')),
  object_path text not null unique check(object_path ~ '^lessons/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|webm|vtt|pdf|zip|txt)$'),
  file_name text not null check(length(file_name) between 1 and 255 and file_name !~ '[\r\n]'),
  content_type text not null,
  bytes bigint not null check(bytes between 1 and 41943040),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz not null default now(),
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index lesson_primary_media on public.lesson_media(lesson_id,kind) where kind in ('video','vtt');
create index lesson_media_lesson on public.lesson_media(lesson_id);
create table public.enrollments (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete restrict,
  enrolled_at timestamptz not null default now(),
  primary key(user_id,course_id)
);
create table public.lesson_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key(user_id,lesson_id)
);
create table pmoffice_private.lesson_preview_verifications (
  lesson_id uuid primary key references public.lessons(id) on delete cascade,
  video_url text not null,
  vtt_url text not null,
  video_sha256 text not null check(video_sha256 ~ '^[a-f0-9]{64}$'),
  vtt_sha256 text not null check(vtt_sha256 ~ '^[a-f0-9]{64}$'),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz not null default now()
);

create function pmoffice_private.course_catalog_visible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.courses c where c.id=p_id and (c.published or pmoffice_private.is_admin()))
$$;
create function pmoffice_private.lesson_catalog_visible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.lessons l join public.courses c on c.id=l.course_id where l.id=p_id
and ((c.published and l.published and l.media_ready) or pmoffice_private.is_admin()))
$$;
create function pmoffice_private.can_read_lesson(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.lessons l join public.courses c on c.id=l.course_id where l.id=p_id
and (pmoffice_private.is_admin() or (c.published and l.published and l.media_ready and
(l.access_mode='preview' or (l.access_mode='member' and pmoffice_private.account_ok()
and exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=c.id)
and pmoffice_private.matches_rule(c.membership_id,'regular','minimum')
and (l.post_id is null or pmoffice_private.can_read_post(l.post_id)))))))
$$;
create function pmoffice_private.education_content_ready(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.lesson_content x where x.lesson_id=p_id and length(btrim(x.body))>=80
and length(btrim(x.transcript))>=80 and jsonb_array_length(x.quizzes)>0)
$$;
create function pmoffice_private.education_media_ready(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.lessons l where l.id=p_id and
((l.access_mode='preview' and exists(select 1 from pmoffice_private.lesson_preview_verifications v
where v.lesson_id=l.id and v.video_url=l.preview_video_url and v.vtt_url=l.preview_vtt_url))
or (l.access_mode='member' and exists(select 1 from public.lesson_media m join storage.objects o on o.bucket_id='academy-media' and o.name=m.object_path where m.lesson_id=l.id and m.kind='video')
and exists(select 1 from public.lesson_media m join storage.objects o on o.bucket_id='academy-media' and o.name=m.object_path where m.lesson_id=l.id and m.kind='vtt'))))
$$;
-- Registry evidence must still point to existing objects at read/publish time.
create or replace function pmoffice_private.lesson_catalog_visible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.lessons l join public.courses c on c.id=l.course_id where l.id=p_id
and ((c.published and l.published and l.media_ready and pmoffice_private.education_content_ready(l.id)
and pmoffice_private.education_media_ready(l.id)) or pmoffice_private.is_admin()))
$$;
create or replace function pmoffice_private.can_read_lesson(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.lessons l join public.courses c on c.id=l.course_id where l.id=p_id
and (pmoffice_private.is_admin() or (c.published and l.published and l.media_ready
and pmoffice_private.education_content_ready(l.id) and pmoffice_private.education_media_ready(l.id) and
(l.access_mode='preview' or (l.access_mode='member' and pmoffice_private.account_ok()
and exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=c.id)
and pmoffice_private.matches_rule(c.membership_id,'regular','minimum')
and (l.post_id is null or pmoffice_private.can_read_post(l.post_id)))))))
$$;
create function pmoffice_private.refresh_lesson_ready(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare ready boolean;
begin
ready:=pmoffice_private.education_content_ready(p_id) and pmoffice_private.education_media_ready(p_id);
update public.lessons set media_ready=ready,published=published and ready,updated_at=now() where id=p_id;
end $$;

do $$ declare t text; begin
foreach t in array array['courses','lessons','lesson_content','lesson_media','enrollments','lesson_progress'] loop
execute format('alter table public.%I enable row level security',t);
execute format('revoke all on table public.%I from anon,authenticated',t);
execute format('grant select on table public.%I to authenticated',t);
end loop; end $$;
grant select on public.courses,public.lessons,public.lesson_content to anon;
grant usage on schema pmoffice_private to anon;
create policy education_course_catalog on public.courses for select to anon,authenticated using(pmoffice_private.course_catalog_visible(id));
create policy education_lesson_catalog on public.lessons for select to anon,authenticated using(pmoffice_private.lesson_catalog_visible(id));
create policy education_read_content on public.lesson_content for select to anon,authenticated using(pmoffice_private.can_read_lesson(lesson_id));
create policy education_read_media on public.lesson_media for select to authenticated using(pmoffice_private.can_read_lesson(lesson_id));
create policy education_own_enrollments on public.enrollments for select to authenticated using(user_id=auth.uid() or pmoffice_private.is_admin());
create policy education_own_progress on public.lesson_progress for select to authenticated using(user_id=auth.uid() or pmoffice_private.is_admin());

create function public.enroll_course(p_course_id uuid) returns public.enrollments
language plpgsql security definer set search_path='' as $$
declare c public.courses; m public.user_memberships; result public.enrollments;
begin
if not pmoffice_private.account_ok() then raise exception 'Accepted active account required' using errcode='42501'; end if;
-- Serialize enrollments for one account, including the absent-membership case.
perform 1 from public.profiles where id=auth.uid() for update;
if not pmoffice_private.account_ok() then raise exception 'Account changed' using errcode='42501'; end if;
select * into c from public.courses where id=p_course_id for share;
if c.id is null or not c.published or not c.auto_enroll then raise exception 'Auto-enrollment unavailable' using errcode='22023'; end if;
select * into m from public.user_memberships where user_id=auth.uid() and membership_id=c.membership_id for update;
if m.user_id is null then
insert into public.user_memberships(user_id,membership_id,tier_id,status,expires_at,reason)
values(auth.uid(),c.membership_id,'regular','active',null,'Free course enrollment: '||c.slug);
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'education.regular_granted',auth.uid()::text,jsonb_build_object('course_id',c.id,'membership_id',c.membership_id));
elsif m.status<>'active' or m.starts_at>statement_timestamp() or (m.expires_at is not null and m.expires_at<=statement_timestamp()) then
raise exception 'Existing membership requires administrator review' using errcode='42501';
end if;
insert into public.enrollments(user_id,course_id) values(auth.uid(),c.id) on conflict do nothing returning * into result;
if result.user_id is not null then
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'education.enrolled',c.id::text,jsonb_build_object('user_id',auth.uid()));
else select * into result from public.enrollments where user_id=auth.uid() and course_id=c.id;
end if;
return result; end $$;

create function public.mark_lesson_complete(p_lesson_id uuid) returns public.lesson_progress
language plpgsql security definer set search_path='' as $$
declare result public.lesson_progress; c_id uuid;
begin
if not pmoffice_private.account_ok() or not pmoffice_private.can_read_lesson(p_lesson_id) then raise exception 'Lesson access required' using errcode='42501'; end if;
select course_id into c_id from public.lessons where id=p_lesson_id;
if not exists(select 1 from public.enrollments where user_id=auth.uid() and course_id=c_id) then raise exception 'Enrollment required' using errcode='42501'; end if;
insert into public.lesson_progress(user_id,lesson_id) values(auth.uid(),p_lesson_id) on conflict do nothing returning * into result;
if result.user_id is not null then
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'education.lesson_completed',p_lesson_id::text,jsonb_build_object('user_id',auth.uid(),'basis','learner self-report'));
else select * into result from public.lesson_progress where user_id=auth.uid() and lesson_id=p_lesson_id;
end if;
return result; end $$;

create function public.admin_save_course(p_payload jsonb) returns public.courses
language plpgsql security definer set search_path='' as $$
declare result public.courses; cid uuid; previous jsonb; v_slug text;
begin
perform pmoffice_private.require_admin();
if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Object payload required' using errcode='22023'; end if;
v_slug:=p_payload->>'slug'; cid:=nullif(p_payload->>'id','')::uuid;
if cid is null then select id into cid from public.courses where slug=v_slug for update; end if;
if cid is null then
insert into public.courses(slug,title,membership_id,published,auto_enroll) values(v_slug,p_payload->>'title',p_payload->>'membership_id',coalesce((p_payload->>'published')::boolean,false),coalesce((p_payload->>'auto_enroll')::boolean,false)) returning * into result;
else
select to_jsonb(c) into previous from public.courses c where id=cid for update;
-- Prevent changing the authorization membership after any enrollment.
if (previous->>'membership_id') is distinct from (p_payload->>'membership_id') and exists(select 1 from public.enrollments where course_id=cid) then raise exception 'Enrolled course membership cannot change' using errcode='22023'; end if;
update public.courses set slug=v_slug,title=p_payload->>'title',membership_id=p_payload->>'membership_id',published=coalesce((p_payload->>'published')::boolean,false),auto_enroll=coalesce((p_payload->>'auto_enroll')::boolean,false),updated_at=now() where id=cid returning * into result;
if result.id is null then raise exception 'Course not found' using errcode='22023'; end if;
end if;
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'education.course_saved',result.id::text,jsonb_build_object('before',previous,'after',to_jsonb(result)));
return result; end $$;

create function public.admin_save_lesson(p_payload jsonb) returns public.lessons
language plpgsql security definer set search_path='' as $$
declare result public.lessons; lid uuid; cid uuid; previous jsonb; wanted_published boolean;
begin
perform pmoffice_private.require_admin();
if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Object payload required' using errcode='22023'; end if;
cid:=(p_payload->>'course_id')::uuid; lid:=nullif(p_payload->>'id','')::uuid;
if lid is null then select id into lid from public.lessons where course_id=cid and slug=p_payload->>'slug' for update; end if;
wanted_published:=coalesce((p_payload->>'published')::boolean,false);
if lid is null then
insert into public.lessons(course_id,slug,ordinal,title,access_mode,published,duration_seconds,post_id)
values(cid,p_payload->>'slug',(p_payload->>'ordinal')::integer,p_payload->>'title',p_payload->>'access_mode',false,coalesce((p_payload->>'duration_seconds')::integer,0),nullif(p_payload->>'post_id','')::uuid) returning * into result;
else
select to_jsonb(l) into previous from public.lessons l where id=lid for update;
if (previous->>'course_id')::uuid is distinct from cid then raise exception 'Lesson cannot move between courses' using errcode='22023'; end if;
if previous->>'access_mode'='member' and p_payload->>'access_mode'='preview' then raise exception 'Protected lesson cannot be converted to public preview; create separately reviewed public content' using errcode='22023'; end if;
update public.lessons set slug=p_payload->>'slug',ordinal=(p_payload->>'ordinal')::integer,title=p_payload->>'title',access_mode=p_payload->>'access_mode',published=false,duration_seconds=coalesce((p_payload->>'duration_seconds')::integer,0),post_id=nullif(p_payload->>'post_id','')::uuid,updated_at=now() where id=lid returning * into result;
if result.id is null then raise exception 'Lesson not found' using errcode='22023'; end if;
end if;
perform pmoffice_private.refresh_lesson_ready(result.id);
if wanted_published and not (pmoffice_private.education_content_ready(result.id) and pmoffice_private.education_media_ready(result.id)) then raise exception 'Verified body, transcript, quiz, video and captions required before publishing' using errcode='22023'; end if;
update public.lessons set published=wanted_published where id=result.id returning * into result;
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'education.lesson_saved',result.id::text,jsonb_build_object('before',previous,'after',to_jsonb(result)));
return result; end $$;

create function public.admin_save_lesson_content(p_payload jsonb) returns public.lesson_content
language plpgsql security definer set search_path='' as $$
declare result public.lesson_content; lid uuid; quizzes jsonb; q jsonb; opt jsonb; idx integer;
begin
perform pmoffice_private.require_admin();
if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Object payload required' using errcode='22023'; end if;
lid:=(p_payload->>'lesson_id')::uuid; quizzes:=coalesce(p_payload->'quizzes','[]'::jsonb);
if jsonb_typeof(quizzes)<>'array' then raise exception 'Quizzes must be an array' using errcode='22023'; end if;
if jsonb_array_length(quizzes) not between 1 and 30 then raise exception 'One to thirty quizzes required' using errcode='22023'; end if;
for q in select value from jsonb_array_elements(quizzes) loop
if jsonb_typeof(q)<>'object' or length(btrim(coalesce(q->>'question','')))<5 or jsonb_typeof(q->'options') is distinct from 'array'
or coalesce(q->>'answer_index','') !~ '^[0-5]$' then raise exception 'Invalid quiz' using errcode='22023'; end if;
if jsonb_array_length(q->'options') not between 2 and 6 then raise exception 'Quiz requires two to six options' using errcode='22023'; end if;
idx:=(q->>'answer_index')::integer;
if idx>=jsonb_array_length(q->'options') or length(btrim(coalesce(q->>'explanation','')))<5 then raise exception 'Invalid quiz answer or explanation' using errcode='22023'; end if;
for opt in select value from jsonb_array_elements(q->'options') loop
if jsonb_typeof(opt)<>'string' or length(btrim(opt#>>'{}'))=0 then raise exception 'Quiz options must be nonempty strings' using errcode='22023'; end if;
end loop;
end loop;
perform 1 from public.lessons where id=lid for update;
insert into public.lesson_content(lesson_id,body,transcript,quizzes,source_ref)
values(lid,p_payload->>'body',p_payload->>'transcript',quizzes,p_payload->>'source_ref')
on conflict(lesson_id) do update set body=excluded.body,transcript=excluded.transcript,quizzes=excluded.quizzes,source_ref=excluded.source_ref,updated_at=now() returning * into result;
perform pmoffice_private.refresh_lesson_ready(lid);
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'education.content_saved',lid::text,jsonb_build_object('source_ref',result.source_ref,'quiz_count',jsonb_array_length(quizzes)));
return result; end $$;

create function public.admin_verify_lesson_preview(p_lesson_id uuid,p_video_url text,p_vtt_url text,p_video_sha256 text,p_vtt_sha256 text) returns public.lessons
language plpgsql security definer set search_path='' as $$
declare result public.lessons;
begin
perform pmoffice_private.require_admin();
select * into result from public.lessons where id=p_lesson_id for update;
if result.id is null or result.access_mode<>'preview' then raise exception 'Preview lesson required' using errcode='22023'; end if;
if p_video_url is null or p_video_url !~ '^/academy-preview/[a-z0-9/_-]+\.(mp4|webm)$' or p_vtt_url is null or p_vtt_url !~ '^/academy-preview/[a-z0-9/_-]+\.vtt$' then raise exception 'Approved relative preview paths required' using errcode='22023'; end if;
if p_video_sha256 is null or p_video_sha256 !~ '^[a-f0-9]{64}$' or p_vtt_sha256 is null or p_vtt_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Verified SHA256 evidence required' using errcode='22023'; end if;
insert into pmoffice_private.lesson_preview_verifications(lesson_id,video_url,vtt_url,video_sha256,vtt_sha256,verified_by)
values(p_lesson_id,p_video_url,p_vtt_url,p_video_sha256,p_vtt_sha256,auth.uid())
on conflict(lesson_id) do update set video_url=excluded.video_url,vtt_url=excluded.vtt_url,video_sha256=excluded.video_sha256,vtt_sha256=excluded.vtt_sha256,verified_by=auth.uid(),verified_at=now();
update public.lessons set preview_video_url=p_video_url,preview_vtt_url=p_vtt_url where id=p_lesson_id;
perform pmoffice_private.refresh_lesson_ready(p_lesson_id);
select * into result from public.lessons where id=p_lesson_id;
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'education.preview_verified',p_lesson_id::text,jsonb_build_object('video_sha256',p_video_sha256,'vtt_sha256',p_vtt_sha256,'verification_basis','operator-confirmed local asset hashes; database cannot inspect static CDN files'));
return result; end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('academy-media','academy-media',false,41943040,
array['video/mp4','video/webm','text/vtt','application/pdf','application/zip','text/plain','application/octet-stream']);
create function pmoffice_private.valid_lesson_upload_path(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
select pmoffice_private.is_admin() and case when p_name ~ '^lessons/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|webm|vtt|pdf|zip|txt)$'
then exists(select 1 from public.lessons where id::text=split_part(p_name,'/',2) and access_mode='member') else false end
$$;
create policy academy_admin_upload on storage.objects for insert to authenticated
with check(bucket_id='academy-media' and pmoffice_private.valid_lesson_upload_path(name));
create function public.admin_register_lesson_media(p_payload jsonb) returns public.lesson_media
language plpgsql security definer set search_path='' as $$
declare result public.lesson_media; lid uuid; path text; metadata jsonb; v_kind text; v_mime text; v_bytes bigint;
begin
perform pmoffice_private.require_admin();
if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Object payload required' using errcode='22023'; end if;
lid:=(p_payload->>'lesson_id')::uuid; path:=p_payload->>'object_path'; v_kind:=p_payload->>'kind';
perform 1 from public.lessons where id=lid for update;
if not pmoffice_private.valid_lesson_upload_path(path) or split_part(path,'/',2)<>lid::text then raise exception 'Invalid lesson media route' using errcode='22023'; end if;
select o.metadata into metadata from storage.objects o where bucket_id='academy-media' and name=path;
if metadata is null then raise exception 'Upload object first' using errcode='22023'; end if;
v_mime:=metadata->>'mimetype'; v_bytes:=coalesce(metadata->>'size',metadata->>'contentLength')::bigint;
if v_bytes is null or v_bytes not between 1 and 41943040 then raise exception 'Verified media size required, up to 40MiB' using errcode='22023'; end if;
if v_kind='video' and not ((path ~ '\.mp4$' and v_mime='video/mp4') or (path ~ '\.webm$' and v_mime='video/webm')) then raise exception 'Video path/MIME mismatch' using errcode='22023'; end if;
if v_kind='vtt' and not (path ~ '\.vtt$' and v_mime in ('text/vtt','text/plain','application/octet-stream')) then raise exception 'Caption path/MIME mismatch' using errcode='22023'; end if;
if v_kind='attachment' and not (path ~ '\.(pdf|zip|txt)$' and v_mime in ('application/pdf','application/zip','text/plain','application/octet-stream')) then raise exception 'Attachment path/MIME mismatch' using errcode='22023'; end if;
-- Hash is an operator attestation of verified bytes; server metadata verifies existence/type/size.
insert into public.lesson_media(lesson_id,kind,object_path,file_name,content_type,bytes,sha256,verified_by)
values(lid,v_kind,path,p_payload->>'file_name',case when v_kind='vtt' then 'text/vtt' else v_mime end,v_bytes,p_payload->>'sha256',auth.uid()) returning * into result;
perform pmoffice_private.refresh_lesson_ready(lid);
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'education.media_registered',result.id::text,to_jsonb(result));
return result; end $$;

revoke all on function pmoffice_private.course_catalog_visible(uuid),pmoffice_private.lesson_catalog_visible(uuid),pmoffice_private.can_read_lesson(uuid),pmoffice_private.education_content_ready(uuid),pmoffice_private.education_media_ready(uuid),pmoffice_private.refresh_lesson_ready(uuid),pmoffice_private.valid_lesson_upload_path(text) from public,anon,authenticated;
grant execute on function pmoffice_private.course_catalog_visible(uuid),pmoffice_private.lesson_catalog_visible(uuid),pmoffice_private.can_read_lesson(uuid) to anon,authenticated;
grant execute on function pmoffice_private.valid_lesson_upload_path(text) to authenticated;
revoke all on function public.enroll_course(uuid),public.mark_lesson_complete(uuid),public.admin_save_course(jsonb),public.admin_save_lesson(jsonb),public.admin_save_lesson_content(jsonb),public.admin_verify_lesson_preview(uuid,text,text,text,text),public.admin_register_lesson_media(jsonb) from public,anon,authenticated;
grant execute on function public.enroll_course(uuid),public.mark_lesson_complete(uuid),public.admin_save_course(jsonb),public.admin_save_lesson(jsonb),public.admin_save_lesson_content(jsonb),public.admin_verify_lesson_preview(uuid,text,text,text,text),public.admin_register_lesson_media(jsonb) to authenticated;
revoke all on pmoffice_private.lesson_preview_verifications from public,anon,authenticated;
commit;
