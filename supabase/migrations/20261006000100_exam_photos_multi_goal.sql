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
