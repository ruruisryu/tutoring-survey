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
