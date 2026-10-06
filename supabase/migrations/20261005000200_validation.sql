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
