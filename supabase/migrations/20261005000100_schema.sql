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
