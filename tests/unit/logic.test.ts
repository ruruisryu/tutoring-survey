import { describe, expect, test } from 'vitest';
import { normalizePhone, maskPhone, formatPhone } from '../../src/lib/phone';
import { addDays, endTime, formatDateKo, seoulDate, timeInBands, timeOptions, weekdayOf } from '../../src/lib/time';
import { formatHomeworkTotal, homeworkTotal } from '../../src/lib/homework';
import { csvCell, toCsv } from '../../src/lib/csv';
import { cleanAnswers, validateAnswers, visibilityMap, validateQuestionDefs } from '../../src/lib/questions';
import { EMPTY_FILTER, dashboardStats, filterSubmissions, paginate } from '../../src/lib/adminList';
import { buildPayload, createDraft, estimateMinutes } from '../../src/lib/survey';
import { buildSmsDraft } from '../../src/lib/sms';
import { courseUnknowns } from '../../src/lib/unknowns';
import { targetText } from '../../src/components/CourseSummary';
import type { DetailCourse, ListSubmission, PublicCourse, PublicForm, Question, SubmissionDetail } from '../../src/lib/types';

describe('전화번호', () => {
  test.each([
    ['010-1234-5678', '01012345678'],
    ['010 1234 5678', '01012345678'],
    [' 01012345678 ', '01012345678'],
    ['(010) 1234.5678', '01012345678'],
    ['+82 10-1234-5678', '01012345678'],
    ['011-123-4567', '0111234567'],
  ])('%s → %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));

  test.each(['02-123-4567', '010-1234', 'abc-defg-hijk', '+1 650 555 1234', '010-1234-56789'])('거부: %s', (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );

  test('표시·마스킹', () => {
    expect(formatPhone('01012345678')).toBe('010-1234-5678');
    expect(maskPhone('01012345678')).toBe('010-****-5678');
    expect(maskPhone('0111234567')).toBe('011-***-4567');
  });
});

describe('날짜·시간 (Asia/Seoul)', () => {
  test('UTC 자정 직전·직후에도 서울 날짜를 쓴다', () => {
    // 2026-10-04T15:30Z = 서울 10월 5일 00:30
    expect(seoulDate(new Date('2026-10-04T15:30:00Z'))).toBe('2026-10-05');
    expect(seoulDate(new Date('2026-10-05T14:59:00Z'))).toBe('2026-10-05');
    expect(seoulDate(new Date('2026-10-05T15:00:00Z'))).toBe('2026-10-06');
  });

  test('날짜 문자열 연산은 하루가 밀리지 않는다', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(weekdayOf('2026-10-05')).toBe(1); // 월요일
    expect(formatDateKo('2026-10-05')).toBe('10월 5일(월)');
  });

  test('시작 시각 + 수업 길이 = 종료 시각', () => {
    expect(endTime('10:00', 120)).toEqual({ time: '12:00', nextDay: false });
    expect(endTime('19:00', 90)).toEqual({ time: '20:30', nextDay: false });
    expect(endTime('23:00', 90)).toEqual({ time: '00:30', nextDay: true });
  });

  test('시간대 범위', () => {
    expect(timeInBands('11:50', ['morning'])).toBe(true);
    expect(timeInBands('12:00', ['morning'])).toBe(false);
    expect(timeInBands('18:00', ['evening'])).toBe(true);
    expect(timeOptions(['morning']).every((t) => t >= '06:00' && t < '12:00')).toBe(true);
  });
});

describe('숙제 시간 합계', () => {
  test('구간의 최소·최대만 더한다', () => {
    expect(formatHomeworkTotal(homeworkTotal(['30_60', '60_90']))).toBe('주 90~150분');
    expect(formatHomeworkTotal(homeworkTotal(['lt30']))).toBe('주 30분 이내');
    expect(formatHomeworkTotal(homeworkTotal(['lt30', 'lt30']))).toBe('주 60분 이내');
  });
  test('120분 이상은 상한을 만들지 않는다', () => {
    expect(formatHomeworkTotal(homeworkTotal(['gte120', '30_60']))).toBe('주 150분 이상');
  });
  test('상담 후 결정이 있으면 합계 미확정', () => {
    expect(homeworkTotal(['30_60', 'tbd']).kind).toBe('undetermined');
    expect(formatHomeworkTotal(homeworkTotal(['30_60', 'tbd']))).toContain('합계 미확정');
  });
  test('선택이 없으면 빈 값', () => expect(homeworkTotal(['', null]).kind).toBe('empty'));
});

describe('CSV', () => {
  test('쉼표·따옴표·줄바꿈', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('그는 "네"라고')).toBe('"그는 ""네""라고"');
    expect(csvCell('첫 줄\n둘째 줄')).toBe('"첫 줄\n둘째 줄"');
    expect(csvCell(null)).toBe('');
  });
  test.each(['=1+1', '+82', '-5', '@SUM(A1)', '\tx', '=HYPERLINK("http://x")'])('수식 주입 방어: %s', (v) => {
    const out = csvCell(v);
    expect(out.replace(/^"/, '').startsWith("'")).toBe(true);
  });
  test('UTF-8 BOM 과 CRLF', () => {
    const s = toCsv([['가', '나'], ['1', '2']]);
    expect(s.charCodeAt(0)).toBe(0xfeff);
    expect(s).toBe('﻿가,나\r\n1,2\r\n');
  });
});

const qs: Question[] = [
  { id: 'kind', type: 'single', label: '종류', required: true, active: true, options: [{ value: 'a', label: 'A' }, { value: 'other', label: '기타' }] },
  { id: 'kind_other', type: 'short_text', label: '기타 내용', required: true, active: true, show_if: { question: 'kind', any_of: ['other'] } },
  { id: 'nested', type: 'short_text', label: '중첩', required: true, active: true, show_if: { question: 'kind_other' as string, any_of: ['x'] } },
  { id: 'tags', type: 'multi', label: '태그', required: false, active: true, options: [{ value: 'x', label: 'X' }, { value: 'none', label: '없음', exclusive: true }] },
  { id: 'note', type: 'short_text', label: '메모', required: true, active: true, allow_unknown: true, max_length: 5 },
];

describe('질문 표시 조건과 검증', () => {
  test('조건 질문이 숨겨지면 후속 질문도 숨긴다', () => {
    const vis = visibilityMap(qs, { kind: { status: 'answered', value: 'a' } });
    expect(vis.kind_other).toBe(false);
    expect(vis.nested).toBe(false);
  });
  test('조건부 필수와 모름', () => {
    const errs = validateAnswers(qs, { kind: { status: 'answered', value: 'other' }, note: { status: 'unknown' } }, 'p');
    expect(errs).toEqual([{ path: 'p.kind_other', code: 'required' }]);
  });
  test('글자 수·단독 선택', () => {
    const errs = validateAnswers(
      qs,
      { kind: { status: 'answered', value: 'a' }, note: { status: 'answered', value: '123456' }, tags: { status: 'answered', value: ['x', 'none'] } },
      'p',
    );
    expect(errs).toEqual([
      { path: 'p.tags', code: 'exclusive_option' },
      { path: 'p.note', code: 'too_long' },
    ]);
  });
  test('숨겨진 답과 빈 답은 보내지 않는다', () => {
    const out = cleanAnswers(qs, {
      kind: { status: 'answered', value: 'a' },
      kind_other: { status: 'answered', value: '남은 값' },
      tags: { status: 'answered', value: [] },
      note: { status: 'answered', value: '  ' },
    });
    expect(out).toEqual({ kind: { status: 'answered', value: 'a' } });
  });
  test('질문 정의 검증: 앞선 선택형 질문만 조건으로', () => {
    const bad: Question[] = [
      { id: 'qb', type: 'short_text', label: 'B', required: false, active: true, show_if: { question: 'qa', any_of: ['x'] } },
      { id: 'qa', type: 'single', label: 'A', required: false, active: true, options: [{ value: 'x', label: 'X' }] },
      { id: 'qa', type: 'single', label: 'A2', required: false, active: true, options: [{ value: 'X Y', label: '' }] },
      { id: 'Bad Id', type: 'short_text', label: 'C', required: false, active: true },
    ];
    const codes = validateQuestionDefs(bad).map((e) => e.code);
    expect(codes).toEqual(['show_if_ref', 'duplicate_id', 'bad_option', 'bad_id']);
  });
});

const course = (over: Partial<PublicCourse> = {}): PublicCourse => ({
  id: 'c1',
  name: '중학교 과학 토요반',
  subject_id: 's1',
  subject_name: '과학',
  subject_description: '',
  subject_perspective: '',
  version_id: 'v1',
  version_no: 1,
  questions: [],
  school_level: 'middle',
  grades: [1, 2, 3],
  scope_text: '',
  mode: 'in_person',
  group_type: 'individual',
  sessions_per_week: 1,
  minutes_per_session: 120,
  weekdays: [6],
  time_bands: ['morning'],
  start_time: null,
  time_note: '',
  start_date: null,
  duration_text: '',
  fixed_conditions: ['weekdays', 'minutes', 'sessions'],
  session_choices: [],
  notice: '',
  ...over,
});

describe('수업 대상 표시', () => {
  test('중학교 1~3학년', () => {
    expect(targetText({ school_level: 'middle', grades: [3, 1, 2] })).toBe('중학교 1~3학년');
    expect(targetText({ school_level: 'middle', grades: [] })).toBe('중학교 전 학년');
    expect(targetText({ school_level: 'middle', grades: [1, 3] })).toBe('중학교 1·3학년');
    expect(targetText({ school_level: 'high', grades: [1] })).toBe('고등학교 1학년');
  });
});

describe('제출 데이터', () => {
  test('확정 조건은 보내지 않고, 조율 조건만 보낸다', () => {
    const form: PublicForm = { status: 'open', settings: {} as PublicForm['settings'], allow_multiple: false, courses: [course()], today: '2026-10-05' };
    const d = createDraft(form);
    d.courses.c1.schedule.start_undecided = true;
    d.courses.c1.schedule.start_date = '2026-10-10'; // 화면에서는 막지만, 보내는 값에서는 미정이 우선
    d.courses.c1.schedule.minutes = 90;
    const p = buildPayload(form, d);
    const s = p.courses[0].schedule;
    expect(s).not.toHaveProperty('minutes');
    expect(s).not.toHaveProperty('sessions_per_week');
    expect(s).not.toHaveProperty('mode');
    expect(s.start_date).toBeNull();
    expect(s.start_undecided).toBe(true);
    expect(estimateMinutes(form, d.selected)).toBeGreaterThanOrEqual(3);
  });
});

const listItem = (over: Partial<ListSubmission>): ListSubmission => ({
  id: 'x',
  receipt_code: 'ABCD1234',
  received_at: '2026-10-04T15:30:00Z', // 서울 10월 5일
  parent_name: '김보호',
  parent_phone: '01012345678',
  student_name: '민준',
  school_level: 'middle',
  grade: 2,
  grade_note: '',
  school_name: '',
  unknown_count: 0,
  courses: [
    {
      id: 'sc1', course_id: 'c1', course_name: '수학반', subject_id: 'm', subject_name: '수학', preferred_start_date: null, preferred_start_undecided: true,
      fixed_start_date: null, time_undecided: false, slots: [{ weekday: 3, start_time: '19:00' }], homework_band: '30_60', unknown_count: 1,
      status: 'scheduled', next_contact_date: '2026-10-04', confirmed_start_date: null, updated_at: '',
    },
    {
      id: 'sc2', course_id: 'c2', course_name: '과학반', subject_id: 's', subject_name: '과학', preferred_start_date: '2026-10-10', preferred_start_undecided: false,
      fixed_start_date: null, time_undecided: true, slots: [], homework_band: 'tbd', unknown_count: 0,
      status: 'needs_info', next_contact_date: null, confirmed_start_date: null, updated_at: '',
    },
  ],
  ...over,
});

describe('관리자 목록·대시보드', () => {
  const list = [listItem({}), listItem({ id: 'y', student_name: '서연', parent_phone: '01099998888', courses: [listItem({}).courses[1]] })];
  test('검색: 이름·연락처 일부', () => {
    expect(filterSubmissions(list, { ...EMPTY_FILTER, q: '서연' }).map((s) => s.id)).toEqual(['y']);
    expect(filterSubmissions(list, { ...EMPTY_FILTER, q: '9888' }).map((s) => s.id)).toEqual(['y']);
    expect(filterSubmissions(list, { ...EMPTY_FILTER, q: '010-1234-5678' }).map((s) => s.id)).toEqual(['x']);
  });
  test('과목·상태·요일 필터는 같은 수업에서 함께 맞아야 한다', () => {
    expect(filterSubmissions(list, { ...EMPTY_FILTER, subjectId: 's', weekday: '3' })).toEqual([]);
    expect(filterSubmissions(list, { ...EMPTY_FILTER, subjectId: 'm', weekday: '3' }).map((s) => s.id)).toEqual(['x']);
    expect(filterSubmissions(list, { ...EMPTY_FILTER, status: 'scheduled' }).map((s) => s.id)).toEqual(['x']);
  });
  test('접수일은 서울 날짜 기준', () => {
    expect(filterSubmissions(list, { ...EMPTY_FILTER, from: '2026-10-05', to: '2026-10-05' })).toHaveLength(2);
    expect(filterSubmissions(list, { ...EMPTY_FILTER, to: '2026-10-04' })).toHaveLength(0);
  });
  test('제출 건수와 수업별 상담 건수를 나눠 센다', () => {
    const s = dashboardStats(list, '2026-10-05');
    expect(s.submissions).toBe(2);
    expect(s.courseConsults).toBe(3);
    expect(s.byStatus.needs_info).toBe(2);
    expect(s.needsCheck).toBe(3);
    expect(s.upcoming[0]).toMatchObject({ studentName: '민준', overdue: true });
    expect(dashboardStats([], '2026-10-05')).toMatchObject({ submissions: 0, courseConsults: 0, upcoming: [] });
  });
  test('페이지', () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], page: 2, pages: 3 });
    expect(paginate([], 5, 20)).toEqual({ items: [], page: 1, pages: 1 });
  });
});

describe('확인 문자 초안', () => {
  const qText: Question = { id: 'textbook_publisher', type: 'short_text', label: '학교 교과서 출판사', required: true, active: true, allow_unknown: true, followup: '학교 교과서 출판사' };
  const dc = (id: string, subject: string, over: Partial<DetailCourse> = {}): DetailCourse => ({
    id,
    course_id: id,
    subject_id: subject,
    position: 0,
    course: { ...course({ id, name: `${subject}반`, subject_name: subject, minutes_per_session: 90 }), version_no: 1 },
    version_id: 'v',
    version_no: 1,
    questions: [qText],
    answers: { textbook_publisher: { status: 'unknown' } },
    schedule: { start_date: null, start_undecided: true, time_undecided: false, slots: [{ weekday: 3, start_time: '19:00' }], duration: '', sessions_per_week: null, minutes: null, mode: null, group_type: null, note: '' },
    homework_band: '30_60',
    assessments: [],
    unknown_count: 2,
    consultation: { status: 'new', consult_memo: '', plan_memo: '', confirmed_start_date: null, confirmed_minutes: null, next_contact_date: null, created_at: '', updated_at: '', slots: [] },
    ...over,
  });
  const detail: SubmissionDetail = {
    id: 'sub', receipt_code: 'R', received_at: '', parent_name: '김보호', parent_phone: '01012345678', student_name: '민준', school_level: 'middle', grade: 2,
    grade_note: '', school_name: '', general_request: '', consecutive_request: null, consecutive_note: '', privacy_consented_at: '', privacy_snapshot: {},
    unknown_count: 0, invitation_label: null, common: { version_id: null, version_no: null, questions: [], answers: {} },
    courses: [
      dc('a', '수학', { consultation: { status: 'scheduled', consult_memo: '', plan_memo: '', confirmed_start_date: '2026-10-21', confirmed_minutes: 90, next_contact_date: null, created_at: '', updated_at: '', slots: [{ weekday: 3, start_time: '19:00' }] } }),
      dc('b', '과학'),
    ],
  };

  test('여러 수업에 같은 일정 질문은 공통으로 한 번, 과목 질문은 과목명과 함께', () => {
    const text = buildSmsDraft(detail, { teacherName: '한지민', courseIds: ['a', 'b'], includeSchedule: true });
    expect(text.startsWith('안녕하세요, 한지민 선생님입니다.')).toBe(true);
    expect(text.match(/첫 수업을 시작하고 싶은 날짜/g)).toHaveLength(1);
    expect(text).toContain('첫 수업을 시작하고 싶은 날짜 (수학·과학): 정해지면 알려주세요.');
    expect(text).toContain('[수학]\n- 학교 교과서 출판사');
    expect(text).toContain('[과학]\n- 학교 교과서 출판사');
    expect(text).toContain('- 수학: 확정: 수 19:00~20:30, 10월 21일(수) 시작');
    expect(text).toContain('- 과학: 희망하신 일정: 수 19:00~20:30 (아직 확정 전입니다)');
  });

  test('선생님 이름이 없으면 이름을 만들지 않는다', () => {
    const text = buildSmsDraft(detail, { teacherName: '', courseIds: ['b'], includeSchedule: false });
    expect(text.startsWith('안녕하세요, 수업 상담 관련해 연락드립니다.')).toBe(true);
    expect(text).not.toContain('[수학]');
    expect(text).not.toContain('[일정]');
    expect(text).not.toContain('(수학·과학)');
  });

  test('미확인 항목 수는 서버 집계 규칙과 같다', () => {
    expect(courseUnknowns(detail.courses[1])).toHaveLength(2);
  });
});
