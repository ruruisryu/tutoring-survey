-- 개발용 예시 데이터. 실제 Supabase 프로젝트에는 넣지 않는다.
-- 학생·학부모 응답은 넣지 않는다 (화면에서 직접 제출해 확인한다).
-- 소개·수업료 같은 실제 운영 문구는 저장소에 넣지 않는다. 운영에서는 관리자 화면에 입력한다 (docs/운영-설정-예시.md 참고).

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'admin@dev.localhost'),
  ('00000000-0000-4000-8000-0000000000b2', 'member@dev.localhost')
on conflict do nothing;

-- admin 만 관리자로 등록. member 는 로그인은 되지만 관리자 권한이 없는 계정.
insert into public.admin_memberships (user_id, note)
values ('00000000-0000-4000-8000-0000000000a1', '개발용 관리자')
on conflict do nothing;

update public.app_settings set
  teacher_name = '',
  teacher_intro = '(개발용 예시) 중등수학·중등과학·통합과학을 1:1 화상 수업으로 지도합니다.

수업에서는 개념 이해 → 문제 적용 → 오답 분석 → 복습의 과정을 학생이 스스로 해낼 수 있도록 지도합니다. 학생이 문제를 푸는 모습을 보면서 어떻게 접근하는지, 어느 개념에서 막히는지, 어떤 실수를 반복하는지 확인합니다.',
  policy_notice = '(개발용 예시) 환불은 운영자가 정한 환불 규정을 따릅니다.
당일 취소나 불참 시 처리 규칙을 여기에 적습니다.',
  operator_name = '(개발용) 운영자 이름',
  operator_contact = '(개발용) 010-0000-0000',
  privacy_retention = '(개발용) 수업 종료 후 6개월',
  privacy_deletion = '(개발용) 운영자 연락처로 삭제를 요청하시면 확인 후 지체 없이 삭제합니다.',
  privacy_confirmed = true,
  privacy_confirmed_at = now()
where id = 1;

do $$
declare
  math uuid;
  sci uuid;
  isci uuid;
  c_math uuid := '00000000-0000-4000-8000-00000000c001';
  c_sci uuid := '00000000-0000-4000-8000-00000000c002';
  c_isci uuid := '00000000-0000-4000-8000-00000000c003';
  c_closed uuid := '00000000-0000-4000-8000-00000000c004';
  c_exam uuid := '00000000-0000-4000-8000-00000000c005';
  i_math uuid := '00000000-0000-4000-8000-00000000e001';
  i_sci uuid := '00000000-0000-4000-8000-00000000e002';
  i_isci uuid := '00000000-0000-4000-8000-00000000e003';
  i_multi uuid := '00000000-0000-4000-8000-00000000e004';
  i_closed uuid := '00000000-0000-4000-8000-00000000e005';
  i_inactive uuid := '00000000-0000-4000-8000-00000000e006';
  i_exam uuid := '00000000-0000-4000-8000-00000000e007';
  online_note text := '1:1 화상 수업입니다.';
begin
  select id into math from public.subjects where name = '수학';
  select id into sci from public.subjects where name = '과학';
  select id into isci from public.subjects where name = '통합과학';

  insert into public.courses (
    id, subject_id, template_id, name, school_level, grades, scope_text, mode, group_type, sessions_per_week,
    minutes_per_session, weekdays, time_bands, start_time, time_note, start_date, duration_text, fixed_conditions,
    session_choices, notice, sort_order)
  values
    -- 정규 클래스: 회당 2시간 확정, 주 1회 또는 2회 중 선택
    (c_math, math, (select default_template_id from public.subjects where id = math),
      '중등수학 정규 클래스', 'middle', '{1,2,3}', '중학교 1~3학년 수학 (학교 진도 기준)', 'online', 'individual', null,
      120, '{}', '{}', null, '', null, '', '{minutes}', '{1,2}',
      online_note || ' (개발용 예시) 수업료는 주당 횟수와 기간에 따라 안내드립니다.', 10),
    -- 수업별로 조건을 고정하는 예: 토요일 오전, 120분, 주 1회 확정 · 첫 수업 날짜와 시작 시각은 조율
    (c_sci, sci, (select default_template_id from public.subjects where id = sci),
      '중등과학 정규 클래스 · 토요일 오전반', 'middle', '{1,2,3}', '중학교 1~3학년 과학 (학교 진도 기준)', 'online', 'individual', 1,
      120, '{6}', '{morning}', null, '토요일 오전', null, '', '{weekdays,minutes,sessions}', '{}',
      online_note || ' 첫 수업 날짜와 정확한 시작 시각은 상담하면서 정합니다.', 20),
    (c_isci, isci, (select default_template_id from public.subjects where id = isci),
      '통합과학 정규 클래스', 'high', '{1,2,3}', '고등학교 통합과학', 'online', 'individual', null,
      120, '{}', '{}', null, '', null, '', '{minutes}', '{1,2}',
      online_note || ' (개발용 예시) 수업료는 주당 횟수와 기간에 따라 안내드립니다.', 30),
    -- 내신 집중 대비: 화상 또는 대면 중 선택, 회차는 시험 범위에 따라 안내
    (c_exam, math, (select default_template_id from public.subjects where id = math),
      '중등수학 내신 집중 대비 클래스', 'middle', '{1,2,3}', '학교 내신 시험 범위', 'negotiable', 'individual', null,
      120, '{}', '{}', null, '', null, '최소 4회차 (시험 범위에 따라 권장 회차 안내)', '{minutes,duration}', '{}',
      '학교 시험 범위와 난이도를 보고 권장 회차를 안내드립니다. 1회 2시간 기준입니다. (개발용 예시) 대면 수업 장소와 추가 비용은 여기에 적습니다.', 40),
    (c_closed, math, (select default_template_id from public.subjects where id = math),
      '중등수학 정규 클래스 (접수 마감)', 'middle', '{1,2,3}', '', 'online', 'individual', 1,
      120, '{2}', '{}', '19:00', '', null, '', '{weekdays,start_time,minutes,sessions}', '{}',
      '', 50);

  update public.courses set status = 'closed' where id = c_closed;

  insert into public.invitations (id, token, label, allow_multiple) values
    (i_math, 'devmathsingle00000000000000000000000000', '개발용 · 중등수학 정규', false),
    (i_sci, 'devsciencesingle0000000000000000000000', '개발용 · 중등과학 토요일 오전', false),
    (i_isci, 'devintegratedscience00000000000000000000', '개발용 · 통합과학 정규', false),
    (i_multi, 'devmultiplecourses000000000000000000000', '개발용 · 여러 수업 선택', true),
    (i_closed, 'devclosedcourse0000000000000000000000000', '개발용 · 접수 마감 수업', false),
    (i_exam, 'devexamprepclass000000000000000000000000', '개발용 · 내신 집중 대비', false);
  insert into public.invitations (id, token, label, allow_multiple, is_active) values
    (i_inactive, 'devinactivelink0000000000000000000000000', '개발용 · 비활성 링크', false, false);

  insert into public.invitation_courses (invitation_id, course_id, sort_order) values
    (i_math, c_math, 1),
    (i_sci, c_sci, 1),
    (i_isci, c_isci, 1),
    (i_multi, c_math, 1),
    (i_multi, c_sci, 2),
    (i_multi, c_isci, 3),
    (i_multi, c_exam, 4),
    (i_exam, c_exam, 1),
    (i_closed, c_closed, 1),
    (i_inactive, c_math, 1);
end $$;
