-- 관리자 API
-- 모든 함수는 security invoker 로 실행되어 RLS 가 그대로 적용되고,
-- 함수 첫 줄에서 관리자 여부를 서버에서 다시 확인한다.

create or replace function public.assert_admin()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not coalesce(public.is_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.am_i_admin()
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce(public.is_admin(), false) $$;

-- ---------------------------------------------------------------------------
-- 운영 설정
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_settings()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return (select to_jsonb(s) from public.app_settings s where id = 1);
end;
$$;

create or replace function public.admin_update_settings(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  cur public.app_settings;
  want_confirmed boolean;
begin
  perform public.assert_admin();
  select * into cur from public.app_settings where id = 1 for update;

  update public.app_settings set
    service_name = coalesce(btrim(p ->> 'service_name'), service_name),
    parent_title = coalesce(btrim(p ->> 'parent_title'), parent_title),
    teacher_name = coalesce(btrim(p ->> 'teacher_name'), teacher_name),
    teacher_intro = coalesce(btrim(p ->> 'teacher_intro'), teacher_intro),
    intro_eyebrow = coalesce(btrim(p ->> 'intro_eyebrow'), intro_eyebrow),
    intro_title = coalesce(btrim(p ->> 'intro_title'), intro_title),
    intro_body = coalesce(btrim(p ->> 'intro_body'), intro_body),
    intro_note = coalesce(btrim(p ->> 'intro_note'), intro_note),
    completion_message = coalesce(btrim(p ->> 'completion_message'), completion_message),
    policy_notice = coalesce(btrim(p ->> 'policy_notice'), policy_notice),
    operator_name = coalesce(btrim(p ->> 'operator_name'), operator_name),
    operator_contact = coalesce(btrim(p ->> 'operator_contact'), operator_contact),
    privacy_purpose = coalesce(btrim(p ->> 'privacy_purpose'), privacy_purpose),
    privacy_retention = coalesce(btrim(p ->> 'privacy_retention'), privacy_retention),
    privacy_deletion = coalesce(btrim(p ->> 'privacy_deletion'), privacy_deletion)
  where id = 1;

  want_confirmed := coalesce((p ->> 'privacy_confirmed')::boolean, cur.privacy_confirmed);
  select * into cur from public.app_settings where id = 1;
  if want_confirmed and (
    cur.operator_name = '' or cur.operator_contact = '' or cur.privacy_purpose = ''
    or cur.privacy_retention = '' or cur.privacy_deletion = ''
  ) then
    raise exception 'privacy_incomplete' using errcode = 'P0001';
  end if;
  update public.app_settings set
    privacy_confirmed = want_confirmed,
    privacy_confirmed_at = case
      when want_confirmed and not cur.privacy_confirmed then now()
      when not want_confirmed then null
      else privacy_confirmed_at end
  where id = 1;

  return (select to_jsonb(s) from public.app_settings s where id = 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- 과목·양식·수업·초대 링크 목록 (설정 화면용 한 번에 조회)
-- ---------------------------------------------------------------------------
create or replace function public.admin_catalog()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return jsonb_build_object(
    'subjects', (
      select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
        'course_count', (select count(*) from public.courses c where c.subject_id = s.id),
        'response_count', (select count(*) from public.submission_courses sc where sc.subject_id = s.id)
      ) order by s.archived_at nulls first, s.sort_order, s.name), '[]'::jsonb)
      from public.subjects s
    ),
    'templates', (
      select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
        'published', (
          select jsonb_build_object('id', v.id, 'version_no', v.version_no, 'published_at', v.published_at, 'questions', v.questions)
          from public.form_versions v where v.template_id = t.id and v.status = 'published'
        ),
        'draft', (
          select jsonb_build_object('id', v.id, 'questions', v.questions, 'updated_at', v.updated_at)
          from public.form_versions v where v.template_id = t.id and v.status = 'draft'
        ),
        'versions', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', v.id, 'version_no', v.version_no, 'status', v.status, 'published_at', v.published_at,
            'superseded_at', v.superseded_at,
            'response_count', (select count(*) from public.submission_courses sc where sc.form_version_id = v.id)
              + (select count(*) from public.submissions sb where sb.common_version_id = v.id)
          ) order by v.version_no desc), '[]'::jsonb)
          from public.form_versions v where v.template_id = t.id and v.status <> 'draft'
        ),
        'course_count', (select count(*) from public.courses c where c.template_id = t.id)
      ) order by t.kind, t.archived_at nulls first, t.name), '[]'::jsonb)
      from public.form_templates t
    ),
    'courses', (
      select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
        'start_time', to_char(c.start_time, 'HH24:MI'),
        'response_count', (select count(*) from public.submission_courses sc where sc.course_id = c.id)
      ) order by c.status = 'archived', c.sort_order, c.name), '[]'::jsonb)
      from public.courses c
    ),
    'invitations', (
      select coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object(
        'course_ids', (select coalesce(jsonb_agg(ic.course_id order by ic.sort_order), '[]'::jsonb)
                       from public.invitation_courses ic where ic.invitation_id = i.id),
        'submission_count', (select count(*) from public.submissions sb where sb.invitation_id = i.id),
        'state', public.invitation_state(i)
      ) order by i.created_at desc), '[]'::jsonb)
      from public.invitations i
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 과목
-- ---------------------------------------------------------------------------
create or replace function public.strip_course_targets(p_questions jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg((e.value - 'course_ids') order by e.ordinality), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) with ordinality e;
$$;

create or replace function public.latest_questions(p_template_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select v.questions from public.form_versions v
  where v.template_id = p_template_id and v.status in ('draft', 'published')
  order by (v.status = 'draft') desc
  limit 1;
$$;

create or replace function public.admin_save_subject(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sub public.subjects;
  tpl_id uuid;
  src text := coalesce(p ->> 'template_source', 'standard');
  qs jsonb;
begin
  perform public.assert_admin();
  if public.text_field_error(p -> 'name', true, 30) is not null then
    raise exception 'validation_failed' using errcode = 'P0001',
      detail = jsonb_build_array(jsonb_build_object('path', 'name', 'code', public.text_field_error(p -> 'name', true, 30)))::text;
  end if;

  if coalesce(p ->> 'id', '') = '' then
    insert into public.subjects (name, description, perspective, sort_order, is_active)
    values (
      btrim(p ->> 'name'), btrim(coalesce(p ->> 'description', '')), btrim(coalesce(p ->> 'perspective', '')),
      coalesce((p ->> 'sort_order')::integer, 100), coalesce((p ->> 'is_active')::boolean, true))
    returning * into sub;

    if src = 'standard' then
      qs := public.standard_subject_questions(public.generic_difficulty_options(), '[]'::jsonb);
    else
      qs := public.strip_course_targets(public.latest_questions(src::uuid));
      if qs is null then
        raise exception 'template_not_found' using errcode = 'P0001';
      end if;
    end if;

    insert into public.form_templates (kind, subject_id, name, description)
    values ('subject', sub.id, sub.name || ' 기본 양식', '')
    returning id into tpl_id;
    insert into public.form_versions (template_id, status, questions) values (tpl_id, 'draft', qs);
    update public.subjects set default_template_id = tpl_id where id = sub.id returning * into sub;
  else
    update public.subjects set
      name = btrim(p ->> 'name'),
      description = btrim(coalesce(p ->> 'description', description)),
      perspective = btrim(coalesce(p ->> 'perspective', perspective)),
      sort_order = coalesce((p ->> 'sort_order')::integer, sort_order),
      is_active = coalesce((p ->> 'is_active')::boolean, is_active)
    where id = (p ->> 'id')::uuid
    returning * into sub;
    if sub.id is null then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
  end if;
  return to_jsonb(sub);
exception when unique_violation then
  raise exception 'duplicate_name' using errcode = 'P0001';
end;
$$;

create or replace function public.admin_archive_subject(p_id uuid, p_archived boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  sub public.subjects;
begin
  perform public.assert_admin();
  update public.subjects set
    archived_at = case when p_archived then coalesce(archived_at, now()) end,
    is_active = case when p_archived then false else is_active end
  where id = p_id
  returning * into sub;
  if sub.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return to_jsonb(sub);
exception when unique_violation then
  raise exception 'duplicate_name' using errcode = 'P0001';
end;
$$;

-- 응답·수업과 연결되지 않은 과목만 완전히 지울 수 있다.
create or replace function public.admin_delete_subject(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_admin();
  if exists (select 1 from public.courses where subject_id = p_id)
    or exists (select 1 from public.submission_courses where subject_id = p_id) then
    raise exception 'in_use' using errcode = 'P0001';
  end if;
  update public.subjects set default_template_id = null where id = p_id;
  delete from public.form_versions v using public.form_templates t where v.template_id = t.id and t.subject_id = p_id;
  delete from public.form_templates where subject_id = p_id;
  delete from public.subjects where id = p_id;
exception when foreign_key_violation then
  raise exception 'in_use' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- 양식
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_draft(p_template_id uuid, p_questions jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  err text;
  pub public.form_versions;
  missing text;
  bad_course text;
  draft public.form_versions;
begin
  perform public.assert_admin();
  if not exists (select 1 from public.form_templates where id = p_template_id and archived_at is null) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  err := public.questions_error(p_questions);
  if err is not null then
    raise exception 'invalid_questions' using errcode = 'P0001', detail = err;
  end if;

  -- 기본 질문(locked)은 지울 수 없고 유형도 바꿀 수 없다. 숨기기(active=false)는 가능.
  select * into pub from public.form_versions where template_id = p_template_id and status = 'published';
  if pub.id is not null then
    select q.value ->> 'id' into missing
    from jsonb_array_elements(pub.questions) q
    where coalesce((q.value ->> 'locked')::boolean, false)
      and not exists (
        select 1 from jsonb_array_elements(p_questions) n
        where n.value ->> 'id' = q.value ->> 'id'
          and n.value ->> 'type' = q.value ->> 'type'
          and coalesce((n.value ->> 'locked')::boolean, false)
      )
    limit 1;
    if missing is not null then
      raise exception 'invalid_questions' using errcode = 'P0001', detail = missing || ':locked_question_removed';
    end if;
  end if;

  select x into bad_course
  from jsonb_array_elements(p_questions) q, jsonb_array_elements_text(coalesce(q.value -> 'course_ids', '[]'::jsonb)) x
  where not exists (select 1 from public.courses c where c.id::text = x and c.template_id = p_template_id)
  limit 1;
  if bad_course is not null then
    raise exception 'invalid_questions' using errcode = 'P0001', detail = 'course_ids:' || bad_course;
  end if;

  update public.form_versions set questions = p_questions
  where template_id = p_template_id and status = 'draft'
  returning * into draft;
  if draft.id is null then
    insert into public.form_versions (template_id, status, questions)
    values (p_template_id, 'draft', p_questions)
    returning * into draft;
  end if;
  return jsonb_build_object('id', draft.id, 'questions', draft.questions, 'updated_at', draft.updated_at);
end;
$$;

create or replace function public.admin_publish_draft(p_template_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  draft public.form_versions;
  next_no integer;
begin
  perform public.assert_admin();
  select * into draft from public.form_versions where template_id = p_template_id and status = 'draft' for update;
  if draft.id is null then
    raise exception 'no_draft' using errcode = 'P0001';
  end if;
  select coalesce(max(version_no), 0) + 1 into next_no from public.form_versions where template_id = p_template_id;
  update public.form_versions set status = 'superseded', superseded_at = now()
  where template_id = p_template_id and status = 'published';
  update public.form_versions set status = 'published', version_no = next_no, published_at = now()
  where id = draft.id
  returning * into draft;
  update public.form_templates set updated_at = now() where id = p_template_id;
  return jsonb_build_object('id', draft.id, 'version_no', draft.version_no, 'published_at', draft.published_at);
end;
$$;

create or replace function public.admin_discard_draft(p_template_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_admin();
  delete from public.form_versions where template_id = p_template_id and status = 'draft';
end;
$$;

create or replace function public.admin_copy_template(p_source_template_id uuid, p_subject_id uuid, p_name text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  qs jsonb;
  t public.form_templates;
begin
  perform public.assert_admin();
  qs := public.strip_course_targets(public.latest_questions(p_source_template_id));
  if qs is null then
    raise exception 'template_not_found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.subjects where id = p_subject_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  insert into public.form_templates (kind, subject_id, name)
  values ('subject', p_subject_id, btrim(p_name))
  returning * into t;
  insert into public.form_versions (template_id, status, questions) values (t.id, 'draft', qs);
  return to_jsonb(t);
end;
$$;

create or replace function public.admin_update_template(p_id uuid, p_name text, p_description text, p_archived boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  t public.form_templates;
begin
  perform public.assert_admin();
  if p_archived and exists (select 1 from public.courses where template_id = p_id and status <> 'archived') then
    raise exception 'in_use' using errcode = 'P0001';
  end if;
  update public.form_templates set
    name = coalesce(nullif(btrim(p_name), ''), name),
    description = coalesce(btrim(p_description), description),
    archived_at = case when p_archived and kind = 'subject' then coalesce(archived_at, now()) when not p_archived then null else archived_at end
  where id = p_id
  returning * into t;
  if t.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return to_jsonb(t);
end;
$$;

-- ---------------------------------------------------------------------------
-- 수업
-- ---------------------------------------------------------------------------
create or replace function public.admin_save_course(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c public.courses;
  errs jsonb := '[]'::jsonb;
  subj uuid;
  tpl uuid;
begin
  perform public.assert_admin();

  if public.text_field_error(p -> 'name', true, 60) is not null then
    errs := errs || jsonb_build_object('path', 'name', 'code', public.text_field_error(p -> 'name', true, 60));
  end if;
  subj := case when (p ->> 'subject_id') ~ '^[0-9a-f-]{36}$' then (p ->> 'subject_id')::uuid end;
  tpl := case when (p ->> 'template_id') ~ '^[0-9a-f-]{36}$' then (p ->> 'template_id')::uuid end;
  if subj is null or not exists (select 1 from public.subjects where id = subj and archived_at is null) then
    errs := errs || jsonb_build_object('path', 'subject_id', 'code', 'required');
  elsif tpl is null or not exists (
    select 1 from public.form_templates where id = tpl and kind = 'subject' and subject_id = subj and archived_at is null
  ) then
    errs := errs || jsonb_build_object('path', 'template_id', 'code', 'required');
  end if;
  if (p ->> 'start_time') is not null and (p ->> 'start_time') <> '' and (p ->> 'start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    errs := errs || jsonb_build_object('path', 'start_time', 'code', 'invalid');
  end if;
  if (p ->> 'start_date') is not null and (p ->> 'start_date') <> '' and not public.is_valid_date_text(p ->> 'start_date') then
    errs := errs || jsonb_build_object('path', 'start_date', 'code', 'invalid');
  end if;
  -- 확정 조건으로 표시했다면 값이 있어야 한다
  if (p -> 'fixed_conditions') ? 'start_time' and coalesce(p ->> 'start_time', '') = '' then
    errs := errs || jsonb_build_object('path', 'start_time', 'code', 'fixed_needs_value');
  end if;
  if (p -> 'fixed_conditions') ? 'start_date' and coalesce(p ->> 'start_date', '') = '' then
    errs := errs || jsonb_build_object('path', 'start_date', 'code', 'fixed_needs_value');
  end if;
  if (p -> 'fixed_conditions') ? 'minutes' and jsonb_typeof(p -> 'minutes_per_session') is distinct from 'number' then
    errs := errs || jsonb_build_object('path', 'minutes_per_session', 'code', 'fixed_needs_value');
  end if;
  if (p -> 'fixed_conditions') ? 'sessions' and jsonb_typeof(p -> 'sessions_per_week') is distinct from 'number' then
    errs := errs || jsonb_build_object('path', 'sessions_per_week', 'code', 'fixed_needs_value');
  end if;
  if (p -> 'fixed_conditions') ? 'weekdays' and jsonb_array_length(coalesce(p -> 'weekdays', '[]'::jsonb)) = 0 then
    errs := errs || jsonb_build_object('path', 'weekdays', 'code', 'fixed_needs_value');
  end if;
  if (p -> 'fixed_conditions') ? 'duration' and btrim(coalesce(p ->> 'duration_text', '')) = '' then
    errs := errs || jsonb_build_object('path', 'duration_text', 'code', 'fixed_needs_value');
  end if;
  if jsonb_array_length(errs) > 0 then
    raise exception 'validation_failed' using errcode = 'P0001', detail = errs::text;
  end if;

  if coalesce(p ->> 'id', '') = '' then
    insert into public.courses (subject_id, template_id, name, school_level)
    values (subj, tpl, btrim(p ->> 'name'), coalesce(p ->> 'school_level', 'any')) returning * into c;
  else
    select * into c from public.courses where id = (p ->> 'id')::uuid for update;
    if c.id is null then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
  end if;

  update public.courses set
    subject_id = subj,
    template_id = tpl,
    name = btrim(p ->> 'name'),
    school_level = coalesce(p ->> 'school_level', 'any'),
    grades = coalesce(array(select jsonb_array_elements_text(p -> 'grades')::smallint), '{}'),
    scope_text = btrim(coalesce(p ->> 'scope_text', '')),
    mode = coalesce(p ->> 'mode', 'negotiable'),
    group_type = coalesce(p ->> 'group_type', 'negotiable'),
    sessions_per_week = (p ->> 'sessions_per_week')::smallint,
    minutes_per_session = (p ->> 'minutes_per_session')::smallint,
    weekdays = coalesce(array(select jsonb_array_elements_text(p -> 'weekdays')::smallint order by 1), '{}'),
    time_bands = coalesce(array(select jsonb_array_elements_text(p -> 'time_bands')), '{}'),
    start_time = nullif(p ->> 'start_time', '')::time,
    time_note = btrim(coalesce(p ->> 'time_note', '')),
    start_date = nullif(p ->> 'start_date', '')::date,
    duration_text = btrim(coalesce(p ->> 'duration_text', '')),
    session_choices = coalesce(array(select distinct jsonb_array_elements_text(coalesce(p -> 'session_choices', '[]'::jsonb))::smallint order by 1), '{}'),
    fixed_conditions = coalesce(array(select jsonb_array_elements_text(p -> 'fixed_conditions')), '{}'),
    notice = btrim(coalesce(p ->> 'notice', '')),
    status = coalesce(p ->> 'status', c.status),
    sort_order = coalesce((p ->> 'sort_order')::integer, c.sort_order)
  where id = c.id
  returning * into c;

  return to_jsonb(c) || jsonb_build_object('start_time', to_char(c.start_time, 'HH24:MI'));
end;
$$;

create or replace function public.admin_set_course_status(p_id uuid, p_status text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_admin();
  update public.courses set status = p_status where id = p_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.admin_delete_course(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_admin();
  if exists (select 1 from public.submission_courses where course_id = p_id)
    or exists (select 1 from public.invitation_courses where course_id = p_id) then
    raise exception 'in_use' using errcode = 'P0001';
  end if;
  delete from public.courses where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 초대 링크
-- ---------------------------------------------------------------------------
create or replace function public.new_invitation_token()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 무작위 UUID 두 개(약 244비트)를 이어 붙인 64자 16진수
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

create or replace function public.admin_create_invitation(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  ids uuid[];
  inv public.invitations;
  allow_multi boolean := coalesce((p ->> 'allow_multiple')::boolean, false);
begin
  perform public.assert_admin();
  select array_agg(distinct x::uuid) into ids from jsonb_array_elements_text(coalesce(p -> 'course_ids', '[]'::jsonb)) x;
  if ids is null or array_length(ids, 1) = 0 then
    raise exception 'validation_failed' using errcode = 'P0001',
      detail = jsonb_build_array(jsonb_build_object('path', 'course_ids', 'code', 'required'))::text;
  end if;
  if not allow_multi and array_length(ids, 1) > 1 then
    raise exception 'validation_failed' using errcode = 'P0001',
      detail = jsonb_build_array(jsonb_build_object('path', 'course_ids', 'code', 'too_many'))::text;
  end if;
  if (select count(*) from public.courses where id = any (ids) and status <> 'archived') <> array_length(ids, 1) then
    raise exception 'validation_failed' using errcode = 'P0001',
      detail = jsonb_build_array(jsonb_build_object('path', 'course_ids', 'code', 'invalid'))::text;
  end if;

  insert into public.invitations (token, label, allow_multiple, expires_at, max_submissions)
  values (
    public.new_invitation_token(),
    btrim(coalesce(p ->> 'label', '')),
    allow_multi,
    nullif(p ->> 'expires_at', '')::timestamptz,
    (p ->> 'max_submissions')::integer)
  returning * into inv;

  insert into public.invitation_courses (invitation_id, course_id, sort_order)
  select inv.id, c.id, row_number() over (order by c.sort_order, c.name)
  from public.courses c where c.id = any (ids);

  return to_jsonb(inv);
end;
$$;

create or replace function public.admin_update_invitation(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  inv public.invitations;
begin
  perform public.assert_admin();
  update public.invitations set
    label = coalesce(btrim(p ->> 'label'), label),
    is_active = coalesce((p ->> 'is_active')::boolean, is_active),
    expires_at = case when p ? 'expires_at' then nullif(p ->> 'expires_at', '')::timestamptz else expires_at end,
    max_submissions = case when p ? 'max_submissions' then (p ->> 'max_submissions')::integer else max_submissions end
  where id = (p ->> 'id')::uuid
  returning * into inv;
  if inv.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return to_jsonb(inv);
end;
$$;

-- ---------------------------------------------------------------------------
-- 응답 조회
-- ---------------------------------------------------------------------------
create or replace function public.answer_value_json(a public.answers)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when a.status = 'unknown' then jsonb_build_object('status', 'unknown')
    else jsonb_build_object('status', 'answered', 'value', coalesce(
      to_jsonb(a.value_choices),
      to_jsonb(a.value_number),
      to_jsonb(to_char(a.value_date, 'YYYY-MM-DD')),
      to_jsonb(to_char(a.value_time, 'HH24:MI')),
      to_jsonb(a.value_text)))
  end;
$$;

create or replace function public.admin_list_submissions()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'receipt_code', s.receipt_code,
      'received_at', s.received_at,
      'parent_name', s.parent_name,
      'parent_phone', s.parent_phone,
      'student_name', s.student_name,
      'school_level', s.school_level,
      'grade', s.grade,
      'grade_note', s.grade_note,
      'school_name', s.school_name,
      'unknown_count', s.unknown_count,
      'courses', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', sc.id,
          'course_id', sc.course_id,
          'course_name', sc.course_snapshot ->> 'name',
          'subject_id', sc.subject_id,
          'subject_name', sc.course_snapshot ->> 'subject_name',
          'preferred_start_date', sc.preferred_start_date,
          'preferred_start_undecided', sc.preferred_start_undecided,
          'fixed_start_date', case when (sc.course_snapshot -> 'fixed_conditions') ? 'start_date' then sc.course_snapshot ->> 'start_date' end,
          'time_undecided', sc.time_undecided,
          'slots', (select coalesce(jsonb_agg(jsonb_build_object('weekday', sl.weekday, 'start_time', to_char(sl.start_time, 'HH24:MI'))
                    order by sl.weekday, sl.start_time), '[]'::jsonb)
                    from public.submission_course_slots sl where sl.submission_course_id = sc.id),
          'homework_band', sc.homework_band,
          'unknown_count', sc.unknown_count,
          'status', cr.status,
          'next_contact_date', cr.next_contact_date,
          'confirmed_start_date', cr.confirmed_start_date,
          'updated_at', cr.updated_at
        ) order by sc.position), '[]'::jsonb)
        from public.submission_courses sc
        left join public.consultation_records cr on cr.submission_course_id = sc.id
        where sc.submission_id = s.id
      )
    ) order by s.received_at desc), '[]'::jsonb)
    from public.submissions s
  );
end;
$$;

create or replace function public.submission_detail_json(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'receipt_code', s.receipt_code,
    'received_at', s.received_at,
    'parent_name', s.parent_name,
    'parent_phone', s.parent_phone,
    'student_name', s.student_name,
    'school_level', s.school_level,
    'grade', s.grade,
    'grade_note', s.grade_note,
    'school_name', s.school_name,
    'general_request', s.general_request,
    'consecutive_request', s.consecutive_request,
    'consecutive_note', s.consecutive_note,
    'privacy_consented_at', s.privacy_consented_at,
    'privacy_snapshot', s.privacy_snapshot,
    'unknown_count', s.unknown_count,
    'invitation_label', (select i.label from public.invitations i where i.id = s.invitation_id),
    'common', jsonb_build_object(
      'version_id', s.common_version_id,
      'version_no', (select v.version_no from public.form_versions v where v.id = s.common_version_id),
      'questions', coalesce((select public.applicable_questions(v.questions, null) from public.form_versions v where v.id = s.common_version_id), '[]'::jsonb),
      'answers', (select coalesce(jsonb_object_agg(a.question_key, public.answer_value_json(a)), '{}'::jsonb)
                  from public.answers a where a.submission_id = s.id and a.submission_course_id is null)
    ),
    'courses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', sc.id,
        'course_id', sc.course_id,
        'subject_id', sc.subject_id,
        'position', sc.position,
        'course', sc.course_snapshot,
        'version_id', sc.form_version_id,
        'version_no', v.version_no,
        'questions', public.applicable_questions(v.questions, sc.course_id),
        'answers', (select coalesce(jsonb_object_agg(a.question_key, public.answer_value_json(a)), '{}'::jsonb)
                    from public.answers a where a.submission_course_id = sc.id),
        'schedule', jsonb_build_object(
          'start_date', sc.preferred_start_date,
          'start_undecided', sc.preferred_start_undecided,
          'time_undecided', sc.time_undecided,
          'slots', (select coalesce(jsonb_agg(jsonb_build_object('weekday', sl.weekday, 'start_time', to_char(sl.start_time, 'HH24:MI'))
                    order by sl.weekday, sl.start_time), '[]'::jsonb)
                    from public.submission_course_slots sl where sl.submission_course_id = sc.id),
          'duration', sc.preferred_duration,
          'sessions_per_week', sc.requested_sessions_per_week,
          'minutes', sc.requested_minutes,
          'mode', sc.requested_mode,
          'group_type', sc.requested_group_type,
          'note', sc.schedule_note
        ),
        'homework_band', sc.homework_band,
        'assessments', (select coalesce(jsonb_agg(jsonb_build_object(
            'kind', sa.kind, 'name', sa.name, 'status', sa.status, 'period_start', sa.period_start,
            'period_end', sa.period_end, 'exam_date', sa.exam_date, 'scope', sa.scope) order by sa.position), '[]'::jsonb)
          from public.submission_assessments sa where sa.submission_course_id = sc.id),
        'unknown_count', sc.unknown_count,
        'consultation', (
          select jsonb_build_object(
            'status', cr.status,
            'consult_memo', cr.consult_memo,
            'plan_memo', cr.plan_memo,
            'confirmed_start_date', cr.confirmed_start_date,
            'confirmed_minutes', cr.confirmed_minutes,
            'next_contact_date', cr.next_contact_date,
            'created_at', cr.created_at,
            'updated_at', cr.updated_at,
            'slots', (select coalesce(jsonb_agg(jsonb_build_object('weekday', cs.weekday, 'start_time', to_char(cs.start_time, 'HH24:MI'))
                      order by cs.weekday, cs.start_time), '[]'::jsonb)
                      from public.consultation_slots cs where cs.submission_course_id = sc.id)
          )
          from public.consultation_records cr where cr.submission_course_id = sc.id
        )
      ) order by sc.position), '[]'::jsonb)
      from public.submission_courses sc
      join public.form_versions v on v.id = sc.form_version_id
      where sc.submission_id = s.id
    )
  )
  from public.submissions s
  where s.id = p_id;
$$;

create or replace function public.admin_get_submission(p_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  r jsonb;
begin
  perform public.assert_admin();
  r := public.submission_detail_json(p_id);
  if r is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return r;
end;
$$;

create or replace function public.admin_get_submissions(p_ids uuid[])
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.assert_admin();
  if coalesce(array_length(p_ids, 1), 0) > 2000 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;
  return (
    select coalesce(jsonb_agg(public.submission_detail_json(s.id) order by s.received_at desc), '[]'::jsonb)
    from public.submissions s where s.id = any (p_ids)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 상담 기록 (수업별 독립)
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_consultation(
  p_submission_course_id uuid, p_expected_updated_at timestamptz, p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  cr public.consultation_records;
  slot jsonb;
begin
  perform public.assert_admin();
  select * into cr from public.consultation_records where submission_course_id = p_submission_course_id for update;
  if cr.submission_course_id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  -- 다른 화면에서 먼저 저장했다면 덮어쓰지 않는다
  if p_expected_updated_at is not null and date_trunc('milliseconds', cr.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'conflict' using errcode = 'P0001';
  end if;
  if p ? 'status' and (p ->> 'status') not in ('new', 'reviewing', 'needs_info', 'scheduled', 'on_hold') then
    raise exception 'validation_failed' using errcode = 'P0001',
      detail = jsonb_build_array(jsonb_build_object('path', 'status', 'code', 'invalid'))::text;
  end if;
  if p ? 'slots' then
    if jsonb_typeof(p -> 'slots') <> 'array' or jsonb_array_length(p -> 'slots') > 14 then
      raise exception 'validation_failed' using errcode = 'P0001',
        detail = jsonb_build_array(jsonb_build_object('path', 'slots', 'code', 'invalid'))::text;
    end if;
    for slot in select value from jsonb_array_elements(p -> 'slots') loop
      if (slot ->> 'weekday') !~ '^[0-6]$' or (slot ->> 'start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'validation_failed' using errcode = 'P0001',
          detail = jsonb_build_array(jsonb_build_object('path', 'slots', 'code', 'invalid'))::text;
      end if;
    end loop;
  end if;

  update public.consultation_records set
    status = coalesce(p ->> 'status', status),
    consult_memo = case when p ? 'consult_memo' then coalesce(p ->> 'consult_memo', '') else consult_memo end,
    plan_memo = case when p ? 'plan_memo' then coalesce(p ->> 'plan_memo', '') else plan_memo end,
    confirmed_start_date = case when p ? 'confirmed_start_date' then nullif(p ->> 'confirmed_start_date', '')::date else confirmed_start_date end,
    confirmed_minutes = case when p ? 'confirmed_minutes' then (p ->> 'confirmed_minutes')::smallint else confirmed_minutes end,
    next_contact_date = case when p ? 'next_contact_date' then nullif(p ->> 'next_contact_date', '')::date else next_contact_date end,
    updated_by = (select auth.uid())
  where submission_course_id = p_submission_course_id
  returning * into cr;

  if p ? 'slots' then
    delete from public.consultation_slots where submission_course_id = p_submission_course_id;
    insert into public.consultation_slots (submission_course_id, weekday, start_time)
    select distinct p_submission_course_id, (x.value ->> 'weekday')::smallint, (x.value ->> 'start_time')::time
    from jsonb_array_elements(p -> 'slots') x;
  end if;

  return jsonb_build_object(
    'status', cr.status, 'consult_memo', cr.consult_memo, 'plan_memo', cr.plan_memo,
    'confirmed_start_date', cr.confirmed_start_date, 'confirmed_minutes', cr.confirmed_minutes,
    'next_contact_date', cr.next_contact_date, 'created_at', cr.created_at, 'updated_at', cr.updated_at,
    'slots', (select coalesce(jsonb_agg(jsonb_build_object('weekday', cs.weekday, 'start_time', to_char(cs.start_time, 'HH24:MI'))
              order by cs.weekday, cs.start_time), '[]'::jsonb)
              from public.consultation_slots cs where cs.submission_course_id = p_submission_course_id)
  );
end;
$$;

-- 원본과 연결된 답변·내부 기록을 함께 지운다 (외래 키 on delete cascade)
create or replace function public.admin_delete_submission(p_id uuid, p_confirm_student_name text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  s public.submissions;
  n integer;
begin
  perform public.assert_admin();
  select * into s from public.submissions where id = p_id for update;
  if s.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if btrim(coalesce(p_confirm_student_name, '')) <> s.student_name then
    raise exception 'confirm_mismatch' using errcode = 'P0001';
  end if;
  select count(*) into n from public.submission_courses where submission_id = p_id;
  delete from public.submissions where id = p_id;
  insert into public.deletion_log (deleted_by, course_count, received_at) values ((select auth.uid()), n, s.received_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- 권한: 공개 함수 두 개만 anon 에 열고, 나머지는 로그인 사용자(관리자 확인은 함수 안에서)
-- Supabase 는 새 함수에 anon 실행 권한을 기본으로 주므로 명시적으로 회수한다.
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname like 'admin\_%' or f.proname in ('am_i_admin', 'is_admin') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

grant execute on function public.get_public_form(text) to anon, authenticated;
grant execute on function public.submit_consultation(text, uuid, jsonb) to anon, authenticated;
-- 관리자 함수 내부와 RLS 정책에서 쓰는 보조 함수
grant execute on function public.assert_admin() to authenticated;
grant execute on function public.text_field_error(jsonb, boolean, integer) to authenticated;
grant execute on function public.questions_error(jsonb) to authenticated;
grant execute on function public.question_types() to authenticated;
grant execute on function public.question_roles() to authenticated;
grant execute on function public.is_valid_date_text(text) to authenticated;
grant execute on function public.applicable_questions(jsonb, uuid) to authenticated;
grant execute on function public.answer_value_json(public.answers) to authenticated;
grant execute on function public.submission_detail_json(uuid) to authenticated;
grant execute on function public.strip_course_targets(jsonb) to authenticated;
grant execute on function public.latest_questions(uuid) to authenticated;
grant execute on function public.standard_subject_questions(jsonb, jsonb) to authenticated;
grant execute on function public.generic_difficulty_options() to authenticated;
grant execute on function public.new_invitation_token() to authenticated;
grant execute on function public.invitation_state(public.invitations) to authenticated;
grant execute on function public.touch_updated_at() to authenticated;
grant execute on function public.protect_published_version() to authenticated;
grant execute on function public.prevent_original_update() to authenticated;
