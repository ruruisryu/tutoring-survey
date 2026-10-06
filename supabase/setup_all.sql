-- 수업 준비실: 전체 설치 SQL (supabase/migrations 를 순서대로 합친 파일 · 직접 수정하지 말 것)
-- 새 Supabase 프로젝트의 SQL Editor 에 붙여넣어 한 번만 실행한다.
-- 개발용 예시 데이터(supabase/local)는 포함하지 않는다.

-- ============================================================
-- 20261005000100_schema.sql
-- ============================================================
-- 수업 준비실: 기본 스키마
-- 원칙
--  * 핵심 조회 정보는 관계형 컬럼으로, 설문 질문 정의(버전 스냅샷)만 검증된 jsonb로 보관한다.
--  * 학부모 원본(submissions, submission_courses, answers, ...)과 선생님 내부 기록(consultation_records)을 분리한다.
--  * 모든 테이블에 RLS를 켜고, 익명 사용자는 테이블에 직접 접근할 수 없다(공개 함수만 사용).

-- ---------------------------------------------------------------------------
-- 관리자
-- ---------------------------------------------------------------------------
create table public.admin_memberships (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

comment on table public.admin_memberships is
  '데이터에 접근할 수 있는 관리자 목록. SQL 편집기(서버 권한)에서만 추가한다. 클라이언트에는 쓰기 정책이 없다.';

-- ---------------------------------------------------------------------------
-- 운영 설정 (단일 행)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  service_name text not null default '수업 준비실' check (char_length(service_name) between 1 and 40),
  parent_title text not null default '수업 전 학습 상담' check (char_length(parent_title) between 1 and 40),
  teacher_name text not null default '' check (char_length(teacher_name) <= 20),
  teacher_intro text not null default '' check (char_length(teacher_intro) <= 600),
  intro_eyebrow text not null default '' check (char_length(intro_eyebrow) <= 60),
  intro_title text not null default '' check (char_length(intro_title) <= 80),
  intro_body text not null default '' check (char_length(intro_body) <= 400),
  intro_note text not null default '' check (char_length(intro_note) <= 200),
  completion_message text not null default '' check (char_length(completion_message) <= 400),
  -- 수업료·환불·취소 같은 공통 안내 (학부모 첫 화면과 검토 화면에 표시)
  policy_notice text not null default '' check (char_length(policy_notice) <= 1000),
  -- 개인정보 안내 (공개 접수 전에 운영자가 확정해야 함)
  operator_name text not null default '' check (char_length(operator_name) <= 40),
  operator_contact text not null default '' check (char_length(operator_contact) <= 80),
  privacy_purpose text not null default '' check (char_length(privacy_purpose) <= 400),
  privacy_retention text not null default '' check (char_length(privacy_retention) <= 200),
  privacy_deletion text not null default '' check (char_length(privacy_deletion) <= 300),
  privacy_confirmed boolean not null default false,
  privacy_confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 과목
-- ---------------------------------------------------------------------------
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  description text not null default '' check (char_length(description) <= 300),
  perspective text not null default '' check (char_length(perspective) <= 400),
  sort_order integer not null default 100,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index subjects_name_key on public.subjects (lower(name)) where archived_at is null;

-- ---------------------------------------------------------------------------
-- 설문 양식과 버전
--   kind = 'common'  : 모든 제출에 한 번 묻는 공통 추가 질문 (1개만 존재)
--   kind = 'subject' : 과목별 학습 질문 (수업이 하나를 선택)
-- ---------------------------------------------------------------------------
create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('common', 'subject')),
  subject_id uuid references public.subjects (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'common') = (subject_id is null))
);
create unique index form_templates_single_common on public.form_templates (kind) where kind = 'common';

alter table public.subjects
  add column default_template_id uuid references public.form_templates (id) on delete set null;

create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.form_templates (id) on delete restrict,
  version_no integer,                       -- 발행 시 부여 (초안은 null)
  status text not null check (status in ('draft', 'published', 'superseded')),
  questions jsonb not null default '[]'::jsonb,
  published_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'draft') = (version_no is null)),
  check (status = 'draft' or published_at is not null),
  unique (template_id, version_no)
);
create unique index form_versions_one_draft on public.form_versions (template_id) where status = 'draft';
create unique index form_versions_one_published on public.form_versions (template_id) where status = 'published';

-- ---------------------------------------------------------------------------
-- 수업
-- ---------------------------------------------------------------------------
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete restrict,
  template_id uuid not null references public.form_templates (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 60),
  school_level text not null check (school_level in ('elementary', 'middle', 'high', 'any')),
  grades smallint[] not null default '{}',
  scope_text text not null default '' check (char_length(scope_text) <= 200),
  mode text not null default 'negotiable' check (mode in ('in_person', 'online', 'hybrid', 'negotiable')),
  group_type text not null default 'negotiable' check (group_type in ('individual', 'group', 'negotiable')),
  sessions_per_week smallint check (sessions_per_week between 1 and 7),
  minutes_per_session smallint check (minutes_per_session between 10 and 600),
  weekdays smallint[] not null default '{}',     -- 0=일 ... 6=토, 빈 배열 = 협의
  time_bands text[] not null default '{}',        -- morning / afternoon / evening
  start_time time,                                -- 정해진 시작 시각(있을 때)
  time_note text not null default '' check (char_length(time_note) <= 120),
  start_date date,
  duration_text text not null default '' check (char_length(duration_text) <= 60),
  -- 확정된 조건. 여기 없는 조건은 학부모에게 희망을 묻는다.
  fixed_conditions text[] not null default '{}',
  -- 주당 횟수를 조율할 때 학부모가 고를 수 있는 값 (빈 배열 = 1~5회)
  session_choices smallint[] not null default '{}',
  notice text not null default '' check (char_length(notice) <= 800),
  status text not null default 'open' check (status in ('open', 'closed', 'archived')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fixed_conditions <@ array['weekdays', 'start_time', 'minutes', 'sessions', 'mode', 'group_type', 'start_date', 'duration']::text[]),
  check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  check (time_bands <@ array['morning', 'afternoon', 'evening']::text[]),
  check (grades <@ array[1, 2, 3, 4, 5, 6]::smallint[]),
  check (session_choices <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
);

-- ---------------------------------------------------------------------------
-- 초대 링크
-- ---------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{32,128}$'),
  label text not null default '' check (char_length(label) <= 60),
  allow_multiple boolean not null default false,
  is_active boolean not null default true,
  expires_at timestamptz,
  max_submissions integer check (max_submissions > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invitation_courses (
  invitation_id uuid not null references public.invitations (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete restrict,
  sort_order integer not null default 0,
  primary key (invitation_id, course_id)
);

-- ---------------------------------------------------------------------------
-- 학부모 제출 원본
-- ---------------------------------------------------------------------------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  receipt_code text not null unique,
  invitation_id uuid references public.invitations (id) on delete set null,
  idempotency_key uuid not null unique,
  received_at timestamptz not null default now(),
  parent_name text not null check (char_length(parent_name) between 1 and 30),
  parent_phone text not null check (parent_phone ~ '^0[0-9]{8,10}$'),
  student_name text not null check (char_length(student_name) between 1 and 30),
  school_level text not null check (school_level in ('elementary', 'middle', 'high', 'other')),
  grade smallint check (grade between 1 and 6),
  grade_note text not null default '' check (char_length(grade_note) <= 30),
  school_name text not null default '' check (char_length(school_name) <= 40),
  general_request text not null default '' check (char_length(general_request) <= 1000),
  consecutive_request text check (consecutive_request in ('yes', 'no', 'either')),
  consecutive_note text not null default '' check (char_length(consecutive_note) <= 300),
  common_version_id uuid references public.form_versions (id) on delete restrict,
  privacy_consented_at timestamptz not null,
  privacy_snapshot jsonb not null,           -- 동의 당시 안내 문구
  form_loaded_at timestamptz,
  unknown_count smallint not null default 0,  -- 공통 질문 중 모름으로 남은 개수
  check ((school_level in ('elementary', 'middle', 'high')) = (grade is not null)),
  check (school_level <> 'middle' or grade <= 3),
  check (school_level <> 'high' or grade <= 3)
);
create index submissions_received_at_idx on public.submissions (received_at desc);

create table public.submission_courses (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  course_id uuid references public.courses (id) on delete restrict,
  subject_id uuid references public.subjects (id) on delete restrict,
  form_version_id uuid not null references public.form_versions (id) on delete restrict,
  position smallint not null default 0,
  course_snapshot jsonb not null,            -- 제출 당시 수업 이름·조건·안내
  -- 일정 희망 (학부모 원본)
  preferred_start_date date,
  preferred_start_undecided boolean not null default false,
  time_undecided boolean not null default false,
  preferred_duration text not null default '' check (char_length(preferred_duration) <= 60),
  requested_sessions_per_week smallint check (requested_sessions_per_week between 1 and 7),
  requested_minutes smallint check (requested_minutes between 10 and 600),
  requested_mode text check (requested_mode in ('in_person', 'online', 'hybrid', 'any')),
  requested_group_type text check (requested_group_type in ('individual', 'group', 'any')),
  schedule_note text not null default '' check (char_length(schedule_note) <= 500),
  homework_band text not null check (homework_band in ('lt30', '30_60', '60_90', '90_120', 'gte120', 'tbd')),
  unknown_count smallint not null default 0,
  unique (submission_id, course_id),
  check (not (preferred_start_undecided and preferred_start_date is not null))
);
create index submission_courses_submission_idx on public.submission_courses (submission_id);
create index submission_courses_course_idx on public.submission_courses (course_id);

create table public.submission_course_slots (
  id uuid primary key default gen_random_uuid(),
  submission_course_id uuid not null references public.submission_courses (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  unique (submission_course_id, weekday, start_time)
);

create table public.submission_assessments (
  id uuid primary key default gen_random_uuid(),
  submission_course_id uuid not null references public.submission_courses (id) on delete cascade,
  position smallint not null default 0,
  kind text not null check (kind in ('midterm', 'final', 'performance', 'unit', 'other')),
  name text not null check (char_length(name) between 1 and 30),
  status text not null check (status in ('entered', 'finished', 'unknown', 'undecided', 'not_applicable')),
  period_start date,
  period_end date,
  exam_date date,
  scope text not null default '' check (char_length(scope) <= 300),
  check (status = 'entered' or (period_start is null and period_end is null and exam_date is null and scope = '')),
  check (period_start is null or period_end is null or period_start <= period_end)
);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  submission_course_id uuid references public.submission_courses (id) on delete cascade,
  form_version_id uuid not null references public.form_versions (id) on delete restrict,
  question_key text not null check (question_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  status text not null check (status in ('answered', 'unknown')),
  value_text text check (char_length(value_text) <= 2000),
  value_number numeric,
  value_date date,
  value_time time,
  value_choices text[],
  check (status = 'answered' or (value_text is null and value_number is null and value_date is null and value_time is null and value_choices is null))
);
create unique index answers_common_key on public.answers (submission_id, question_key) where submission_course_id is null;
create unique index answers_course_key on public.answers (submission_course_id, question_key) where submission_course_id is not null;

-- ---------------------------------------------------------------------------
-- 선생님 내부 기록 (수업별)
-- ---------------------------------------------------------------------------
create table public.consultation_records (
  submission_course_id uuid primary key references public.submission_courses (id) on delete cascade,
  status text not null default 'new' check (status in ('new', 'reviewing', 'needs_info', 'scheduled', 'on_hold')),
  consult_memo text not null default '' check (char_length(consult_memo) <= 5000),
  plan_memo text not null default '' check (char_length(plan_memo) <= 5000),
  confirmed_start_date date,
  confirmed_minutes smallint check (confirmed_minutes between 10 and 600),
  next_contact_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.consultation_slots (
  id uuid primary key default gen_random_uuid(),
  submission_course_id uuid not null references public.consultation_records (submission_course_id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  unique (submission_course_id, weekday, start_time)
);

-- 삭제 기록 (개인정보 없이 언제 몇 건을 지웠는지만 남김)
create table public.deletion_log (
  id bigint generated always as identity primary key,
  deleted_at timestamptz not null default now(),
  deleted_by uuid,
  course_count integer not null,
  received_at timestamptz
);

-- 제출 요청 제한용 (개인정보 대신 해시만 저장, 하루 지나면 정리)
create table public.submission_rate_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index submission_rate_events_bucket_idx on public.submission_rate_events (bucket, created_at);

-- ---------------------------------------------------------------------------
-- RLS: 모든 테이블에 켜고, 관리자 정책만 둔다.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_memberships m where m.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'admin_memberships', 'app_settings', 'subjects', 'form_templates', 'form_versions', 'courses',
    'invitations', 'invitation_courses', 'submissions', 'submission_courses', 'submission_course_slots',
    'submission_assessments', 'answers', 'consultation_records', 'consultation_slots', 'deletion_log',
    'submission_rate_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 관리자: 본인 관리자 여부만 확인 가능 (쓰기 정책 없음 → 클라이언트에서 권한 부여 불가)
grant select on public.admin_memberships to authenticated;
create policy admin_memberships_self_read on public.admin_memberships
  for select to authenticated using (user_id = (select auth.uid()));

-- 관리자 전용 테이블 (읽기·쓰기)
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings', 'subjects', 'form_templates', 'form_versions', 'courses', 'invitations',
    'invitation_courses', 'submissions', 'submission_courses', 'submission_course_slots',
    'submission_assessments', 'answers', 'consultation_records', 'consultation_slots'
  ] loop
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
      t || '_admin_all', t
    );
  end loop;
end $$;

grant select, insert on public.deletion_log to authenticated;
create policy deletion_log_admin_read on public.deletion_log
  for select to authenticated using ((select public.is_admin()));
create policy deletion_log_admin_insert on public.deletion_log
  for insert to authenticated with check ((select public.is_admin()));
-- submission_rate_events: 정책 없음 (공개 제출 함수만 사용)

-- 원본 응답은 수정할 수 없다 (삭제만 가능). 관리자도 학부모 답변을 고치지 않는다.
create or replace function public.prevent_original_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'original_is_read_only' using errcode = 'P0001',
    hint = '학부모 원본 응답은 수정할 수 없습니다.';
end;
$$;

create trigger submissions_read_only before update on public.submissions
  for each row execute function public.prevent_original_update();
create trigger submission_courses_read_only before update on public.submission_courses
  for each row execute function public.prevent_original_update();
create trigger answers_read_only before update on public.answers
  for each row execute function public.prevent_original_update();
create trigger submission_assessments_read_only before update on public.submission_assessments
  for each row execute function public.prevent_original_update();
create trigger submission_course_slots_read_only before update on public.submission_course_slots
  for each row execute function public.prevent_original_update();

-- 발행된 양식 버전의 질문은 바꿀 수 없다.
create or replace function public.protect_published_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and (new.questions is distinct from old.questions or new.template_id <> old.template_id) then
    raise exception 'published_version_is_immutable' using errcode = 'P0001';
  end if;
  if old.status = 'superseded' and new.status <> 'superseded' then
    raise exception 'superseded_version_is_final' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger form_versions_protect before update on public.form_versions
  for each row execute function public.protect_published_version();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger subjects_touch before update on public.subjects for each row execute function public.touch_updated_at();
create trigger form_templates_touch before update on public.form_templates for each row execute function public.touch_updated_at();
create trigger courses_touch before update on public.courses for each row execute function public.touch_updated_at();
create trigger invitations_touch before update on public.invitations for each row execute function public.touch_updated_at();
create trigger app_settings_touch before update on public.app_settings for each row execute function public.touch_updated_at();
create trigger consultation_records_touch before update on public.consultation_records for each row execute function public.touch_updated_at();


-- ============================================================
-- 20261005000200_validation.sql
-- ============================================================
-- 설문 질문 정의와 답변 검증 (클라이언트 src/lib/questions.ts 와 같은 규칙)

create or replace function public.question_types()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['short_text', 'long_text', 'single', 'multi', 'number', 'date', 'time'] $$;

create or replace function public.question_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['goal', 'textbook', 'progress', 'difficulty', 'score', 'confidence', 'note', 'other'] $$;

-- 질문 배열 검증. 문제가 없으면 null, 있으면 오류 코드 문자열을 돌려준다.
create or replace function public.questions_error(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  q jsonb;
  o jsonb;
  seen jsonb := '{}'::jsonb;
  qid text;
  t text;
  k text;
  opt_values text[];
  ref jsonb;
  x text;
  i integer := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    return 'questions_not_array';
  end if;
  if jsonb_array_length(p) > 80 then
    return 'too_many_questions';
  end if;

  for q in select value from jsonb_array_elements(p) loop
    i := i + 1;
    if jsonb_typeof(q) <> 'object' then
      return format('q%s:not_object', i);
    end if;
    for k in select jsonb_object_keys(q) loop
      if k not in ('id', 'type', 'label', 'help', 'required', 'active', 'allow_unknown', 'unknown_label', 'options',
                   'max_length', 'min', 'max', 'course_ids', 'grades', 'show_if', 'role', 'followup', 'locked') then
        return format('q%s:unknown_key:%s', i, k);
      end if;
    end loop;

    qid := q ->> 'id';
    if jsonb_typeof(q -> 'id') is distinct from 'string' or qid !~ '^[a-z][a-z0-9_]{1,40}$' then
      return format('q%s:bad_id', i);
    end if;
    if seen ? qid then
      return format('%s:duplicate_id', qid);
    end if;

    t := q ->> 'type';
    if jsonb_typeof(q -> 'type') is distinct from 'string' or not (t = any (public.question_types())) then
      return format('%s:bad_type', qid);
    end if;
    if jsonb_typeof(q -> 'label') is distinct from 'string' or char_length(btrim(q ->> 'label')) not between 1 and 200 then
      return format('%s:bad_label', qid);
    end if;
    if q ? 'help' and (jsonb_typeof(q -> 'help') <> 'string' or char_length(q ->> 'help') > 300) then
      return format('%s:bad_help', qid);
    end if;
    if jsonb_typeof(q -> 'required') is distinct from 'boolean' then
      return format('%s:bad_required', qid);
    end if;
    if jsonb_typeof(q -> 'active') is distinct from 'boolean' then
      return format('%s:bad_active', qid);
    end if;
    if q ? 'allow_unknown' and jsonb_typeof(q -> 'allow_unknown') <> 'boolean' then
      return format('%s:bad_allow_unknown', qid);
    end if;
    if q ? 'unknown_label' and (jsonb_typeof(q -> 'unknown_label') <> 'string' or char_length(q ->> 'unknown_label') not between 1 and 30) then
      return format('%s:bad_unknown_label', qid);
    end if;
    if q ? 'locked' and jsonb_typeof(q -> 'locked') <> 'boolean' then
      return format('%s:bad_locked', qid);
    end if;
    if q ? 'role' and (jsonb_typeof(q -> 'role') <> 'string' or not ((q ->> 'role') = any (public.question_roles()))) then
      return format('%s:bad_role', qid);
    end if;
    if q ? 'followup' and (jsonb_typeof(q -> 'followup') <> 'string' or char_length(q ->> 'followup') > 160) then
      return format('%s:bad_followup', qid);
    end if;

    -- 선택지
    opt_values := '{}';
    if t in ('single', 'multi') then
      if jsonb_typeof(q -> 'options') is distinct from 'array' or jsonb_array_length(q -> 'options') not between 1 and 30 then
        return format('%s:bad_options', qid);
      end if;
      for o in select value from jsonb_array_elements(q -> 'options') loop
        if jsonb_typeof(o) <> 'object'
          or jsonb_typeof(o -> 'value') is distinct from 'string'
          or (o ->> 'value') !~ '^[a-z0-9_]{1,40}$'
          or jsonb_typeof(o -> 'label') is distinct from 'string'
          or char_length(btrim(o ->> 'label')) not between 1 and 100
          or (o ? 'exclusive' and jsonb_typeof(o -> 'exclusive') <> 'boolean')
          or exists (select 1 from jsonb_object_keys(o) ok where ok not in ('value', 'label', 'exclusive')) then
          return format('%s:bad_option', qid);
        end if;
        if (o ->> 'value') = any (opt_values) then
          return format('%s:duplicate_option', qid);
        end if;
        opt_values := opt_values || (o ->> 'value');
      end loop;
    elsif q ? 'options' and not (jsonb_typeof(q -> 'options') = 'array' and jsonb_array_length(q -> 'options') = 0) then
      return format('%s:options_not_allowed', qid);
    end if;

    if q ? 'max_length' then
      if t not in ('short_text', 'long_text') or jsonb_typeof(q -> 'max_length') <> 'number'
        or (q ->> 'max_length')::numeric <> trunc((q ->> 'max_length')::numeric)
        or (q ->> 'max_length')::numeric not between 1 and (case t when 'short_text' then 200 else 2000 end) then
        return format('%s:bad_max_length', qid);
      end if;
    end if;
    if (q ? 'min' or q ? 'max') then
      if t <> 'number' then
        return format('%s:min_max_not_allowed', qid);
      end if;
      if (q ? 'min' and jsonb_typeof(q -> 'min') <> 'number') or (q ? 'max' and jsonb_typeof(q -> 'max') <> 'number') then
        return format('%s:bad_min_max', qid);
      end if;
      if q ? 'min' and q ? 'max' and (q ->> 'min')::numeric > (q ->> 'max')::numeric then
        return format('%s:bad_min_max', qid);
      end if;
    end if;

    if q ? 'course_ids' then
      if jsonb_typeof(q -> 'course_ids') <> 'array' then
        return format('%s:bad_course_ids', qid);
      end if;
      for x in select value from jsonb_array_elements_text(q -> 'course_ids') loop
        if x !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          return format('%s:bad_course_ids', qid);
        end if;
      end loop;
    end if;

    -- 적용 학년: 비어 있으면 모든 학년. 'middle-2' 처럼 학교급-학년 키
    if q ? 'grades' then
      if jsonb_typeof(q -> 'grades') <> 'array' then
        return format('%s:bad_grades', qid);
      end if;
      for x in select value from jsonb_array_elements_text(q -> 'grades') loop
        if x !~ '^(elementary-[1-6]|middle-[1-3]|high-[1-3])$' then
          return format('%s:bad_grades', qid);
        end if;
      end loop;
    end if;

    -- 표시 조건: 앞에 나온 선택형 질문의 선택지 중 하나 이상
    if q ? 'show_if' and jsonb_typeof(q -> 'show_if') <> 'null' then
      if jsonb_typeof(q -> 'show_if') <> 'object'
        or jsonb_typeof(q -> 'show_if' -> 'question') is distinct from 'string'
        or jsonb_typeof(q -> 'show_if' -> 'any_of') is distinct from 'array'
        or jsonb_array_length(q -> 'show_if' -> 'any_of') = 0
        or exists (select 1 from jsonb_object_keys(q -> 'show_if') sk where sk not in ('question', 'any_of')) then
        return format('%s:bad_show_if', qid);
      end if;
      ref := seen -> (q -> 'show_if' ->> 'question');
      if ref is null or (ref ->> 'type') not in ('single', 'multi') then
        return format('%s:show_if_ref', qid);
      end if;
      for x in select value from jsonb_array_elements_text(q -> 'show_if' -> 'any_of') loop
        if not exists (select 1 from jsonb_array_elements(ref -> 'options') ro where ro.value ->> 'value' = x) then
          return format('%s:show_if_option', qid);
        end if;
      end loop;
    end if;

    seen := seen || jsonb_build_object(qid, q);
  end loop;
  return null;
end;
$$;

alter table public.form_versions
  add constraint form_versions_questions_valid check (public.questions_error(questions) is null);

-- 특정 수업에 적용되는 활성 질문만 (순서 유지)
create or replace function public.applicable_questions(p_questions jsonb, p_course_id uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(e.value order by e.ordinality), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) with ordinality e
  where coalesce((e.value ->> 'active')::boolean, false)
    and (
      p_course_id is null
      or not (e.value ? 'course_ids')
      or jsonb_array_length(e.value -> 'course_ids') = 0
      or (e.value -> 'course_ids') ? p_course_id::text
    );
$$;

-- 학부모 화면에 내보낼 때는 내부 설정(확인 메시지 문구, 역할, 적용 수업)을 뺀다.
create or replace function public.public_questions(p_questions jsonb, p_course_id uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg((e.value - 'course_ids' - 'followup' - 'role' - 'locked') order by e.ordinality), '[]'::jsonb)
  from jsonb_array_elements(public.applicable_questions(p_questions, p_course_id)) with ordinality e;
$$;

create or replace function public.is_valid_date_text(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  return to_char(p::date, 'YYYY-MM-DD') = p;
exception when others then
  return false;
end;
$$;

-- 답변 검증. p_questions 는 applicable_questions 결과(이미 수업 기준으로 걸러진 목록)여야 한다.
-- p_grade_key 는 학생의 학교급-학년('middle-2', 기타는 'other'). 적용 학년이 맞지 않는 질문은 숨겨진 질문으로 본다.
-- 반환: [{path, code}] 배열. 비어 있으면 통과.
create or replace function public.answers_errors(p_questions jsonb, p_answers jsonb, p_prefix text, p_grade_key text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  q jsonb;
  a jsonb;
  v jsonb;
  dep jsonb;
  errs jsonb := '[]'::jsonb;
  visible jsonb := '{}'::jsonb;
  qid text;
  t text;
  k text;
  vis boolean;
  maxlen integer;
  n_exclusive integer;
  n_values integer;
begin
  if p_answers is null or jsonb_typeof(p_answers) = 'null' then
    p_answers := '{}'::jsonb;
  end if;
  if jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_array(jsonb_build_object('path', p_prefix, 'code', 'invalid'));
  end if;

  for k in select jsonb_object_keys(p_answers) loop
    if not exists (select 1 from jsonb_array_elements(p_questions) e where e.value ->> 'id' = k) then
      errs := errs || jsonb_build_object('path', p_prefix || '.' || k, 'code', 'unknown_question');
    end if;
  end loop;

  for q in select value from jsonb_array_elements(p_questions) loop
    qid := q ->> 'id';
    t := q ->> 'type';
    vis := not (q ? 'grades' and jsonb_array_length(q -> 'grades') > 0
                and not ((q -> 'grades') ? coalesce(p_grade_key, '')));

    if vis and q ? 'show_if' and jsonb_typeof(q -> 'show_if') = 'object' then
      vis := coalesce((visible ->> (q -> 'show_if' ->> 'question'))::boolean, false);
      if vis then
        dep := p_answers -> (q -> 'show_if' ->> 'question');
        vis := dep is not null
          and jsonb_typeof(dep) = 'object'
          and dep ->> 'status' = 'answered'
          and case jsonb_typeof(dep -> 'value')
                when 'string' then (q -> 'show_if' -> 'any_of') ? (dep ->> 'value')
                when 'array' then exists (
                  select 1 from jsonb_array_elements(dep -> 'value') x
                  where jsonb_typeof(x.value) = 'string' and (q -> 'show_if' -> 'any_of') ? (x.value #>> '{}')
                )
                else false
              end;
      end if;
    end if;
    visible := visible || jsonb_build_object(qid, vis);

    a := p_answers -> qid;
    if not vis then
      if a is not null then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'hidden_answer');
      end if;
      continue;
    end if;

    if a is null or jsonb_typeof(a) = 'null' then
      if (q ->> 'required')::boolean then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'required');
      end if;
      continue;
    end if;

    if jsonb_typeof(a) <> 'object' or exists (select 1 from jsonb_object_keys(a) ak where ak not in ('status', 'value')) then
      errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      continue;
    end if;

    if a ->> 'status' = 'unknown' then
      if not coalesce((q ->> 'allow_unknown')::boolean, false) then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'unknown_not_allowed');
      elsif a ? 'value' and jsonb_typeof(a -> 'value') <> 'null' then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      end if;
      continue;
    end if;

    if a ->> 'status' is distinct from 'answered' then
      errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      continue;
    end if;

    v := a -> 'value';
    if t in ('short_text', 'long_text') then
      maxlen := coalesce((q ->> 'max_length')::integer, case t when 'short_text' then 100 else 1000 end);
      if jsonb_typeof(v) is distinct from 'string' then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      elsif btrim(v #>> '{}') = '' then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'required');
      elsif char_length(v #>> '{}') > maxlen then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'too_long');
      end if;
    elsif t = 'single' then
      if jsonb_typeof(v) is distinct from 'string'
        or not exists (select 1 from jsonb_array_elements(q -> 'options') o where o.value ->> 'value' = v #>> '{}') then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid_option');
      end if;
    elsif t = 'multi' then
      if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) = 0 then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'required');
      elsif exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x.value) <> 'string')
        or exists (
          select 1 from jsonb_array_elements_text(v) x
          where not exists (select 1 from jsonb_array_elements(q -> 'options') o where o.value ->> 'value' = x.value)
        )
        or (select count(distinct x.value) from jsonb_array_elements_text(v) x) <> jsonb_array_length(v) then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid_option');
      else
        select count(*) into n_exclusive
        from jsonb_array_elements_text(v) x
        join jsonb_array_elements(q -> 'options') o on o.value ->> 'value' = x.value
        where coalesce((o.value ->> 'exclusive')::boolean, false);
        n_values := jsonb_array_length(v);
        if n_exclusive > 0 and n_values > 1 then
          errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'exclusive_option');
        end if;
      end if;
    elsif t = 'number' then
      if jsonb_typeof(v) is distinct from 'number' then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      elsif (q ? 'min' and (v #>> '{}')::numeric < (q ->> 'min')::numeric)
        or (q ? 'max' and (v #>> '{}')::numeric > (q ->> 'max')::numeric) then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'out_of_range');
      end if;
    elsif t = 'date' then
      if jsonb_typeof(v) is distinct from 'string' or not public.is_valid_date_text(v #>> '{}') then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      end if;
    elsif t = 'time' then
      if jsonb_typeof(v) is distinct from 'string' or (v #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      end if;
    end if;
  end loop;

  return errs;
end;
$$;

-- 관리자가 새 과목을 만들 때 쓰는 기본 학습 질문 (선택지만 과목에 맞게 바꾼다)
-- p_extra(과목별 질문)는 ‘어려워하는 부분’ 뒤, ‘수업 목표’ 앞에 들어간다.
create or replace function public.standard_subject_questions(p_difficulty_options jsonb, p_extra jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'id', 'textbook_publisher', 'type', 'single', 'required', true, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '모름', 'role', 'textbook',
      'label', '학교 교과서 출판사',
      'help', '교과서 표지 아래쪽에 적혀 있습니다.',
      'followup', '학교 교과서 출판사(교과서 표지 아래쪽에 적혀 있습니다)',
      'options', jsonb_build_array(
        jsonb_build_object('value', 'mirae', 'label', '미래엔'),
        jsonb_build_object('value', 'visang', 'label', '비상교육'),
        jsonb_build_object('value', 'chunjae', 'label', '천재교육·천재교과서'),
        jsonb_build_object('value', 'donga', 'label', '동아출판'),
        jsonb_build_object('value', 'jihak', 'label', '지학사'),
        jsonb_build_object('value', 'ybm', 'label', 'YBM'),
        jsonb_build_object('value', 'other', 'label', '다른 출판사')
      )
    ),
    jsonb_build_object(
      'id', 'textbook_publisher_other', 'type', 'short_text', 'required', true, 'active', true, 'locked', true,
      'max_length', 40, 'role', 'textbook',
      'label', '출판사 이름',
      'show_if', jsonb_build_object('question', 'textbook_publisher', 'any_of', jsonb_build_array('other'))
    ),
    jsonb_build_object(
      'id', 'textbook_author', 'type', 'short_text', 'required', false, 'active', true, 'locked', true,
      'max_length', 40, 'role', 'textbook',
      'label', '교과서 대표 저자',
      'help', '표지에 적힌 첫 번째 저자입니다. 같은 출판사 교과서가 여러 종류일 때 구분하는 데 씁니다.',
      'followup', '교과서 대표 저자(표지에 적힌 첫 번째 이름)'
    ),
    jsonb_build_object(
      'id', 'current_unit', 'type', 'short_text', 'required', true, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '모름', 'max_length', 100, 'role', 'progress',
      'label', '지금 학교에서 배우는 단원이나 범위',
      'help', '예: 2단원 일차방정식. 교재 목차와 학교의 실제 진도는 다를 수 있어요.',
      'followup', '지금 학교에서 배우는 단원이나 범위'
    ),
    jsonb_build_object(
      'id', 'workbook', 'type', 'short_text', 'required', false, 'active', true, 'locked', true,
      'max_length', 100, 'role', 'textbook',
      'label', '지금 풀고 있는 문제집',
      'help', '여러 권이면 쉼표로 나눠 적어주세요. 없으면 비워두셔도 됩니다.'
    ),
    jsonb_build_object(
      'id', 'recent_score', 'type', 'single', 'required', false, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '잘 모르겠음', 'role', 'score',
      'label', '최근 시험 점수는 어느 정도인가요?',
      'help', '점수와 함께 학교에서 배운 범위와 풀이 과정도 살펴봅니다.',
      'options', jsonb_build_array(
        jsonb_build_object('value', 's90', 'label', '90점 이상'),
        jsonb_build_object('value', 's80', 'label', '80~89점'),
        jsonb_build_object('value', 's60', 'label', '60~79점'),
        jsonb_build_object('value', 'below60', 'label', '60점 미만'),
        jsonb_build_object('value', 'no_score', 'label', '점수로 평가하지 않음')
      )
    ),
    jsonb_build_object(
      'id', 'interest', 'type', 'single', 'required', false, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '잘 모르겠음', 'role', 'confidence',
      'label', '학생은 이 과목을 어떻게 느끼나요?',
      'options', jsonb_build_array(
        jsonb_build_object('value', 'likes', 'label', '좋아하고 흥미가 있어요'),
        jsonb_build_object('value', 'neutral', 'label', '보통이에요'),
        jsonb_build_object('value', 'hard', 'label', '어렵거나 부담스러워해요')
      )
    ),
    jsonb_build_object(
      'id', 'difficulties', 'type', 'multi', 'required', true, 'active', true, 'locked', true,
      'role', 'difficulty',
      'label', '어려워하는 부분',
      'help', '해당하는 것을 모두 골라주세요. 아직 배우지 않은 내용은 고르지 않으셔도 됩니다.',
      'options', p_difficulty_options
    ),
    jsonb_build_object(
      'id', 'difficulties_other', 'type', 'short_text', 'required', true, 'active', true, 'locked', true,
      'max_length', 100, 'role', 'difficulty',
      'label', '‘기타’에 해당하는 내용',
      'show_if', jsonb_build_object('question', 'difficulties', 'any_of', jsonb_build_array('other'))
    )
  )
  || coalesce(p_extra, '[]'::jsonb)
  || jsonb_build_array(
    jsonb_build_object(
      'id', 'goal', 'type', 'single', 'required', true, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '상담하면서 정하고 싶어요', 'role', 'goal',
      'label', '수업에서 가장 중요하게 생각하는 목표',
      'options', jsonb_build_array(
        jsonb_build_object('value', 'follow_school', 'label', '학교 수업을 잘 따라가기'),
        jsonb_build_object('value', 'school_exam', 'label', '학교 시험 준비'),
        jsonb_build_object('value', 'basics', 'label', '기초 개념 다시 잡기'),
        jsonb_build_object('value', 'next_term', 'label', '다음 학기·학년 내용 미리 공부하기'),
        jsonb_build_object('value', 'habit', 'label', '혼자 공부하는 습관 만들기'),
        jsonb_build_object('value', 'other', 'label', '기타')
      ),
      'followup', '수업에서 가장 중요하게 생각하시는 목표'
    ),
    jsonb_build_object(
      'id', 'goal_detail', 'type', 'long_text', 'required', false, 'active', true, 'locked', true,
      'max_length', 500, 'role', 'goal',
      'label', '목표에 대해 더 알려주실 내용',
      'help', '예: 이번 기말고사까지 함수 단원을 정리하고 싶어요.'
    ),
    jsonb_build_object(
      'id', 'teacher_notes', 'type', 'long_text', 'required', false, 'active', true, 'locked', true,
      'max_length', 1000, 'role', 'note',
      'label', '선생님이 알아두면 좋은 점',
      'help', '예: 시험 때 긴장하면 실수가 늘어요. 설명을 들으면 이해는 빠른 편이에요.'
    )
  );
$$;

-- 학년별 선수 개념 질문 (해당 학년 학생에게만 보인다)
create or replace function public.grade_single(p_id text, p_grade text, p_label text, p_options jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_id, 'type', 'single', 'required', false, 'active', true, 'role', 'difficulty',
    'allow_unknown', true, 'unknown_label', '잘 모르겠음',
    'grades', jsonb_build_array(p_grade), 'label', p_label, 'options', p_options
  );
$$;

-- 학년별 단원 목록 (선택 질문. 학교 진도표나 시험 범위로 쓰지 않는다)
create or replace function public.grade_topics(p_id text, p_grade text, p_labels text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_id, 'type', 'multi', 'required', false, 'active', true, 'role', 'difficulty',
    'grades', jsonb_build_array(p_grade),
    'label', '특히 어려웠던 단원을 골라주세요',
    'help', '학교 진도나 시험 범위를 정하는 질문이 아닙니다. 해당하는 것만 골라주세요.',
    'options',
      (select jsonb_agg(jsonb_build_object('value', 't' || u.i, 'label', u.l) order by u.i)
         from unnest(p_labels) with ordinality as u(l, i))
      || jsonb_build_array(
        jsonb_build_object('value', 'prior', 'label', '이전 학년 내용'),
        jsonb_build_object('value', 'not_sure', 'label', '잘 모르겠음', 'exclusive', true)
      )
  );
$$;

create or replace function public.generic_difficulty_options()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('value', 'concept', 'label', '용어·개념 이해'),
    jsonb_build_object('value', 'memorize', 'label', '배운 내용 기억하기'),
    jsonb_build_object('value', 'apply', 'label', '배운 내용을 문제에 적용하기'),
    jsonb_build_object('value', 'written', 'label', '서술형'),
    jsonb_build_object('value', 'prior_grade', 'label', '이전 학년 내용'),
    jsonb_build_object('value', 'other', 'label', '기타'),
    jsonb_build_object('value', 'not_sure', 'label', '잘 모르겠음', 'exclusive', true)
  );
$$;


-- ============================================================
-- 20261005000300_public_api.sql
-- ============================================================
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


-- ============================================================
-- 20261005000400_admin_api.sql
-- ============================================================
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


-- ============================================================
-- 20261005000500_initial_templates.sql
-- ============================================================
-- 초기 운영 데이터: 설정 행, 공통 양식, 세 과목과 과목별 양식(v1 발행)
-- 개인정보나 가상의 경력·후기는 넣지 않는다. 운영자 정보와 선생님 소개는 비워 두고 관리자 화면에서 채운다.
-- 학년별 단원 목록은 학부모가 고르기 쉽게 돕는 선택 질문일 뿐, 학교 진도표나 시험 범위로 쓰지 않는다.
-- 교육과정·교과서가 바뀌면 관리자 화면(과목·설문 관리)에서 문구와 선택지를 고친다.

insert into public.app_settings (
  id, service_name, parent_title, intro_eyebrow, intro_title, intro_body, intro_note, completion_message, privacy_purpose
) values (
  1,
  '수업 준비실',
  '수업 전 학습 상담',
  '학생에게 맞는 수업을 준비하는 첫 단계',
  '학생의 학습 상황에 맞춰 수업을 준비합니다.',
  '학교 진도와 공부할 때 어려운 부분, 수업에서 바라는 점을 알려주세요. 첫 수업에서 이해도를 확인한 뒤 교재와 학습 계획을 조정하겠습니다.',
  '아시는 범위에서 답해주세요. 아직 확인하지 못한 내용은 상담하면서 함께 정리합니다.',
  '상담 내용이 접수되었습니다. 보내주신 내용을 확인한 뒤 수업 일정과 준비 사항을 안내드리겠습니다. 아직 확인하지 못한 내용은 상담하면서 함께 정리하겠습니다.',
  '수업 일정 조율, 첫 수업 준비(교재·진도·숙제 분량 결정), 추가 상담 연락'
)
on conflict (id) do nothing;

do $$
declare
  math_id uuid;
  sci_id uuid;
  isci_id uuid;
  t_common uuid;
  t_math uuid;
  t_sci uuid;
  t_isci uuid;
  basics jsonb := jsonb_build_object('value', 'basics', 'label', '기초부터 확인하면 좋겠어요');
begin
  -- 공통 추가 질문 (모든 제출에서 한 번만 묻는다)
  insert into public.form_templates (kind, name, description)
  values ('common', '공통 질문', '기본 정보 단계에서 모든 학생에게 한 번 묻는 질문입니다.')
  returning id into t_common;

  insert into public.form_versions (template_id, status, version_no, published_at, questions)
  values (t_common, 'published', 1, now(), jsonb_build_array(
    jsonb_build_object(
      'id', 'prior_lessons', 'type', 'single', 'required', false, 'active', true,
      'allow_unknown', false, 'role', 'other',
      'label', '지금까지 학원이나 과외를 해본 적이 있나요?',
      'options', jsonb_build_array(
        jsonb_build_object('value', 'none', 'label', '처음이에요'),
        jsonb_build_object('value', 'academy', 'label', '학원을 다녔어요'),
        jsonb_build_object('value', 'tutoring', 'label', '과외를 받았어요'),
        jsonb_build_object('value', 'both', 'label', '학원과 과외 모두 해봤어요')
      )
    ),
    jsonb_build_object(
      'id', 'study_habits', 'type', 'long_text', 'required', false, 'active', true,
      'max_length', 500, 'role', 'note',
      'label', '평소 공부 습관에서 알려주실 점',
      'help', '예: 숙제는 꼬박꼬박 하지만 혼자서는 복습을 잘 안 해요.'
    )
  ));

  -- 중등수학 (중1~3)
  insert into public.subjects (name, description, perspective, sort_order)
  values (
    '수학',
    '중학교 수학 수업입니다. 학교 진도에 맞춰 개념을 정리하고 문제 풀이로 이어갑니다.',
    '계산 결과와 함께 풀이 과정을 살펴봅니다. 이전에 배운 개념을 확인하고 문제에 적용하는 연습으로 연결합니다.',
    10)
  returning id into math_id;

  insert into public.form_templates (kind, subject_id, name, description)
  values ('subject', math_id, '중학교 수학 기본 양식', '중학교 수학 수업에 쓰는 기본 질문입니다. 학년별 질문은 해당 학년 학생에게만 보입니다.')
  returning id into t_math;

  insert into public.form_versions (template_id, status, version_no, published_at, questions)
  values (t_math, 'published', 1, now(), public.standard_subject_questions(
    jsonb_build_array(
      jsonb_build_object('value', 'calc', 'label', '계산·연산'),
      jsonb_build_object('value', 'concept', 'label', '개념 이해'),
      jsonb_build_object('value', 'algebra', 'label', '문자와 식'),
      jsonb_build_object('value', 'equation_function', 'label', '방정식·함수'),
      jsonb_build_object('value', 'geometry', 'label', '도형'),
      jsonb_build_object('value', 'prob_stats', 'label', '확률·통계'),
      jsonb_build_object('value', 'word_problem', 'label', '문장제·조건 해석'),
      jsonb_build_object('value', 'written', 'label', '서술형·풀이 과정 쓰기'),
      jsonb_build_object('value', 'prior_grade', 'label', '이전 학년 내용'),
      jsonb_build_object('value', 'other', 'label', '기타'),
      jsonb_build_object('value', 'not_sure', 'label', '잘 모르겠음', 'exclusive', true)
    ),
    jsonb_build_array(
      public.grade_single('readiness_m1', 'middle-1', '초등학교 분수·소수 계산은 어느 정도 하나요?', jsonb_build_array(
        jsonb_build_object('value', 'alone', 'label', '혼자 풀 수 있어요'),
        jsonb_build_object('value', 'sometimes', 'label', '가끔 도움이 필요해요'), basics)),
      public.grade_single('readiness_m2', 'middle-2', '중1 일차방정식은 어느 정도 푸나요?', jsonb_build_array(
        jsonb_build_object('value', 'alone', 'label', '혼자 풀 수 있어요'),
        jsonb_build_object('value', 'with_solution', 'label', '풀이를 보면 이해해요'), basics)),
      public.grade_single('readiness_m3', 'middle-3', '중2 식의 계산과 일차함수는 어느 정도 하나요?', jsonb_build_array(
        jsonb_build_object('value', 'alone', 'label', '혼자 풀 수 있어요'),
        jsonb_build_object('value', 'varies', 'label', '단원마다 차이가 있어요'), basics)),
      public.grade_topics('topics_m1', 'middle-1', array['수와 연산', '문자와 식·일차방정식', '좌표평면과 그래프', '기본 도형·도형의 성질', '자료의 정리와 해석']),
      public.grade_topics('topics_m2', 'middle-2', array['유리수와 순환소수', '식의 계산', '일차부등식·연립방정식', '일차함수', '도형의 성질·닮음', '확률']),
      public.grade_topics('topics_m3', 'middle-3', array['제곱근과 실수', '인수분해·이차방정식', '이차함수', '삼각비', '원의 성질', '통계']),
      jsonb_build_object(
        'id', 'study_direction', 'type', 'single', 'required', false, 'active', true, 'role', 'goal',
        'allow_unknown', true, 'unknown_label', '상담하면서 정하고 싶어요',
        'label', '복습과 선행 중 바라는 방향',
        'options', jsonb_build_array(
          jsonb_build_object('value', 'review', 'label', '지난 내용 복습 위주'),
          jsonb_build_object('value', 'school_pace', 'label', '학교 진도에 맞춰서'),
          jsonb_build_object('value', 'preview', 'label', '다음 내용 선행 위주')
        )
      ),
      jsonb_build_object(
        'id', 'calc_vs_concept', 'type', 'single', 'required', false, 'active', true, 'role', 'difficulty',
        'allow_unknown', true, 'unknown_label', '잘 모르겠음',
        'label', '계산 실수와 개념 이해 중 더 어려워하는 쪽',
        'options', jsonb_build_array(
          jsonb_build_object('value', 'calc_mistakes', 'label', '계산 실수가 더 많아요'),
          jsonb_build_object('value', 'concept', 'label', '개념 이해를 더 어려워해요'),
          jsonb_build_object('value', 'both', 'label', '둘 다 비슷해요')
        )
      )
    )
  ));

  -- 중등과학 (중1~3)
  insert into public.subjects (name, description, perspective, sort_order)
  values (
    '과학',
    '중학교 과학 수업입니다. 교과서 개념을 정리한 뒤 실험 결과와 자료를 해석하는 문제까지 다룹니다.',
    '과학 개념으로 현상과 실험 결과를 설명할 수 있는지 확인합니다. 배운 내용을 자료 해석과 서술형 문제에 적용하도록 지도합니다.',
    20)
  returning id into sci_id;

  insert into public.form_templates (kind, subject_id, name, description)
  values ('subject', sci_id, '중학교 과학 기본 양식', '중학교 과학 수업에 쓰는 기본 질문입니다. 학년별 질문은 해당 학년 학생에게만 보입니다.')
  returning id into t_sci;

  insert into public.form_versions (template_id, status, version_no, published_at, questions)
  values (t_sci, 'published', 1, now(), public.standard_subject_questions(
    jsonb_build_array(
      jsonb_build_object('value', 'terms', 'label', '용어·개념 이해'),
      jsonb_build_object('value', 'memorize', 'label', '개념 기억하기'),
      jsonb_build_object('value', 'calc', 'label', '공식·계산'),
      jsonb_build_object('value', 'graph', 'label', '그래프·표 읽기'),
      jsonb_build_object('value', 'experiment', 'label', '실험 결과 해석'),
      jsonb_build_object('value', 'written', 'label', '서술형'),
      jsonb_build_object('value', 'prior_grade', 'label', '이전 학년 내용'),
      jsonb_build_object('value', 'other', 'label', '기타'),
      jsonb_build_object('value', 'not_sure', 'label', '잘 모르겠음', 'exclusive', true)
    ),
    jsonb_build_array(
      public.grade_single('readiness_s1', 'middle-1', '초등학교 과학의 관찰·실험 내용은 얼마나 익숙한가요?', jsonb_build_array(
        jsonb_build_object('value', 'familiar', 'label', '대체로 익숙해요'),
        jsonb_build_object('value', 'partly', 'label', '부분적으로 도움이 필요해요'), basics)),
      public.grade_single('readiness_s2', 'middle-2', '비례 관계와 그래프를 읽는 데 익숙한가요?', jsonb_build_array(
        jsonb_build_object('value', 'familiar', 'label', '대체로 익숙해요'),
        jsonb_build_object('value', 'partly', 'label', '부분적으로 도움이 필요해요'), basics)),
      public.grade_single('readiness_s3', 'middle-3', '이전 학년 과학 개념을 연결해서 설명할 수 있나요?', jsonb_build_array(
        jsonb_build_object('value', 'familiar', 'label', '대체로 할 수 있어요'),
        jsonb_build_object('value', 'partly', 'label', '부분적으로 도움이 필요해요'), basics)),
      public.grade_topics('topics_s1', 'middle-1', array['생물의 구성과 다양성', '열과 물질의 상태 변화', '힘의 작용', '기체의 성질', '태양계']),
      public.grade_topics('topics_s2', 'middle-2', array['물질의 특성과 구성', '지권의 변화', '빛과 파동', '식물·동물과 에너지', '전기와 자기', '별과 우주']),
      public.grade_topics('topics_s3', 'middle-3', array['화학 반응', '날씨와 기후', '물과 바다', '운동과 에너지', '자극과 반응', '생식과 유전', '지구와 우주']),
      jsonb_build_object(
        'id', 'performance_help', 'type', 'long_text', 'required', false, 'active', true, 'role', 'goal',
        'max_length', 500,
        'label', '수행평가나 탐구 활동에서 도움이 필요한 부분',
        'help', '예정된 수행평가가 있으면 주제와 일정을 함께 적어주세요.'
      )
    )
  ));

  -- 고등학교 통합과학
  insert into public.subjects (name, description, perspective, sort_order)
  values (
    '통합과학',
    '고등학교 통합과학 수업입니다. 필요한 중학교 개념을 함께 확인하며 학교 진도를 따라갑니다.',
    '현재 배우는 내용에 필요한 중학교 개념을 함께 확인합니다. 여러 개념을 연결하고 그래프와 자료를 해석하는 과정을 지도합니다.',
    30)
  returning id into isci_id;

  insert into public.form_templates (kind, subject_id, name, description)
  values ('subject', isci_id, '고등학교 통합과학 기본 양식', '고등학교 통합과학 수업에 쓰는 기본 질문입니다.')
  returning id into t_isci;

  insert into public.form_versions (template_id, status, version_no, published_at, questions)
  values (t_isci, 'published', 1, now(), public.standard_subject_questions(
    jsonb_build_array(
      jsonb_build_object('value', 'terms', 'label', '용어·개념 이해'),
      jsonb_build_object('value', 'middle_prereq', 'label', '중학교 때 배운 기초 개념'),
      jsonb_build_object('value', 'calc_ratio', 'label', '계산·비례 관계'),
      jsonb_build_object('value', 'data', 'label', '그래프·자료 해석'),
      jsonb_build_object('value', 'connect', 'label', '여러 개념을 연결하기'),
      jsonb_build_object('value', 'field', 'label', '물리·화학·생명과학·지구과학 중 특정 영역'),
      jsonb_build_object('value', 'inquiry', 'label', '서술형·탐구'),
      jsonb_build_object('value', 'other', 'label', '기타'),
      jsonb_build_object('value', 'not_sure', 'label', '잘 모르겠음', 'exclusive', true)
    ),
    jsonb_build_array(
      jsonb_build_object(
        'id', 'hard_fields', 'type', 'multi', 'required', false, 'active', true, 'role', 'difficulty',
        'label', '어려워하는 영역',
        'show_if', jsonb_build_object('question', 'difficulties', 'any_of', jsonb_build_array('field')),
        'options', jsonb_build_array(
          jsonb_build_object('value', 'physics', 'label', '물리: 힘·에너지·전기'),
          jsonb_build_object('value', 'chemistry', 'label', '화학: 입자·원소·반응'),
          jsonb_build_object('value', 'life', 'label', '생명: 세포·유전·생태'),
          jsonb_build_object('value', 'earth', 'label', '지구: 지구 환경·우주')
        )
      ),
      jsonb_build_object(
        'id', 'integrated_course', 'type', 'single', 'required', false, 'active', true, 'role', 'progress',
        'allow_unknown', true, 'unknown_label', '잘 모르겠음',
        'label', '상담할 통합과학 과목은 무엇인가요?',
        'options', jsonb_build_array(
          jsonb_build_object('value', 'ic1', 'label', '통합과학 1'),
          jsonb_build_object('value', 'ic2', 'label', '통합과학 2'),
          jsonb_build_object('value', 'both', 'label', '통합과학 1·2 모두')
        )
      ),
      jsonb_build_object(
        'id', 'readiness_i', 'type', 'single', 'required', false, 'active', true, 'role', 'difficulty',
        'allow_unknown', true, 'unknown_label', '잘 모르겠음',
        'label', '중학교 과학 기초는 어느 정도 익숙한가요?',
        'options', jsonb_build_array(
          jsonb_build_object('value', 'remember', 'label', '대체로 기억하고 설명할 수 있어요'),
          jsonb_build_object('value', 'varies', 'label', '분야마다 차이가 있어요'), basics)
      ),
      jsonb_build_object(
        'id', 'prereq_concepts', 'type', 'long_text', 'required', false, 'active', true, 'role', 'difficulty',
        'max_length', 500,
        'label', '보완하고 싶은 중학교 개념',
        'help', '예: 중학교 때 화학 단원을 제대로 공부하지 못했어요.'
      )
    )
  ));

  update public.subjects set default_template_id = t_math where id = math_id;
  update public.subjects set default_template_id = t_sci where id = sci_id;
  update public.subjects set default_template_id = t_isci where id = isci_id;
end $$;


-- ============================================================
-- 20261006000100_exam_photos_multi_goal.sql
-- ============================================================
-- 2026-10-06: 시험지 사진 첨부(질문 유형 'photos')와 ‘수업 목표’ 복수 선택
--  * 사진은 Supabase Storage 의 비공개 버킷 exam-photos 에 저장한다.
--    - 익명(학부모)은 pending/<제출 키>/<무작위 이름> 경로에 올리기만 할 수 있다. 조회·수정·삭제 불가.
--    - 관리자만 보기(서명된 주소)·삭제할 수 있다.
--    - 제출 함수가 경로 형식, 제출 키 일치, 실제 파일 존재를 확인한다.
--  * 이미 발행된 과목 양식은 고치지 않고 새 버전을 발행한다. 이전 응답은 작성 당시 버전으로 보존된다.

create or replace function public.question_types()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['short_text', 'long_text', 'single', 'multi', 'number', 'date', 'time', 'photos'] $$;

create or replace function public.max_photos()
returns integer
language sql
immutable
set search_path = ''
as $$ select 5 $$;

-- ---------------------------------------------------------------------------
-- 저장소 버킷과 접근 정책
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exam-photos', 'exam-photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

drop policy if exists exam_photos_upload on storage.objects;
create policy exam_photos_upload on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'exam-photos' and name ~ '^pending/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$');

drop policy if exists exam_photos_admin_read on storage.objects;
create policy exam_photos_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'exam-photos' and (select public.is_admin()));

drop policy if exists exam_photos_admin_delete on storage.objects;
create policy exam_photos_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'exam-photos' and (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 답변 저장: 사진 경로는 value_choices 에 넣고, 제출 키와 실제 파일을 확인한다
-- ---------------------------------------------------------------------------
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
  key text;
  x text;
begin
  select idempotency_key::text into key from public.submissions where id = p_submission_id;
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
      if t = 'photos' then
        for x in select jsonb_array_elements_text(a -> 'value') loop
          if left(x, length('pending/' || key || '/')) <> 'pending/' || key || '/'
            or not exists (select 1 from storage.objects o where o.bucket_id = 'exam-photos' and o.name = x) then
            raise exception 'photo_missing' using errcode = 'P0001', detail = x;
          end if;
        end loop;
      end if;
      insert into public.answers (
        submission_id, submission_course_id, form_version_id, question_key, status,
        value_text, value_number, value_date, value_time, value_choices)
      values (
        p_submission_id, p_submission_course_id, p_version_id, q ->> 'id', 'answered',
        case when t in ('short_text', 'long_text', 'single') then btrim(a ->> 'value') end,
        case when t = 'number' then (a ->> 'value')::numeric end,
        case when t = 'date' then (a ->> 'value')::date end,
        case when t = 'time' then (a ->> 'value')::time end,
        case when t in ('multi', 'photos') then array(select jsonb_array_elements_text(a -> 'value')) end
      );
    end if;
  end loop;
  return unknowns;
end;
$$;

create or replace function public.answers_errors(p_questions jsonb, p_answers jsonb, p_prefix text, p_grade_key text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  q jsonb;
  a jsonb;
  v jsonb;
  dep jsonb;
  errs jsonb := '[]'::jsonb;
  visible jsonb := '{}'::jsonb;
  qid text;
  t text;
  k text;
  vis boolean;
  maxlen integer;
  n_exclusive integer;
  n_values integer;
begin
  if p_answers is null or jsonb_typeof(p_answers) = 'null' then
    p_answers := '{}'::jsonb;
  end if;
  if jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_array(jsonb_build_object('path', p_prefix, 'code', 'invalid'));
  end if;

  for k in select jsonb_object_keys(p_answers) loop
    if not exists (select 1 from jsonb_array_elements(p_questions) e where e.value ->> 'id' = k) then
      errs := errs || jsonb_build_object('path', p_prefix || '.' || k, 'code', 'unknown_question');
    end if;
  end loop;

  for q in select value from jsonb_array_elements(p_questions) loop
    qid := q ->> 'id';
    t := q ->> 'type';
    vis := not (q ? 'grades' and jsonb_array_length(q -> 'grades') > 0
                and not ((q -> 'grades') ? coalesce(p_grade_key, '')));

    if vis and q ? 'show_if' and jsonb_typeof(q -> 'show_if') = 'object' then
      vis := coalesce((visible ->> (q -> 'show_if' ->> 'question'))::boolean, false);
      if vis then
        dep := p_answers -> (q -> 'show_if' ->> 'question');
        vis := dep is not null
          and jsonb_typeof(dep) = 'object'
          and dep ->> 'status' = 'answered'
          and case jsonb_typeof(dep -> 'value')
                when 'string' then (q -> 'show_if' -> 'any_of') ? (dep ->> 'value')
                when 'array' then exists (
                  select 1 from jsonb_array_elements(dep -> 'value') x
                  where jsonb_typeof(x.value) = 'string' and (q -> 'show_if' -> 'any_of') ? (x.value #>> '{}')
                )
                else false
              end;
      end if;
    end if;
    visible := visible || jsonb_build_object(qid, vis);

    a := p_answers -> qid;
    if not vis then
      if a is not null then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'hidden_answer');
      end if;
      continue;
    end if;

    if a is null or jsonb_typeof(a) = 'null' then
      if (q ->> 'required')::boolean then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'required');
      end if;
      continue;
    end if;

    if jsonb_typeof(a) <> 'object' or exists (select 1 from jsonb_object_keys(a) ak where ak not in ('status', 'value')) then
      errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      continue;
    end if;

    if a ->> 'status' = 'unknown' then
      if not coalesce((q ->> 'allow_unknown')::boolean, false) then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'unknown_not_allowed');
      elsif a ? 'value' and jsonb_typeof(a -> 'value') <> 'null' then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      end if;
      continue;
    end if;

    if a ->> 'status' is distinct from 'answered' then
      errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      continue;
    end if;

    v := a -> 'value';
    if t in ('short_text', 'long_text') then
      maxlen := coalesce((q ->> 'max_length')::integer, case t when 'short_text' then 100 else 1000 end);
      if jsonb_typeof(v) is distinct from 'string' then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      elsif btrim(v #>> '{}') = '' then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'required');
      elsif char_length(v #>> '{}') > maxlen then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'too_long');
      end if;
    elsif t = 'single' then
      if jsonb_typeof(v) is distinct from 'string'
        or not exists (select 1 from jsonb_array_elements(q -> 'options') o where o.value ->> 'value' = v #>> '{}') then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid_option');
      end if;
    elsif t = 'multi' then
      if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) = 0 then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'required');
      elsif exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x.value) <> 'string')
        or exists (
          select 1 from jsonb_array_elements_text(v) x
          where not exists (select 1 from jsonb_array_elements(q -> 'options') o where o.value ->> 'value' = x.value)
        )
        or (select count(distinct x.value) from jsonb_array_elements_text(v) x) <> jsonb_array_length(v) then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid_option');
      else
        select count(*) into n_exclusive
        from jsonb_array_elements_text(v) x
        join jsonb_array_elements(q -> 'options') o on o.value ->> 'value' = x.value
        where coalesce((o.value ->> 'exclusive')::boolean, false);
        n_values := jsonb_array_length(v);
        if n_exclusive > 0 and n_values > 1 then
          errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'exclusive_option');
        end if;
      end if;
    elsif t = 'number' then
      if jsonb_typeof(v) is distinct from 'number' then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      elsif (q ? 'min' and (v #>> '{}')::numeric < (q ->> 'min')::numeric)
        or (q ? 'max' and (v #>> '{}')::numeric > (q ->> 'max')::numeric) then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'out_of_range');
      end if;
    elsif t = 'date' then
      if jsonb_typeof(v) is distinct from 'string' or not public.is_valid_date_text(v #>> '{}') then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      end if;
    elsif t = 'photos' then
      if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) = 0 then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'required');
      elsif jsonb_array_length(v) > public.max_photos() then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'too_many');
      elsif exists (
          select 1 from jsonb_array_elements(v) x
          where jsonb_typeof(x.value) <> 'string'
             or (x.value #>> '{}') !~ '^pending/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$')
        or (select count(distinct x.value) from jsonb_array_elements_text(v) x) <> jsonb_array_length(v) then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      end if;
    elsif t = 'time' then
      if jsonb_typeof(v) is distinct from 'string' or (v #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        errs := errs || jsonb_build_object('path', p_prefix || '.' || qid, 'code', 'invalid');
      end if;
    end if;
  end loop;

  return errs;
end;
$$;

create or replace function public.standard_subject_questions(p_difficulty_options jsonb, p_extra jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object(
      'id', 'textbook_publisher', 'type', 'single', 'required', true, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '모름', 'role', 'textbook',
      'label', '학교 교과서 출판사',
      'help', '교과서 표지 아래쪽에 적혀 있습니다.',
      'followup', '학교 교과서 출판사(교과서 표지 아래쪽에 적혀 있습니다)',
      'options', jsonb_build_array(
        jsonb_build_object('value', 'mirae', 'label', '미래엔'),
        jsonb_build_object('value', 'visang', 'label', '비상교육'),
        jsonb_build_object('value', 'chunjae', 'label', '천재교육·천재교과서'),
        jsonb_build_object('value', 'donga', 'label', '동아출판'),
        jsonb_build_object('value', 'jihak', 'label', '지학사'),
        jsonb_build_object('value', 'ybm', 'label', 'YBM'),
        jsonb_build_object('value', 'other', 'label', '다른 출판사')
      )
    ),
    jsonb_build_object(
      'id', 'textbook_publisher_other', 'type', 'short_text', 'required', true, 'active', true, 'locked', true,
      'max_length', 40, 'role', 'textbook',
      'label', '출판사 이름',
      'show_if', jsonb_build_object('question', 'textbook_publisher', 'any_of', jsonb_build_array('other'))
    ),
    jsonb_build_object(
      'id', 'textbook_author', 'type', 'short_text', 'required', false, 'active', true, 'locked', true,
      'max_length', 40, 'role', 'textbook',
      'label', '교과서 대표 저자',
      'help', '표지에 적힌 첫 번째 저자입니다. 같은 출판사 교과서가 여러 종류일 때 구분하는 데 씁니다.',
      'followup', '교과서 대표 저자(표지에 적힌 첫 번째 이름)'
    ),
    jsonb_build_object(
      'id', 'current_unit', 'type', 'short_text', 'required', true, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '모름', 'max_length', 100, 'role', 'progress',
      'label', '지금 학교에서 배우는 단원이나 범위',
      'help', '예: 2단원 일차방정식. 교재 목차와 학교의 실제 진도는 다를 수 있어요.',
      'followup', '지금 학교에서 배우는 단원이나 범위'
    ),
    jsonb_build_object(
      'id', 'workbook', 'type', 'short_text', 'required', false, 'active', true, 'locked', true,
      'max_length', 100, 'role', 'textbook',
      'label', '지금 풀고 있는 문제집',
      'help', '여러 권이면 쉼표로 나눠 적어주세요. 없으면 비워두셔도 됩니다.'
    ),
    jsonb_build_object(
      'id', 'recent_score', 'type', 'single', 'required', false, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '잘 모르겠음', 'role', 'score',
      'label', '최근 시험 점수는 어느 정도인가요?',
      'help', '점수와 함께 학교에서 배운 범위와 풀이 과정도 살펴봅니다.',
      'options', jsonb_build_array(
        jsonb_build_object('value', 's90', 'label', '90점 이상'),
        jsonb_build_object('value', 's80', 'label', '80~89점'),
        jsonb_build_object('value', 's60', 'label', '60~79점'),
        jsonb_build_object('value', 'below60', 'label', '60점 미만'),
        jsonb_build_object('value', 'no_score', 'label', '점수로 평가하지 않음')
      )
    ),
    jsonb_build_object(
      'id', 'exam_photos', 'type', 'photos', 'required', false, 'active', true, 'locked', true, 'role', 'score',
      'label', '이전 시험지 사진',
      'help', '채점된 시험지가 있으면 사진으로 올려주세요. 최대 5장까지 올릴 수 있습니다. 학생 이름 같은 개인정보는 가리고 찍어주시면 좋습니다.'
    ),
    jsonb_build_object(
      'id', 'interest', 'type', 'single', 'required', false, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '잘 모르겠음', 'role', 'confidence',
      'label', '학생은 이 과목을 어떻게 느끼나요?',
      'options', jsonb_build_array(
        jsonb_build_object('value', 'likes', 'label', '좋아하고 흥미가 있어요'),
        jsonb_build_object('value', 'neutral', 'label', '보통이에요'),
        jsonb_build_object('value', 'hard', 'label', '어렵거나 부담스러워해요')
      )
    ),
    jsonb_build_object(
      'id', 'difficulties', 'type', 'multi', 'required', true, 'active', true, 'locked', true,
      'role', 'difficulty',
      'label', '어려워하는 부분',
      'help', '해당하는 것을 모두 골라주세요. 아직 배우지 않은 내용은 고르지 않으셔도 됩니다.',
      'options', p_difficulty_options
    ),
    jsonb_build_object(
      'id', 'difficulties_other', 'type', 'short_text', 'required', true, 'active', true, 'locked', true,
      'max_length', 100, 'role', 'difficulty',
      'label', '‘기타’에 해당하는 내용',
      'show_if', jsonb_build_object('question', 'difficulties', 'any_of', jsonb_build_array('other'))
    )
  )
  || coalesce(p_extra, '[]'::jsonb)
  || jsonb_build_array(
    jsonb_build_object(
      'id', 'goal', 'type', 'multi', 'required', true, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '상담하면서 정하고 싶어요', 'role', 'goal',
      'label', '수업에서 중요하게 생각하는 목표',
      'help', '해당하는 것을 모두 골라주세요.',
      'options', jsonb_build_array(
        jsonb_build_object('value', 'follow_school', 'label', '학교 수업을 잘 따라가기'),
        jsonb_build_object('value', 'school_exam', 'label', '학교 시험 준비'),
        jsonb_build_object('value', 'basics', 'label', '기초 개념 다시 잡기'),
        jsonb_build_object('value', 'next_term', 'label', '다음 학기·학년 내용 미리 공부하기'),
        jsonb_build_object('value', 'habit', 'label', '혼자 공부하는 습관 만들기'),
        jsonb_build_object('value', 'other', 'label', '기타')
      ),
      'followup', '수업에서 중요하게 생각하시는 목표'
    ),
    jsonb_build_object(
      'id', 'goal_detail', 'type', 'long_text', 'required', false, 'active', true, 'locked', true,
      'max_length', 500, 'role', 'goal',
      'label', '목표에 대해 더 알려주실 내용',
      'help', '예: 이번 기말고사까지 함수 단원을 정리하고 싶어요.'
    ),
    jsonb_build_object(
      'id', 'teacher_notes', 'type', 'long_text', 'required', false, 'active', true, 'locked', true,
      'max_length', 1000, 'role', 'note',
      'label', '선생님이 알아두면 좋은 점',
      'help', '예: 시험 때 긴장하면 실수가 늘어요. 설명을 들으면 이해는 빠른 편이에요.'
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 기존 과목 양식 올리기: 목표를 복수 선택으로, 최근 점수 아래에 시험지 사진 질문 추가
-- 발행본은 새 버전으로 발행하고, 작성 중인 초안이 있으면 초안도 같은 방식으로 고친다.
-- ---------------------------------------------------------------------------
create or replace function public.upgrade_questions_20261006(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  q jsonb;
  out jsonb := '[]'::jsonb;
  has_photos boolean := exists (select 1 from jsonb_array_elements(p) e where e.value ->> 'id' = 'exam_photos');
  photo jsonb := jsonb_build_object(
    'id', 'exam_photos', 'type', 'photos', 'required', false, 'active', true, 'locked', true, 'role', 'score',
    'label', '이전 시험지 사진',
    'help', '채점된 시험지가 있으면 사진으로 올려주세요. 최대 5장까지 올릴 수 있습니다. 학생 이름 같은 개인정보는 가리고 찍어주시면 좋습니다.');
  inserted boolean := false;
begin
  for q in select value from jsonb_array_elements(p) loop
    if q ->> 'id' = 'goal' and q ->> 'type' = 'single' then
      q := q || jsonb_build_object(
        'type', 'multi',
        'label', '수업에서 중요하게 생각하는 목표',
        'help', '해당하는 것을 모두 골라주세요.',
        'followup', '수업에서 중요하게 생각하시는 목표');
    end if;
    out := out || jsonb_build_array(q);
    if not has_photos and not inserted and q ->> 'id' = 'recent_score' then
      out := out || jsonb_build_array(photo);
      inserted := true;
    end if;
  end loop;
  if not has_photos and not inserted then
    out := out || jsonb_build_array(photo);
  end if;
  return out;
end;
$$;

do $$
declare
  t record;
  pub public.form_versions;
  next_no integer;
begin
  for t in select id from public.form_templates where kind = 'subject' loop
    update public.form_versions set questions = public.upgrade_questions_20261006(questions)
    where template_id = t.id and status = 'draft';

    select * into pub from public.form_versions where template_id = t.id and status = 'published';
    if pub.id is not null and public.upgrade_questions_20261006(pub.questions) is distinct from pub.questions then
      select coalesce(max(version_no), 0) + 1 into next_no from public.form_versions where template_id = t.id;
      update public.form_versions set status = 'superseded', superseded_at = now() where id = pub.id;
      insert into public.form_versions (template_id, status, version_no, published_at, questions)
      values (t.id, 'published', next_no, now(), public.upgrade_questions_20261006(pub.questions));
    end if;
  end loop;
end $$;

drop function public.upgrade_questions_20261006(jsonb);

-- 새 함수 권한 (Supabase 는 새 함수에 anon 실행 권한을 기본으로 준다)
revoke all on function public.max_photos() from public, anon;
grant execute on function public.max_photos() to authenticated;
