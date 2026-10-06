-- 학부모(익명) 공개 API
--  * get_public_form : 유효한 초대 링크로 안내·질문만 조회
--  * submit_consultation : 검증 후 한 트랜잭션으로 저장 (복수 수업 일부 저장 없음)
-- 두 함수 모두 security definer 이며, 응답을 돌려주거나 기존 제출을 조회하지 않는다.

create or replace function public.seoul_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Seoul')::date $$;

-- 양식 버전이 바뀐 직후에 이전 버전으로 작성 중이던 사람도 제출할 수 있게 허용하는 기간
create or replace function public.version_grace_period()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '7 days' $$;

create or replace function public.version_accepts_submissions(p_version public.form_versions)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_version.status = 'published'
    or (p_version.status = 'superseded' and p_version.superseded_at > now() - public.version_grace_period());
$$;

create or replace function public.course_public_json(c public.courses)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'subject_id', s.id,
    'subject_name', s.name,
    'subject_description', s.description,
    'subject_perspective', s.perspective,
    'school_level', c.school_level,
    'grades', to_jsonb(c.grades),
    'scope_text', c.scope_text,
    'mode', c.mode,
    'group_type', c.group_type,
    'sessions_per_week', c.sessions_per_week,
    'minutes_per_session', c.minutes_per_session,
    'weekdays', to_jsonb(c.weekdays),
    'time_bands', to_jsonb(c.time_bands),
    'start_time', to_char(c.start_time, 'HH24:MI'),
    'time_note', c.time_note,
    'start_date', c.start_date,
    'duration_text', c.duration_text,
    'session_choices', to_jsonb(c.session_choices),
    'fixed_conditions', to_jsonb(c.fixed_conditions),
    'notice', c.notice
  )
  from public.subjects s
  where s.id = c.subject_id;
$$;
revoke all on function public.course_public_json(public.courses) from public;

-- 초대 링크 상태 확인. 열려 있으면 'open', 아니면 사유 코드.
create or replace function public.invitation_state(p_inv public.invitations)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_inv.id is null then
    return 'invalid';
  end if;
  if not p_inv.is_active then
    return 'closed';
  end if;
  if p_inv.expires_at is not null and p_inv.expires_at <= now() then
    return 'expired';
  end if;
  if p_inv.max_submissions is not null then
    select count(*) into n from public.submissions where invitation_id = p_inv.id;
    if n >= p_inv.max_submissions then
      return 'full';
    end if;
  end if;
  if not exists (select 1 from public.app_settings where id = 1 and privacy_confirmed) then
    return 'not_ready';
  end if;
  return 'open';
end;
$$;
revoke all on function public.invitation_state(public.invitations) from public;

-- 링크에 연결된 수업 중 지금 접수 가능한 수업과 그 발행 버전
create or replace function public.open_invitation_courses(p_invitation_id uuid)
returns table (course public.courses, version public.form_versions, sort_order integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c, v, ic.sort_order
  from public.invitation_courses ic
  join public.courses c on c.id = ic.course_id
  join public.subjects s on s.id = c.subject_id
  join public.form_versions v on v.template_id = c.template_id and v.status = 'published'
  where ic.invitation_id = p_invitation_id
    and c.status = 'open'
    and s.is_active
    and s.archived_at is null
  order by ic.sort_order, c.sort_order, c.name;
$$;
revoke all on function public.open_invitation_courses(uuid) from public;

create or replace function public.get_public_form(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  inv public.invitations;
  st public.app_settings;
  state text;
  common_v public.form_versions;
  courses jsonb;
begin
  select * into st from public.app_settings where id = 1;

  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    return jsonb_build_object('status', 'invalid', 'settings', public.public_settings_json(st));
  end if;

  select * into inv from public.invitations where token = p_token;
  state := public.invitation_state(inv);
  if state <> 'open' then
    return jsonb_build_object('status', state, 'settings', public.public_settings_json(st));
  end if;

  select coalesce(jsonb_agg(
           public.course_public_json(oc.course)
           || jsonb_build_object(
                'version_id', (oc.version).id,
                'version_no', (oc.version).version_no,
                'questions', public.public_questions((oc.version).questions, (oc.course).id)
              )
           order by oc.sort_order, (oc.course).sort_order, (oc.course).name), '[]'::jsonb)
    into courses
  from public.open_invitation_courses(inv.id) oc;

  if jsonb_array_length(courses) = 0 then
    return jsonb_build_object('status', 'closed', 'settings', public.public_settings_json(st));
  end if;

  select v.* into common_v
  from public.form_versions v
  join public.form_templates t on t.id = v.template_id
  where t.kind = 'common' and v.status = 'published';

  return jsonb_build_object(
    'status', 'open',
    'loaded_at', now(),
    'today', public.seoul_today(),
    'settings', public.public_settings_json(st) || jsonb_build_object(
      'operator_name', st.operator_name,
      'operator_contact', st.operator_contact,
      'privacy_purpose', st.privacy_purpose,
      'privacy_retention', st.privacy_retention,
      'privacy_deletion', st.privacy_deletion
    ),
    'allow_multiple', inv.allow_multiple,
    'common', case when common_v.id is null then null else jsonb_build_object(
      'version_id', common_v.id,
      'version_no', common_v.version_no,
      'questions', public.public_questions(common_v.questions, null)
    ) end,
    'courses', courses
  );
end;
$$;

-- 상태와 관계없이 화면 머리말에 필요한 최소한의 설정
create or replace function public.public_settings_json(st public.app_settings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'service_name', coalesce(st.service_name, '수업 준비실'),
    'parent_title', coalesce(st.parent_title, '수업 전 학습 상담'),
    'teacher_name', coalesce(st.teacher_name, ''),
    'teacher_intro', coalesce(st.teacher_intro, ''),
    'intro_eyebrow', coalesce(st.intro_eyebrow, ''),
    'intro_title', coalesce(st.intro_title, ''),
    'intro_body', coalesce(st.intro_body, ''),
    'intro_note', coalesce(st.intro_note, ''),
    'completion_message', coalesce(st.completion_message, ''),
    'policy_notice', coalesce(st.policy_notice, '')
  );
$$;

-- ---------------------------------------------------------------------------
-- 제출
-- ---------------------------------------------------------------------------

create or replace function public.normalize_phone(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text;
begin
  if p is null or p !~ '^[0-9+()\s.-]{9,20}$' then
    return null;
  end if;
  d := regexp_replace(p, '[^0-9]', '', 'g');
  if left(btrim(p), 1) = '+' then
    if left(d, 2) <> '82' then
      return null;
    end if;
    d := '0' || substr(d, 3);
  end if;
  if d ~ '^01[016789][0-9]{7,8}$' then
    return d;
  end if;
  return null;
end;
$$;

create or replace function public.text_field_error(p_value jsonb, p_required boolean, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then case when p_required then 'required' end
    when jsonb_typeof(p_value) <> 'string' then 'invalid'
    when btrim(p_value #>> '{}') = '' then case when p_required then 'required' end
    when char_length(p_value #>> '{}') > p_max then 'too_long'
  end;
$$;

create or replace function public.time_in_bands(p_time time, p_bands text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_length(p_bands, 1), 0) = 0
    or ('morning' = any (p_bands) and p_time >= time '06:00' and p_time < time '12:00')
    or ('afternoon' = any (p_bands) and p_time >= time '12:00' and p_time < time '18:00')
    or ('evening' = any (p_bands) and p_time >= time '18:00' and p_time <= time '23:00');
$$;

-- 수업별 일정 희망 검증. 확정된 조건은 묻지 않으므로 값이 오면 안 된다.
create or replace function public.schedule_errors(c public.courses, s jsonb, p_prefix text, p_today date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  errs jsonb := '[]'::jsonb;
  slot jsonb;
  needs_slots boolean;
  d date;
  tm time;
  n integer;
begin
  if s is null or jsonb_typeof(s) <> 'object' then
    return jsonb_build_array(jsonb_build_object('path', p_prefix, 'code', 'required'));
  end if;
  if exists (select 1 from jsonb_object_keys(s) k where k not in (
      'start_date', 'start_undecided', 'time_undecided', 'slots', 'duration', 'sessions_per_week', 'minutes',
      'mode', 'group_type', 'note')) then
    errs := errs || jsonb_build_object('path', p_prefix, 'code', 'invalid');
  end if;

  -- 첫 수업 희망 날짜
  if 'start_date' = any (c.fixed_conditions) then
    if coalesce(s ->> 'start_date', '') <> '' or coalesce((s ->> 'start_undecided')::boolean, false) then
      errs := errs || jsonb_build_object('path', p_prefix || '.start_date', 'code', 'not_allowed');
    end if;
  else
    if coalesce((s ->> 'start_undecided')::boolean, false) then
      if coalesce(s ->> 'start_date', '') <> '' then
        errs := errs || jsonb_build_object('path', p_prefix || '.start_date', 'code', 'conflict_undecided');
      end if;
    elsif coalesce(s ->> 'start_date', '') = '' then
      errs := errs || jsonb_build_object('path', p_prefix || '.start_date', 'code', 'required');
    elsif not public.is_valid_date_text(s ->> 'start_date') then
      errs := errs || jsonb_build_object('path', p_prefix || '.start_date', 'code', 'invalid');
    else
      d := (s ->> 'start_date')::date;
      if d < p_today or d > p_today + 366 then
        errs := errs || jsonb_build_object('path', p_prefix || '.start_date', 'code', 'out_of_range');
      end if;
    end if;
  end if;

  -- 가능한 요일·시작 시각
  needs_slots := not ('weekdays' = any (c.fixed_conditions) and 'start_time' = any (c.fixed_conditions));
  if s ? 'slots' and jsonb_typeof(s -> 'slots') <> 'array' then
    errs := errs || jsonb_build_object('path', p_prefix || '.slots', 'code', 'invalid');
    return errs;
  end if;
  n := coalesce(jsonb_array_length(s -> 'slots'), 0);
  if not needs_slots then
    if n > 0 or coalesce((s ->> 'time_undecided')::boolean, false) then
      errs := errs || jsonb_build_object('path', p_prefix || '.slots', 'code', 'not_allowed');
    end if;
  elsif coalesce((s ->> 'time_undecided')::boolean, false) then
    if n > 0 then
      errs := errs || jsonb_build_object('path', p_prefix || '.slots', 'code', 'conflict_undecided');
    end if;
  elsif n = 0 then
    errs := errs || jsonb_build_object('path', p_prefix || '.slots', 'code', 'required');
  elsif n > 14 then
    errs := errs || jsonb_build_object('path', p_prefix || '.slots', 'code', 'too_many');
  else
    for slot in select value from jsonb_array_elements(s -> 'slots') loop
      if jsonb_typeof(slot) <> 'object'
        or jsonb_typeof(slot -> 'weekday') is distinct from 'number'
        or (slot ->> 'weekday') !~ '^[0-6]$'
        or jsonb_typeof(slot -> 'start_time') is distinct from 'string'
        or (slot ->> 'start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        errs := errs || jsonb_build_object('path', p_prefix || '.slots', 'code', 'invalid');
        exit;
      end if;
      tm := (slot ->> 'start_time')::time;
      if coalesce(array_length(c.weekdays, 1), 0) > 0 and not ((slot ->> 'weekday')::smallint = any (c.weekdays)) then
        errs := errs || jsonb_build_object('path', p_prefix || '.slots', 'code', 'weekday_not_offered');
        exit;
      end if;
      if 'start_time' = any (c.fixed_conditions) and c.start_time is not null and tm <> c.start_time then
        errs := errs || jsonb_build_object('path', p_prefix || '.slots', 'code', 'time_not_offered');
        exit;
      end if;
      if not ('start_time' = any (c.fixed_conditions)) and not public.time_in_bands(tm, c.time_bands) then
        errs := errs || jsonb_build_object('path', p_prefix || '.slots', 'code', 'time_not_offered');
        exit;
      end if;
    end loop;
    if (select count(distinct (x.value ->> 'weekday') || ' ' || (x.value ->> 'start_time')) from jsonb_array_elements(s -> 'slots') x) <> n then
      errs := errs || jsonb_build_object('path', p_prefix || '.slots', 'code', 'duplicate');
    end if;
  end if;

  -- 조율 가능한 조건만 희망을 받는다
  if 'duration' = any (c.fixed_conditions) then
    if coalesce(s ->> 'duration', '') <> '' then
      errs := errs || jsonb_build_object('path', p_prefix || '.duration', 'code', 'not_allowed');
    end if;
  elsif public.text_field_error(s -> 'duration', false, 60) is not null then
    errs := errs || jsonb_build_object('path', p_prefix || '.duration', 'code', public.text_field_error(s -> 'duration', false, 60));
  end if;

  if s ? 'sessions_per_week' and jsonb_typeof(s -> 'sessions_per_week') <> 'null' then
    if 'sessions' = any (c.fixed_conditions) then
      errs := errs || jsonb_build_object('path', p_prefix || '.sessions_per_week', 'code', 'not_allowed');
    elsif jsonb_typeof(s -> 'sessions_per_week') <> 'number' or (s ->> 'sessions_per_week') !~ '^[1-7]$' then
      errs := errs || jsonb_build_object('path', p_prefix || '.sessions_per_week', 'code', 'invalid');
    elsif coalesce(array_length(c.session_choices, 1), 0) > 0 and not ((s ->> 'sessions_per_week')::smallint = any (c.session_choices)) then
      errs := errs || jsonb_build_object('path', p_prefix || '.sessions_per_week', 'code', 'invalid_option');
    end if;
  end if;

  if s ? 'minutes' and jsonb_typeof(s -> 'minutes') <> 'null' then
    if 'minutes' = any (c.fixed_conditions) then
      errs := errs || jsonb_build_object('path', p_prefix || '.minutes', 'code', 'not_allowed');
    elsif jsonb_typeof(s -> 'minutes') <> 'number' or (s ->> 'minutes') !~ '^[0-9]{2,3}$'
      or (s ->> 'minutes')::integer not between 10 and 600 then
      errs := errs || jsonb_build_object('path', p_prefix || '.minutes', 'code', 'invalid');
    end if;
  end if;

  if s ? 'mode' and jsonb_typeof(s -> 'mode') <> 'null' then
    if c.mode <> 'negotiable' then
      errs := errs || jsonb_build_object('path', p_prefix || '.mode', 'code', 'not_allowed');
    elsif (s ->> 'mode') not in ('in_person', 'online', 'hybrid', 'any') then
      errs := errs || jsonb_build_object('path', p_prefix || '.mode', 'code', 'invalid');
    end if;
  end if;

  if s ? 'group_type' and jsonb_typeof(s -> 'group_type') <> 'null' then
    if c.group_type <> 'negotiable' then
      errs := errs || jsonb_build_object('path', p_prefix || '.group_type', 'code', 'not_allowed');
    elsif (s ->> 'group_type') not in ('individual', 'group', 'any') then
      errs := errs || jsonb_build_object('path', p_prefix || '.group_type', 'code', 'invalid');
    end if;
  end if;

  if public.text_field_error(s -> 'note', false, 500) is not null then
    errs := errs || jsonb_build_object('path', p_prefix || '.note', 'code', public.text_field_error(s -> 'note', false, 500));
  end if;

  return errs;
end;
$$;

create or replace function public.assessments_errors(p jsonb, p_prefix text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  errs jsonb := '[]'::jsonb;
  a jsonb;
  i integer := -1;
  path text;
begin
  if p is null or jsonb_typeof(p) = 'null' then
    return errs;
  end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 8 then
    return jsonb_build_array(jsonb_build_object('path', p_prefix, 'code', 'invalid'));
  end if;
  for a in select value from jsonb_array_elements(p) loop
    i := i + 1;
    path := p_prefix || '.' || i;
    if jsonb_typeof(a) <> 'object'
      or exists (select 1 from jsonb_object_keys(a) k where k not in ('kind', 'name', 'status', 'period_start', 'period_end', 'exam_date', 'scope'))
      or coalesce(a ->> 'kind', '') not in ('midterm', 'final', 'performance', 'unit', 'other')
      or coalesce(a ->> 'status', '') not in ('entered', 'finished', 'unknown', 'undecided', 'not_applicable') then
      errs := errs || jsonb_build_object('path', path, 'code', 'invalid');
      continue;
    end if;
    if public.text_field_error(a -> 'name', true, 30) is not null then
      errs := errs || jsonb_build_object('path', path || '.name', 'code', public.text_field_error(a -> 'name', true, 30));
    end if;
    if a ->> 'status' = 'entered' then
      if coalesce(a ->> 'period_start', '') = '' and coalesce(a ->> 'period_end', '') = ''
        and coalesce(a ->> 'exam_date', '') = '' and btrim(coalesce(a ->> 'scope', '')) = '' then
        errs := errs || jsonb_build_object('path', path, 'code', 'empty_entry');
      end if;
      if coalesce(a ->> 'period_start', '') <> '' and not public.is_valid_date_text(a ->> 'period_start') then
        errs := errs || jsonb_build_object('path', path || '.period_start', 'code', 'invalid');
      end if;
      if coalesce(a ->> 'period_end', '') <> '' and not public.is_valid_date_text(a ->> 'period_end') then
        errs := errs || jsonb_build_object('path', path || '.period_end', 'code', 'invalid');
      end if;
      if coalesce(a ->> 'exam_date', '') <> '' and not public.is_valid_date_text(a ->> 'exam_date') then
        errs := errs || jsonb_build_object('path', path || '.exam_date', 'code', 'invalid');
      end if;
      if public.is_valid_date_text(a ->> 'period_start') and public.is_valid_date_text(a ->> 'period_end')
        and (a ->> 'period_start')::date > (a ->> 'period_end')::date then
        errs := errs || jsonb_build_object('path', path || '.period_end', 'code', 'before_start');
      end if;
      if public.text_field_error(a -> 'scope', false, 300) is not null then
        errs := errs || jsonb_build_object('path', path || '.scope', 'code', public.text_field_error(a -> 'scope', false, 300));
      end if;
    elsif coalesce(a ->> 'period_start', '') <> '' or coalesce(a ->> 'period_end', '') <> ''
      or coalesce(a ->> 'exam_date', '') <> '' or btrim(coalesce(a ->> 'scope', '')) <> '' then
      errs := errs || jsonb_build_object('path', path, 'code', 'conflict_status');
    end if;
  end loop;
  return errs;
end;
$$;

create or replace function public.count_unknown_answers(p_questions jsonb, p_answers jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer
  from jsonb_array_elements(p_questions) q
  where coalesce(p_answers, '{}'::jsonb) -> (q.value ->> 'id') ->> 'status' = 'unknown';
$$;

create or replace function public.store_answers(
  p_submission_id uuid, p_submission_course_id uuid, p_version_id uuid, p_questions jsonb, p_answers jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  q jsonb;
  a jsonb;
  t text;
  unknowns integer := 0;
begin
  for q in select value from jsonb_array_elements(p_questions) loop
    a := p_answers -> (q ->> 'id');
    if a is null or jsonb_typeof(a) = 'null' then
      continue;
    end if;
    t := q ->> 'type';
    if a ->> 'status' = 'unknown' then
      unknowns := unknowns + 1;
      insert into public.answers (submission_id, submission_course_id, form_version_id, question_key, status)
      values (p_submission_id, p_submission_course_id, p_version_id, q ->> 'id', 'unknown');
    else
      insert into public.answers (
        submission_id, submission_course_id, form_version_id, question_key, status,
        value_text, value_number, value_date, value_time, value_choices)
      values (
        p_submission_id, p_submission_course_id, p_version_id, q ->> 'id', 'answered',
        case when t in ('short_text', 'long_text', 'single') then btrim(a ->> 'value') end,
        case when t = 'number' then (a ->> 'value')::numeric end,
        case when t = 'date' then (a ->> 'value')::date end,
        case when t = 'time' then (a ->> 'value')::time end,
        case when t = 'multi' then array(select jsonb_array_elements_text(a -> 'value')) end
      );
    end if;
  end loop;
  return unknowns;
end;
$$;
revoke all on function public.store_answers(uuid, uuid, uuid, jsonb, jsonb) from public;

create or replace function public.submit_consultation(p_token text, p_idempotency_key uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  inv public.invitations;
  state text;
  existing public.submissions;
  common jsonb;
  errs jsonb := '[]'::jsonb;
  course_items jsonb;
  item jsonb;
  c public.courses;
  v public.form_versions;
  common_v public.form_versions;
  common_q jsonb := '[]'::jsonb;
  qs jsonb;
  today date := public.seoul_today();
  i integer;
  n_courses integer;
  lvl text;
  grade_val smallint;
  sub_id uuid;
  sc_id uuid;
  receipt text;
  st public.app_settings;
  unknowns integer;
  a jsonb;
  ip text;
  ip_bucket text;
  s jsonb;
  seen_courses uuid[] := '{}';
  phone text;
  grade_key text;
begin
  if p_idempotency_key is null then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  -- 같은 요청이 다시 오면 처음 결과를 돌려준다 (중복 생성 방지)
  select * into existing from public.submissions where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'receipt_code', existing.receipt_code, 'duplicate', true);
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  -- 스팸 방지용 숨은 칸
  if coalesce(p_payload ->> 'website', '') <> '' then
    raise exception 'rejected' using errcode = 'P0001';
  end if;

  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;
  select * into inv from public.invitations where token = p_token for share;
  state := public.invitation_state(inv);
  if state = 'invalid' then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  elsif state <> 'open' then
    raise exception 'invitation_closed' using errcode = 'P0001', detail = state;
  end if;

  -- 요청 제한: 링크당 1시간 30건, 같은 접속 주소(해시)당 10분 5건
  delete from public.submission_rate_events where created_at < now() - interval '1 day';
  if (select count(*) from public.submission_rate_events
      where bucket = 'inv:' || inv.id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  begin
    ip := split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1);
  exception when others then
    ip := '';
  end;
  if btrim(ip) <> '' then
    ip_bucket := 'ip:' || encode(sha256(convert_to(btrim(ip) || ':' || inv.id::text, 'UTF8')), 'hex');
    if (select count(*) from public.submission_rate_events
        where bucket = ip_bucket and created_at > now() - interval '10 minutes') >= 5 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;

  -- 공통 정보
  common := p_payload -> 'common';
  if common is null or jsonb_typeof(common) <> 'object' then
    raise exception 'validation_failed' using errcode = 'P0001',
      detail = jsonb_build_array(jsonb_build_object('path', 'common', 'code', 'required'))::text;
  end if;

  if public.text_field_error(common -> 'parent_name', true, 30) is not null then
    errs := errs || jsonb_build_object('path', 'common.parent_name', 'code', public.text_field_error(common -> 'parent_name', true, 30));
  end if;
  if public.text_field_error(common -> 'parent_phone', true, 20) is not null then
    errs := errs || jsonb_build_object('path', 'common.parent_phone', 'code', public.text_field_error(common -> 'parent_phone', true, 20));
  else
    phone := public.normalize_phone(common ->> 'parent_phone');
    if phone is null then
      errs := errs || jsonb_build_object('path', 'common.parent_phone', 'code', 'invalid_phone');
    end if;
  end if;
  if public.text_field_error(common -> 'student_name', true, 30) is not null then
    errs := errs || jsonb_build_object('path', 'common.student_name', 'code', public.text_field_error(common -> 'student_name', true, 30));
  end if;

  lvl := common ->> 'school_level';
  if lvl is null or lvl not in ('elementary', 'middle', 'high', 'other') then
    errs := errs || jsonb_build_object('path', 'common.grade', 'code', 'required');
  elsif lvl = 'other' then
    if public.text_field_error(common -> 'grade_note', true, 30) is not null then
      errs := errs || jsonb_build_object('path', 'common.grade_note', 'code', public.text_field_error(common -> 'grade_note', true, 30));
    end if;
  else
    if jsonb_typeof(common -> 'grade') is distinct from 'number' or (common ->> 'grade') !~ '^[1-6]$'
      or (lvl in ('middle', 'high') and (common ->> 'grade')::integer > 3) then
      errs := errs || jsonb_build_object('path', 'common.grade', 'code', 'required');
    else
      grade_val := (common ->> 'grade')::smallint;
    end if;
  end if;

  grade_key := case when lvl = 'other' then 'other' when grade_val is not null then lvl || '-' || grade_val end;

  if public.text_field_error(common -> 'school_name', false, 40) is not null then
    errs := errs || jsonb_build_object('path', 'common.school_name', 'code', public.text_field_error(common -> 'school_name', false, 40));
  end if;
  if public.text_field_error(common -> 'general_request', false, 1000) is not null then
    errs := errs || jsonb_build_object('path', 'common.general_request', 'code', public.text_field_error(common -> 'general_request', false, 1000));
  end if;

  if (p_payload -> 'consent') is distinct from 'true'::jsonb then
    errs := errs || jsonb_build_object('path', 'consent', 'code', 'required');
  end if;

  -- 공통 추가 질문
  select v2.* into common_v
  from public.form_versions v2
  join public.form_templates t on t.id = v2.template_id and t.kind = 'common'
  where v2.id = case when (common ->> 'version_id') ~ '^[0-9a-f-]{36}$' then (common ->> 'version_id')::uuid end;
  if common ? 'version_id' and jsonb_typeof(common -> 'version_id') <> 'null' then
    if common_v.id is null or not public.version_accepts_submissions(common_v) then
      raise exception 'form_outdated' using errcode = 'P0001';
    end if;
    common_q := public.applicable_questions(common_v.questions, null);
    errs := errs || public.answers_errors(common_q, common -> 'answers', 'common.answers', grade_key);
  elsif exists (
    select 1 from public.form_versions v3 join public.form_templates t on t.id = v3.template_id
    where t.kind = 'common' and v3.status = 'published'
      and jsonb_array_length(public.applicable_questions(v3.questions, null)) > 0
  ) then
    raise exception 'form_outdated' using errcode = 'P0001';
  end if;

  -- 수업
  course_items := p_payload -> 'courses';
  if course_items is null or jsonb_typeof(course_items) <> 'array' or jsonb_array_length(course_items) = 0 then
    errs := errs || jsonb_build_object('path', 'courses', 'code', 'required');
    raise exception 'validation_failed' using errcode = 'P0001', detail = errs::text;
  end if;
  n_courses := jsonb_array_length(course_items);
  if n_courses > 10 or (not inv.allow_multiple and n_courses > 1) then
    raise exception 'validation_failed' using errcode = 'P0001',
      detail = (errs || jsonb_build_object('path', 'courses', 'code', 'too_many'))::text;
  end if;

  if n_courses > 1 then
    if coalesce(common ->> 'consecutive_request', '') not in ('', 'yes', 'no', 'either') then
      errs := errs || jsonb_build_object('path', 'common.consecutive_request', 'code', 'invalid');
    end if;
    if public.text_field_error(common -> 'consecutive_note', false, 300) is not null then
      errs := errs || jsonb_build_object('path', 'common.consecutive_note', 'code', 'too_long');
    end if;
  end if;

  i := -1;
  for item in select value from jsonb_array_elements(course_items) loop
    i := i + 1;
    if jsonb_typeof(item) <> 'object' or (item ->> 'course_id') !~ '^[0-9a-f-]{36}$' or (item ->> 'version_id') !~ '^[0-9a-f-]{36}$' then
      raise exception 'validation_failed' using errcode = 'P0001',
        detail = (errs || jsonb_build_object('path', 'courses.' || i, 'code', 'invalid'))::text;
    end if;
    if (item ->> 'course_id')::uuid = any (seen_courses) then
      raise exception 'validation_failed' using errcode = 'P0001',
        detail = (errs || jsonb_build_object('path', 'courses.' || i, 'code', 'duplicate'))::text;
    end if;
    seen_courses := seen_courses || (item ->> 'course_id')::uuid;

    -- 초대 링크가 허용한, 지금 접수 중인 수업인지 확인
    select (oc.course).* into c
    from public.open_invitation_courses(inv.id) oc
    where (oc.course).id = (item ->> 'course_id')::uuid;
    if c.id is null then
      raise exception 'course_unavailable' using errcode = 'P0001', detail = item ->> 'course_id';
    end if;

    select * into v from public.form_versions where id = (item ->> 'version_id')::uuid;
    if v.id is null or v.template_id <> c.template_id or not public.version_accepts_submissions(v) then
      raise exception 'form_outdated' using errcode = 'P0001';
    end if;

    qs := public.applicable_questions(v.questions, c.id);
    errs := errs || public.answers_errors(qs, item -> 'answers', 'courses.' || i || '.answers', grade_key);
    errs := errs || public.schedule_errors(c, item -> 'schedule', 'courses.' || i || '.schedule', today);
    errs := errs || public.assessments_errors(item -> 'assessments', 'courses.' || i || '.assessments');
    if coalesce(item ->> 'homework_band', '') not in ('lt30', '30_60', '60_90', '90_120', 'gte120', 'tbd') then
      errs := errs || jsonb_build_object('path', 'courses.' || i || '.homework_band', 'code', 'required');
    end if;
  end loop;

  if jsonb_array_length(errs) > 0 then
    raise exception 'validation_failed' using errcode = 'P0001', detail = errs::text;
  end if;

  -- 저장 (이 함수 전체가 한 트랜잭션이므로 중간 실패 시 모두 취소된다)
  select * into st from public.app_settings where id = 1;
  receipt := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  begin
    insert into public.submissions (
      receipt_code, invitation_id, idempotency_key, parent_name, parent_phone, student_name, school_level, grade,
      grade_note, school_name, general_request, consecutive_request, consecutive_note, common_version_id,
      privacy_consented_at, privacy_snapshot, form_loaded_at, unknown_count)
    values (
      receipt, inv.id, p_idempotency_key, btrim(common ->> 'parent_name'), phone, btrim(common ->> 'student_name'), lvl,
      grade_val, case when lvl = 'other' then btrim(common ->> 'grade_note') else '' end,
      btrim(coalesce(common ->> 'school_name', '')), btrim(coalesce(common ->> 'general_request', '')),
      case when n_courses > 1 then nullif(common ->> 'consecutive_request', '') end,
      case when n_courses > 1 then btrim(coalesce(common ->> 'consecutive_note', '')) else '' end,
      common_v.id, now(),
      jsonb_build_object(
        'operator_name', st.operator_name, 'operator_contact', st.operator_contact, 'purpose', st.privacy_purpose,
        'retention', st.privacy_retention, 'deletion', st.privacy_deletion
      ),
      case when (p_payload ->> 'loaded_at') ~ '^\d{4}-\d{2}-\d{2}T' then (p_payload ->> 'loaded_at')::timestamptz end,
      public.count_unknown_answers(common_q, common -> 'answers')
    )
    returning id into sub_id;
  exception when unique_violation then
    -- 동시에 같은 키로 들어온 요청
    select * into existing from public.submissions where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('ok', true, 'receipt_code', existing.receipt_code, 'duplicate', true);
    end if;
    raise;
  end;

  perform public.store_answers(sub_id, null, common_v.id, common_q, coalesce(common -> 'answers', '{}'::jsonb));
  i := -1;
  for item in select value from jsonb_array_elements(course_items) loop
    i := i + 1;
    select * into c from public.courses where id = (item ->> 'course_id')::uuid;
    select * into v from public.form_versions where id = (item ->> 'version_id')::uuid;
    s := item -> 'schedule';
    qs := public.applicable_questions(v.questions, c.id);
    -- 모름·미정으로 남은 항목 수 (src/lib/unknowns.ts 와 같은 규칙)
    unknowns := public.count_unknown_answers(qs, item -> 'answers')
      + (case when not ('start_date' = any (c.fixed_conditions)) and coalesce((s ->> 'start_undecided')::boolean, false) then 1 else 0 end)
      + (case when coalesce((s ->> 'time_undecided')::boolean, false) then 1 else 0 end)
      + (case when item ->> 'homework_band' = 'tbd' then 1 else 0 end)
      + (select count(*)::integer from jsonb_array_elements(coalesce(item -> 'assessments', '[]'::jsonb)) x
         where x.value ->> 'status' in ('unknown', 'undecided'));

    insert into public.submission_courses (
      submission_id, course_id, subject_id, form_version_id, position, course_snapshot,
      preferred_start_date, preferred_start_undecided, time_undecided, preferred_duration,
      requested_sessions_per_week, requested_minutes, requested_mode, requested_group_type, schedule_note, homework_band, unknown_count)
    values (
      sub_id, c.id, c.subject_id, v.id, i, public.course_public_json(c) || jsonb_build_object('version_no', v.version_no),
      case when not ('start_date' = any (c.fixed_conditions)) and not coalesce((s ->> 'start_undecided')::boolean, false)
        then (s ->> 'start_date')::date end,
      not ('start_date' = any (c.fixed_conditions)) and coalesce((s ->> 'start_undecided')::boolean, false),
      coalesce((s ->> 'time_undecided')::boolean, false),
      btrim(coalesce(s ->> 'duration', '')),
      (s ->> 'sessions_per_week')::smallint,
      (s ->> 'minutes')::smallint,
      nullif(s ->> 'mode', ''),
      nullif(s ->> 'group_type', ''),
      btrim(coalesce(s ->> 'note', '')),
      item ->> 'homework_band',
      unknowns
    )
    returning id into sc_id;

    insert into public.submission_course_slots (submission_course_id, weekday, start_time)
    select sc_id, (x.value ->> 'weekday')::smallint, (x.value ->> 'start_time')::time
    from jsonb_array_elements(coalesce(s -> 'slots', '[]'::jsonb)) x;

    insert into public.submission_assessments (
      submission_course_id, position, kind, name, status, period_start, period_end, exam_date, scope)
    select sc_id, (x.ordinality - 1)::smallint, x.value ->> 'kind', btrim(x.value ->> 'name'), x.value ->> 'status',
      case when x.value ->> 'status' = 'entered' then nullif(x.value ->> 'period_start', '')::date end,
      case when x.value ->> 'status' = 'entered' then nullif(x.value ->> 'period_end', '')::date end,
      case when x.value ->> 'status' = 'entered' then nullif(x.value ->> 'exam_date', '')::date end,
      case when x.value ->> 'status' = 'entered' then btrim(coalesce(x.value ->> 'scope', '')) else '' end
    from jsonb_array_elements(coalesce(item -> 'assessments', '[]'::jsonb)) with ordinality x;

    perform public.store_answers(sub_id, sc_id, v.id, qs, coalesce(item -> 'answers', '{}'::jsonb));
    insert into public.consultation_records (submission_course_id) values (sc_id);
  end loop;

  insert into public.submission_rate_events (bucket) values ('inv:' || inv.id);
  if ip_bucket is not null then
    insert into public.submission_rate_events (bucket) values (ip_bucket);
  end if;

  return jsonb_build_object('ok', true, 'receipt_code', receipt, 'duplicate', false);
end;
$$;

revoke all on function public.get_public_form(text) from public;
revoke all on function public.submit_consultation(text, uuid, jsonb) from public;
grant execute on function public.get_public_form(text) to anon, authenticated;
grant execute on function public.submit_consultation(text, uuid, jsonb) to anon, authenticated;
