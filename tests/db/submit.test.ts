import { beforeAll, describe, expect, test } from 'vitest';
import { ApiError } from '../../src/lib/backend/errors';
import { buildPayload, validateAll } from '../../src/lib/survey';
import type { PublicForm, SubmissionDetail } from '../../src/lib/types';
import { validDraft } from './fixtures';
import { ADMIN, ANON, createDb, TOKENS, type TestDb } from './harness';

let t: TestDb;
const key = () => crypto.randomUUID();

async function form(token: string) {
  return t.rpc<PublicForm>(ANON, 'get_public_form', { p_token: token });
}

async function submit(token: string, payload: unknown, idem = key()) {
  return t.rpc<{ ok: boolean; receipt_code: string; duplicate: boolean }>(ANON, 'submit_consultation', {
    p_token: token,
    p_idempotency_key: idem,
    p_payload: payload,
  });
}

async function expectError(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, `expected ${code}`).toBeInstanceOf(ApiError);
  expect((e as ApiError).code).toBe(code);
  return e as ApiError;
}

beforeAll(async () => {
  t = await createDb();
}, 60_000);

describe('공개 양식 조회', () => {
  test('유효한 링크는 안내와 질문만 돌려준다', async () => {
    const f = await form(TOKENS.math);
    expect(f.status).toBe('open');
    expect(f.courses).toHaveLength(1);
    const q = f.courses![0].questions[0] as unknown as Record<string, unknown>;
    expect(q).not.toHaveProperty('followup');
    expect(q).not.toHaveProperty('role');
    expect(f).not.toHaveProperty('submissions');
    expect(f.settings.operator_name).toBeTruthy();
  });

  test.each([
    ['없는 토큰', 'x'.repeat(40), 'invalid'],
    ['형식이 틀린 토큰', 'abc', 'invalid'],
    ['비활성 링크', TOKENS.inactive, 'closed'],
    ['마감된 수업만 연결된 링크', TOKENS.closedCourse, 'closed'],
  ])('%s → %s', async (_n, token, status) => {
    const f = await form(token);
    expect(f.status).toBe(status);
    expect(f.courses).toBeUndefined();
  });
});

describe('제출', () => {
  test.each([
    ['수학', TOKENS.math],
    ['과학', TOKENS.science],
    ['통합과학', TOKENS.integrated],
  ])('%s 단독 제출', async (_n, token) => {
    const f = await form(token);
    const d = validDraft(f);
    expect(validateAll(f, d, f.today!)).toEqual([]);
    const r = await submit(token, buildPayload(f, d));
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(false);
    expect(r.receipt_code).toMatch(/^[0-9A-F]{8}$/);
  });

  test.each([
    ['middle-1', 1],
    ['middle-3', 3],
  ])('중학교 수업은 중1~3 모두 접수 (%s)', async (gradeKey, grade) => {
    const f = await form(TOKENS.multi);
    expect(f.courses!.filter((c) => c.school_level === 'middle').every((c) => c.grades.join() === '1,2,3')).toBe(true);
    const d = validDraft(f, f.courses!.filter((c) => c.school_level === 'middle').map((c) => c.id));
    d.common.grade_key = gradeKey;
    const r = await submit(TOKENS.multi, buildPayload(f, d));
    const rows = await t.root<{ grade: number }>('select grade from submissions where receipt_code = $1', [r.receipt_code]);
    expect(rows[0].grade).toBe(grade);
  });

  test('수학·과학 복수 제출: 공통 정보 1건, 수업별 정보 2건', async () => {
    const f = await form(TOKENS.multi);
    const ids = f.courses!.slice(0, 2).map((c) => c.id);
    const d = validDraft(f, ids);
    d.common.consecutive_request = 'yes';
    const r = await submit(TOKENS.multi, buildPayload(f, d));
    const rows = await t.root<{ n: number; courses: number }>(
      `select (select count(*) from submissions where receipt_code = $1)::int as n,
              (select count(*) from submission_courses sc join submissions s on s.id = sc.submission_id where s.receipt_code = $1)::int as courses`,
      [r.receipt_code],
    );
    expect(rows[0]).toEqual({ n: 1, courses: 2 });
    const detailId = (await t.root<{ id: string }>(`select id from submissions where receipt_code = $1`, [r.receipt_code]))[0].id;
    const detail = await t.rpc<SubmissionDetail>(ADMIN, 'admin_get_submission', { p_id: detailId });
    expect(detail.parent_phone).toBe('01012345678');
    expect(detail.consecutive_request).toBe('yes');
    expect(detail.courses.map((c) => c.course.subject_name)).toEqual(['수학', '과학']);
    expect(detail.courses.every((c) => c.consultation.status === 'new')).toBe(true);
    // 수업별 답변이 서로 섞이지 않는다
    expect(detail.courses[0].answers.difficulties).toEqual({ status: 'answered', value: ['calc'] });
    expect(detail.courses[1].answers.difficulties).toEqual({ status: 'answered', value: ['terms'] });
  });

  test('단일 수업 링크로 여러 수업을 보내면 거부', async () => {
    const f = await form(TOKENS.multi);
    const d = validDraft(f, f.courses!.slice(0, 2).map((c) => c.id));
    const e = await expectError(submit(TOKENS.math, buildPayload(f, d)), 'validation_failed');
    expect(e.fieldErrors).toContainEqual({ path: 'courses', code: 'too_many' });
  });

  test('링크가 허용하지 않은 수업 ID는 거부', async () => {
    const f = await form(TOKENS.multi);
    const sci = f.courses!.find((c) => c.subject_name === '과학')!;
    const d = validDraft(f, [sci.id]);
    await expectError(submit(TOKENS.math, buildPayload(f, d)), 'course_unavailable');
  });

  test('같은 idempotency key 로 두 번 보내면 한 건만 생성', async () => {
    const f = await form(TOKENS.math);
    const payload = buildPayload(f, validDraft(f));
    const k = key();
    const before = (await t.root<{ n: number }>('select count(*)::int n from submissions'))[0].n;
    const [a, b] = await Promise.all([submit(TOKENS.math, payload, k), submit(TOKENS.math, payload, k)]);
    const after = (await t.root<{ n: number }>('select count(*)::int n from submissions'))[0].n;
    expect(after - before).toBe(1);
    expect(a.receipt_code).toBe(b.receipt_code);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
  });

  test('복수 과목 중 하나라도 틀리면 아무것도 저장하지 않는다', async () => {
    const f = await form(TOKENS.multi);
    const ids = f.courses!.slice(0, 2).map((c) => c.id);
    const d = validDraft(f, ids);
    d.courses[ids[1]].homework_band = '';
    const before = await t.root<{ s: number; c: number; a: number }>(
      'select (select count(*) from submissions)::int s, (select count(*) from submission_courses)::int c, (select count(*) from answers)::int a',
    );
    const e = await expectError(submit(TOKENS.multi, buildPayload(f, d)), 'validation_failed');
    expect(e.fieldErrors).toContainEqual({ path: 'courses.1.homework_band', code: 'required' });
    const after = await t.root('select (select count(*) from submissions)::int s, (select count(*) from submission_courses)::int c, (select count(*) from answers)::int a');
    expect(after).toEqual(before);
  });

  test('저장 도중 오류가 나도 일부만 남지 않는다 (트랜잭션)', async () => {
    const f = await form(TOKENS.multi);
    const ids = f.courses!.slice(0, 2).map((c) => c.id);
    const payload = buildPayload(f, validDraft(f, ids));
    // 두 번째 수업 저장 단계에서 실패하도록 강제
    await t.db.exec(`create or replace function public.fail_second() returns trigger language plpgsql as $$
      begin if new.position = 1 then raise exception 'forced_failure'; end if; return new; end $$;
      create trigger fail_second before insert on public.submission_courses for each row execute function public.fail_second();`);
    const before = (await t.root<{ n: number }>('select count(*)::int n from submissions'))[0].n;
    await expectError(submit(TOKENS.multi, payload), 'forced_failure');
    const after = (await t.root<{ n: number }>('select count(*)::int n from submissions'))[0].n;
    await t.db.exec('drop trigger fail_second on public.submission_courses; drop function public.fail_second();');
    expect(after).toBe(before);
  });

  test('숨은 스팸 칸이 채워지면 거부', async () => {
    const f = await form(TOKENS.math);
    const d = validDraft(f);
    d.website = 'http://spam';
    await expectError(submit(TOKENS.math, buildPayload(f, d)), 'rejected');
  });

  test('접수 마감·비활성 링크로는 제출할 수 없다', async () => {
    const f = await form(TOKENS.math);
    const payload = buildPayload(f, validDraft(f));
    await expectError(submit(TOKENS.inactive, payload), 'invitation_closed');
    await expectError(submit('y'.repeat(40), payload), 'invitation_invalid');
  });

  test('같은 접속 주소에서 10분에 5건을 넘으면 제한', async () => {
    const f = await form(TOKENS.science);
    const headers = { 'x-forwarded-for': '203.0.113.9' };
    const call = () =>
      t.rpc(ANON, 'submit_consultation', { p_token: TOKENS.science, p_idempotency_key: key(), p_payload: buildPayload(f, validDraft(f)) }, { headers });
    for (let i = 0; i < 5; i++) await call();
    await expectError(call(), 'rate_limited');
    const stored = await t.root<{ bucket: string }>(`select bucket from submission_rate_events where bucket like 'ip:%' limit 1`);
    expect(stored[0].bucket).not.toContain('203.0.113.9');
  });
});

describe('학년별 질문', () => {
  test('해당 학년 질문만 보이고, 다른 학년 질문에 답하면 거부', async () => {
    const f = await form(TOKENS.math);
    const qs = f.courses![0].questions;
    expect(qs.find((q) => q.id === 'readiness_m1')?.grades).toEqual(['middle-1']);
    expect(qs.find((q) => q.id === 'topics_m3')?.grades).toEqual(['middle-3']);

    const d = validDraft(f);
    d.common.grade_key = 'middle-1';
    const id = f.courses![0].id;
    d.courses[id].answers.readiness_m1 = { status: 'answered', value: 'sometimes' };
    d.courses[id].answers.topics_m1 = { status: 'answered', value: ['t2', 'prior'] };
    expect(validateAll(f, d, f.today!)).toEqual([]);
    const ok = await submit(TOKENS.math, buildPayload(f, d));
    expect(ok.ok).toBe(true);

    // 중1 학생이 중2 질문에 답을 보내면 숨겨진 질문으로 거부
    const payload = buildPayload(f, d);
    (payload.courses[0].answers as Record<string, unknown>).readiness_m2 = { status: 'answered', value: 'alone' };
    const e = await expectError(submit(TOKENS.math, payload), 'validation_failed');
    expect(e.fieldErrors).toContainEqual({ path: 'courses.0.answers.readiness_m2', code: 'hidden_answer' });

    // 화면에서 학년을 바꾸면 이전 학년 답은 자동으로 빠진다
    d.common.grade_key = 'middle-3';
    const p3 = buildPayload(f, d);
    expect(Object.keys(p3.courses[0].answers)).not.toContain('readiness_m1');
    expect(Object.keys(p3.courses[0].answers)).not.toContain('topics_m1');
    expect((await submit(TOKENS.math, p3)).ok).toBe(true);
  });

  test('시험 ‘이미 끝남’ 상태와 다른 출판사 입력', async () => {
    const f = await form(TOKENS.science);
    const d = validDraft(f);
    const cd = d.courses[f.courses![0].id];
    cd.assessments[0].status = 'finished';
    cd.answers.textbook_publisher = { status: 'answered', value: 'other' };
    expect(validateAll(f, d, f.today!)).toContainEqual({ path: 'courses.0.answers.textbook_publisher_other', code: 'required' });
    cd.answers.textbook_publisher_other = { status: 'answered', value: '금성출판사' };
    const r = await submit(TOKENS.science, buildPayload(f, d));
    const rows = await t.root<{ status: string }>(
      `select sa.status from submission_assessments sa join submission_courses sc on sc.id = sa.submission_course_id
         join submissions s on s.id = sc.submission_id where s.receipt_code = $1 order by sa.position`,
      [r.receipt_code],
    );
    expect(rows.map((x) => x.status)).toEqual(['finished', 'undecided']);
  });

  test('주당 횟수는 수업에서 허용한 값(주 1·2회)만', async () => {
    const f = await form(TOKENS.math);
    expect(f.courses![0].session_choices).toEqual([1, 2]);
    const d = validDraft(f);
    d.courses[f.courses![0].id].schedule.sessions_per_week = 3;
    expect(validateAll(f, d, f.today!)).toContainEqual({ path: 'courses.0.schedule.sessions_per_week', code: 'invalid_option' });
    const e = await expectError(submit(TOKENS.math, buildPayload(f, d)), 'validation_failed');
    expect(e.fieldErrors).toContainEqual({ path: 'courses.0.schedule.sessions_per_week', code: 'invalid_option' });
    d.courses[f.courses![0].id].schedule.sessions_per_week = 2;
    expect((await submit(TOKENS.math, buildPayload(f, d))).ok).toBe(true);
  });
});

describe('모름·미정과 조건부 필수', () => {
  test('필수 질문을 비우면 오류, 모름을 고르면 통과', async () => {
    const f = await form(TOKENS.math);
    const d = validDraft(f);
    const id = f.courses![0].id;
    delete d.courses[id].answers.textbook_publisher;
    let e = await expectError(submit(TOKENS.math, buildPayload(f, d)), 'validation_failed');
    expect(e.fieldErrors).toContainEqual({ path: 'courses.0.answers.textbook_publisher', code: 'required' });
    expect(validateAll(f, d, f.today!)).toContainEqual({ path: 'courses.0.answers.textbook_publisher', code: 'required' });

    d.courses[id].answers.textbook_publisher = { status: 'unknown' };
    const r = await submit(TOKENS.math, buildPayload(f, d));
    expect(r.ok).toBe(true);

    // 모름을 허용하지 않는 질문(어려워하는 부분)에 모름을 보내면 거부
    d.courses[id].answers.difficulties = { status: 'unknown' };
    e = await expectError(submit(TOKENS.math, buildPayload(f, d)), 'validation_failed');
    expect(e.fieldErrors).toContainEqual({ path: 'courses.0.answers.difficulties', code: 'unknown_not_allowed' });
  });

  test('‘기타’를 고르면 기타 내용이 필수가 된다', async () => {
    const f = await form(TOKENS.math);
    const d = validDraft(f);
    const id = f.courses![0].id;
    d.courses[id].answers.difficulties = { status: 'answered', value: ['calc', 'other'] };
    const clientErrs = validateAll(f, d, f.today!);
    expect(clientErrs).toContainEqual({ path: 'courses.0.answers.difficulties_other', code: 'required' });
    const e = await expectError(submit(TOKENS.math, buildPayload(f, d)), 'validation_failed');
    expect(e.fieldErrors).toContainEqual({ path: 'courses.0.answers.difficulties_other', code: 'required' });
    d.courses[id].answers.difficulties_other = { status: 'answered', value: '분수 계산' };
    expect((await submit(TOKENS.math, buildPayload(f, d))).ok).toBe(true);
  });

  test('숨겨진 질문에 답을 직접 넣어 보내면 거부', async () => {
    const f = await form(TOKENS.math);
    const payload = buildPayload(f, validDraft(f));
    (payload.courses[0].answers as Record<string, unknown>).difficulties_other = { status: 'answered', value: 'x' };
    const e = await expectError(submit(TOKENS.math, payload), 'validation_failed');
    expect(e.fieldErrors).toContainEqual({ path: 'courses.0.answers.difficulties_other', code: 'hidden_answer' });
  });

  test('‘잘 모르겠음’은 다른 선택지와 함께 고를 수 없다', async () => {
    const f = await form(TOKENS.math);
    const d = validDraft(f);
    d.courses[f.courses![0].id].answers.difficulties = { status: 'answered', value: ['calc', 'not_sure'] };
    expect(validateAll(f, d, f.today!)).toContainEqual({ path: 'courses.0.answers.difficulties', code: 'exclusive_option' });
    const e = await expectError(submit(TOKENS.math, buildPayload(f, d)), 'validation_failed');
    expect(e.fieldErrors).toContainEqual({ path: 'courses.0.answers.difficulties', code: 'exclusive_option' });
  });

  test('미정과 구체적인 날짜·시간을 함께 보낼 수 없다', async () => {
    const f = await form(TOKENS.math);
    const d = validDraft(f);
    const s = d.courses[f.courses![0].id].schedule;
    s.start_undecided = true; // 날짜도 남아 있음
    s.time_undecided = true; // 시간도 남아 있음
    const client = validateAll(f, d, f.today!);
    expect(client).toContainEqual({ path: 'courses.0.schedule.start_date', code: 'conflict_undecided' });
    expect(client).toContainEqual({ path: 'courses.0.schedule.slots', code: 'conflict_undecided' });
    const payload = buildPayload(f, d);
    // 화면은 미정이면 값을 보내지 않지만, 조작된 요청도 서버가 막는지 확인
    Object.assign(payload.courses[0].schedule, { start_date: s.start_date, slots: s.slots });
    const e = await expectError(submit(TOKENS.math, payload), 'validation_failed');
    expect(e.fieldErrors.map((x) => x.code)).toEqual(expect.arrayContaining(['conflict_undecided']));
  });

  test('확정된 조건(토요일·120분)은 묻지 않고, 다른 요일은 거부', async () => {
    const f = await form(TOKENS.science);
    const c = f.courses![0];
    expect(c.fixed_conditions).toEqual(expect.arrayContaining(['weekdays', 'minutes']));
    expect(c.fixed_conditions).not.toContain('start_date');
    expect(c.fixed_conditions).not.toContain('start_time');
    const d = validDraft(f);
    d.courses[c.id].schedule.slots = [{ weekday: 2, start_time: '10:00' }];
    const e = await expectError(submit(TOKENS.science, buildPayload(f, d)), 'validation_failed');
    expect(e.fieldErrors).toContainEqual({ path: 'courses.0.schedule.slots', code: 'weekday_not_offered' });
    d.courses[c.id].schedule.slots = [{ weekday: 6, start_time: '14:00' }];
    const e2 = await expectError(submit(TOKENS.science, buildPayload(f, d)), 'validation_failed');
    expect(e2.fieldErrors).toContainEqual({ path: 'courses.0.schedule.slots', code: 'time_not_offered' });
    const payload = buildPayload(f, validDraft(f));
    (payload.courses[0].schedule as Record<string, unknown>).minutes = 90;
    const e3 = await expectError(submit(TOKENS.science, payload), 'validation_failed');
    expect(e3.fieldErrors).toContainEqual({ path: 'courses.0.schedule.minutes', code: 'not_allowed' });
  });

  test('전화번호 형식과 날짜 범위', async () => {
    const f = await form(TOKENS.math);
    const d = validDraft(f);
    d.common.parent_phone = '02-123-4567';
    d.courses[f.courses![0].id].schedule.start_date = '2020-01-01';
    const e = await expectError(submit(TOKENS.math, buildPayload(f, d)), 'validation_failed');
    expect(e.fieldErrors).toContainEqual({ path: 'common.parent_phone', code: 'invalid_phone' });
    expect(e.fieldErrors).toContainEqual({ path: 'courses.0.schedule.start_date', code: 'out_of_range' });
  });

  test('모름·미정 개수가 수업별로 저장된다', async () => {
    const f = await form(TOKENS.math);
    const d = validDraft(f);
    const cd = d.courses[f.courses![0].id];
    cd.answers.textbook_publisher = { status: 'unknown' };
    cd.answers.current_unit = { status: 'unknown' };
    cd.schedule.start_date = '';
    cd.schedule.start_undecided = true;
    cd.homework_band = 'tbd';
    cd.assessments[0].status = 'unknown';
    cd.assessments[1].status = 'not_applicable';
    const r = await submit(TOKENS.math, buildPayload(f, d));
    const rows = await t.root<{ unknown_count: number }>(
      `select sc.unknown_count from submission_courses sc join submissions s on s.id = sc.submission_id where s.receipt_code = $1`,
      [r.receipt_code],
    );
    // 출판사·단원(2) + 시작일 미정(1) + 숙제 상담 후 결정(1) + 중간고사 모름(1)
    expect(rows[0].unknown_count).toBe(5);
  });
});
