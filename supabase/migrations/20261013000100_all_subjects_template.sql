-- 과목·학년에 상관없이 쓰는 공용 양식
-- 특정 과목 수업이 아닌 상담(여러 과목, 초등~고등 전 학년)에 쓴다.
-- 과목별 질문(출판사 목록, 학년별 단원)은 빼고, 어떤 과목·학년이든 답할 수 있는 질문만 둔다.
-- 이미 '전 과목' 과목이 있으면 아무것도 하지 않는다(여러 번 실행해도 안전).

do $$
declare
  s_id uuid;
  t_id uuid;
begin
  if exists (select 1 from public.subjects where lower(name) = lower('전 과목') and archived_at is null) then
    return;
  end if;

  insert into public.subjects (name, description, perspective, sort_order)
  values (
    '전 과목',
    '과목과 학년에 상관없이 받는 상담입니다. 수업할 과목과 방향은 상담하면서 함께 정합니다.',
    '지금 배우는 내용과 어려워하는 부분을 먼저 확인합니다. 학생에게 필요한 과목과 공부 방법을 정해 수업 계획으로 연결합니다.',
    5)
  returning id into s_id;

  insert into public.form_templates (kind, subject_id, name, description)
  values ('subject', s_id, '모든 과목 공용 양식', '초등학교부터 고등학교까지, 과목에 상관없이 쓰는 기본 질문입니다.')
  returning id into t_id;

  insert into public.form_versions (template_id, status, version_no, published_at, questions)
  values (t_id, 'published', 1, now(), jsonb_build_array(
    jsonb_build_object(
      'id', 'lesson_subjects', 'type', 'multi', 'required', true, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '상담하면서 정하고 싶어요', 'role', 'progress',
      'label', '수업받고 싶은 과목',
      'help', '해당하는 것을 모두 골라주세요.',
      'options', jsonb_build_array(
        jsonb_build_object('value', 'korean', 'label', '국어'),
        jsonb_build_object('value', 'english', 'label', '영어'),
        jsonb_build_object('value', 'math', 'label', '수학'),
        jsonb_build_object('value', 'science', 'label', '과학'),
        jsonb_build_object('value', 'social', 'label', '사회·역사'),
        jsonb_build_object('value', 'other', 'label', '기타')
      )
    ),
    jsonb_build_object(
      'id', 'lesson_subjects_other', 'type', 'short_text', 'required', true, 'active', true, 'locked', true,
      'max_length', 60, 'role', 'progress',
      'label', '‘기타’에 해당하는 과목',
      'show_if', jsonb_build_object('question', 'lesson_subjects', 'any_of', jsonb_build_array('other'))
    ),
    jsonb_build_object(
      'id', 'current_unit', 'type', 'short_text', 'required', true, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '모름', 'max_length', 200, 'role', 'progress',
      'label', '지금 학교에서 배우는 단원이나 범위',
      'help', '과목이 여러 개면 과목별로 적어주세요. 예: 수학 분수의 나눗셈, 영어 3과',
      'followup', '지금 학교에서 배우는 단원이나 범위'
    ),
    jsonb_build_object(
      'id', 'textbook_publisher', 'type', 'short_text', 'required', false, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '모름', 'max_length', 100, 'role', 'textbook',
      'label', '학교 교과서 출판사',
      'help', '교과서 표지 아래쪽에 적혀 있습니다. 과목이 여러 개면 과목별로 적어주세요.',
      'followup', '학교 교과서 출판사(교과서 표지 아래쪽에 적혀 있습니다)'
    ),
    jsonb_build_object(
      'id', 'workbook', 'type', 'short_text', 'required', false, 'active', true, 'locked', true,
      'max_length', 100, 'role', 'textbook',
      'label', '지금 풀고 있는 문제집이나 교재',
      'help', '여러 권이면 쉼표로 나눠 적어주세요. 없으면 비워두셔도 됩니다.'
    ),
    jsonb_build_object(
      'id', 'recent_score', 'type', 'single', 'required', false, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '잘 모르겠음', 'role', 'score',
      'label', '최근 시험이나 평가 결과는 어느 정도인가요?',
      'help', '과목마다 다르면 가장 신경 쓰이는 과목을 기준으로 골라주세요.',
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
      'label', '학생은 공부를 어떻게 느끼나요?',
      'options', jsonb_build_array(
        jsonb_build_object('value', 'likes', 'label', '좋아하고 흥미가 있어요'),
        jsonb_build_object('value', 'neutral', 'label', '보통이에요'),
        jsonb_build_object('value', 'hard', 'label', '어렵거나 부담스러워해요'),
        jsonb_build_object('value', 'varies', 'label', '과목마다 달라요')
      )
    ),
    jsonb_build_object(
      'id', 'difficulties', 'type', 'multi', 'required', true, 'active', true, 'locked', true,
      'role', 'difficulty',
      'label', '어려워하는 부분',
      'help', '해당하는 것을 모두 골라주세요.',
      'options', jsonb_build_array(
        jsonb_build_object('value', 'concept', 'label', '용어·개념 이해'),
        jsonb_build_object('value', 'memorize', 'label', '배운 내용 기억하기'),
        jsonb_build_object('value', 'reading', 'label', '글이나 문제를 읽고 이해하기'),
        jsonb_build_object('value', 'apply', 'label', '배운 내용을 문제에 적용하기'),
        jsonb_build_object('value', 'calc', 'label', '계산 실수'),
        jsonb_build_object('value', 'written', 'label', '서술형·글쓰기'),
        jsonb_build_object('value', 'prior_grade', 'label', '이전 학년 내용'),
        jsonb_build_object('value', 'focus', 'label', '집중하기·공부 습관'),
        jsonb_build_object('value', 'other', 'label', '기타'),
        jsonb_build_object('value', 'not_sure', 'label', '잘 모르겠음', 'exclusive', true)
      )
    ),
    jsonb_build_object(
      'id', 'difficulties_other', 'type', 'short_text', 'required', true, 'active', true, 'locked', true,
      'max_length', 100, 'role', 'difficulty',
      'label', '‘기타’에 해당하는 내용',
      'show_if', jsonb_build_object('question', 'difficulties', 'any_of', jsonb_build_array('other'))
    ),
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
      'id', 'goal', 'type', 'multi', 'required', true, 'active', true, 'locked', true,
      'allow_unknown', true, 'unknown_label', '상담하면서 정하고 싶어요', 'role', 'goal',
      'label', '수업에서 중요하게 생각하는 목표',
      'help', '해당하는 것을 모두 골라주세요.',
      'options', jsonb_build_array(
        jsonb_build_object('value', 'follow_school', 'label', '학교 수업을 잘 따라가기'),
        jsonb_build_object('value', 'school_exam', 'label', '학교 시험·평가 준비'),
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
      'help', '예: 이번 학기 안에 영어 단어 공부 습관을 잡고 싶어요.'
    ),
    jsonb_build_object(
      'id', 'teacher_notes', 'type', 'long_text', 'required', false, 'active', true, 'locked', true,
      'max_length', 1000, 'role', 'note',
      'label', '선생님이 알아두면 좋은 점',
      'help', '예: 시험 때 긴장하면 실수가 늘어요. 설명을 들으면 이해는 빠른 편이에요.'
    )
  ));

  update public.subjects set default_template_id = t_id where id = s_id;
end $$;
