import { beforeAll, describe, expect, test } from 'vitest';
import { ApiError } from '../../src/lib/backend/errors';
import { buildPayload } from '../../src/lib/survey';
import type { Catalog, ListSubmission, PublicForm, Question, SubmissionDetail } from '../../src/lib/types';
import { validDraft } from './fixtures';
import { ADMIN, ANON, MEMBER, createDb, TOKENS, type TestDb } from './harness';

let t: TestDb;

async function err(p: Promise<unknown>): Promise<ApiError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}

async function submitValid(token: string, mutate?: (d: ReturnType<typeof validDraft>, f: PublicForm) => void, selected?: (f: PublicForm) => string[]) {
  const f = await t.rpc<PublicForm>(ANON, 'get_public_form', { p_token: token });
  const d = validDraft(f, selected?.(f));
  mutate?.(d, f);
  const r = await t.rpc<{ receipt_code: string }>(ANON, 'submit_consultation', {
    p_token: token,
    p_idempotency_key: crypto.randomUUID(),
    p_payload: buildPayload(f, d),
  });
  const id = (await t.root<{ id: string }>('select id from submissions where receipt_code = $1', [r.receipt_code]))[0].id;
  return { id, form: f };
}

beforeAll(async () => {
  t = await createDb();
}, 60_000);

describe('접근 제어', () => {
  const tables = ['submissions', 'submission_courses', 'answers', 'consultation_records', 'invitations', 'admin_memberships', 'app_settings'];

  test.each(tables)('익명 사용자는 %s 테이블을 읽을 수 없다', async (table) => {
    const e = await err(t.sql(ANON, `select * from public.${table}`));
    expect(e.code).toBe('permission_denied');
  });

  test('관리자가 아닌 로그인 사용자는 행이 보이지 않고, 쓸 수 없다', async () => {
    await submitValid(TOKENS.math);
    expect(await t.sql(MEMBER, 'select * from public.submissions')).toEqual([]);
    expect(await t.sql(MEMBER, 'select * from public.answers')).toEqual([]);
    await err(t.sql(MEMBER, `update public.app_settings set teacher_name = 'x'`)).catch(() => undefined);
    const rows = await t.root<{ teacher_name: string }>('select teacher_name from app_settings');
    expect(rows[0].teacher_name).toBe('');
  });

  test('관리자가 아닌 사용자는 스스로 관리자 권한을 줄 수 없다', async () => {
    const e = await err(
      t.sql(MEMBER, `insert into public.admin_memberships (user_id) values ('${(MEMBER as { userId: string }).userId}')`),
    );
    expect(['permission_denied', 'new row violates row-level security policy for table "admin_memberships"']).toContain(e.code);
    expect(await t.rpc<boolean>(MEMBER, 'am_i_admin')).toBe(false);
    expect(await t.rpc<boolean>(ADMIN, 'am_i_admin')).toBe(true);
  });

  test.each([
    ['admin_list_submissions', {}],
    ['admin_catalog', {}],
    ['admin_get_settings', {}],
    ['admin_update_settings', { p: { teacher_name: 'x' } }],
  ])('관리자 함수 %s: 익명은 실행 권한 없음, 일반 사용자는 forbidden', async (fn, args) => {
    const anon = await err(t.rpc(ANON, fn, args));
    expect(anon.code).toBe('permission_denied');
    const member = await err(t.rpc(MEMBER, fn, args));
    expect(member.code).toBe('forbidden');
  });

  test('익명은 내부 보조 함수를 직접 호출할 수 없다', async () => {
    const e = await err(
      t.rpc(ANON, 'store_answers', {
        p_submission_id: crypto.randomUUID(),
        p_submission_course_id: null,
        p_version_id: crypto.randomUUID(),
        p_questions: [],
        p_answers: {},
      }),
    );
    expect(e.code).toBe('permission_denied');
  });

  test('초대 링크(공개 함수)로는 기존 응답을 조회할 수 없다', async () => {
    const f = await t.rpc<PublicForm>(ANON, 'get_public_form', { p_token: TOKENS.math });
    const text = JSON.stringify(f);
    expect(text).not.toContain('김보호');
    expect(text).not.toContain('01012345678');
  });
});

describe('상담 관리', () => {
  test('수학 확정, 과학 조율 중처럼 수업별 상태를 따로 관리한다', async () => {
    const { id } = await submitValid(TOKENS.multi, undefined, (f) => f.courses!.slice(0, 2).map((c) => c.id));
    const detail = await t.rpc<SubmissionDetail>(ADMIN, 'admin_get_submission', { p_id: id });
    const [math, sci] = detail.courses;
    const updated = await t.rpc<{ status: string; updated_at: string; slots: unknown[] }>(ADMIN, 'admin_update_consultation', {
      p_submission_course_id: math.id,
      p_expected_updated_at: math.consultation.updated_at,
      p: {
        status: 'scheduled',
        plan_memo: '일차함수 그래프부터 복습',
        confirmed_start_date: '2026-10-17',
        confirmed_minutes: 90,
        slots: [{ weekday: 3, start_time: '19:00' }],
      },
    });
    expect(updated.status).toBe('scheduled');
    await t.rpc(ADMIN, 'admin_update_consultation', {
      p_submission_course_id: sci.id,
      p_expected_updated_at: sci.consultation.updated_at,
      p: { status: 'needs_info', next_contact_date: '2026-10-08' },
    });
    const after = await t.rpc<SubmissionDetail>(ADMIN, 'admin_get_submission', { p_id: id });
    expect(after.courses[0].consultation.status).toBe('scheduled');
    expect(after.courses[0].consultation.slots).toEqual([{ weekday: 3, start_time: '19:00' }]);
    expect(after.courses[1].consultation.status).toBe('needs_info');
    // 학부모 희망 일정은 그대로 보존된다
    expect(after.courses[0].schedule).toEqual(detail.courses[0].schedule);

    // 오래된 updated_at 으로 저장하면 충돌
    const e = await err(
      t.rpc(ADMIN, 'admin_update_consultation', {
        p_submission_course_id: math.id,
        p_expected_updated_at: math.consultation.updated_at,
        p: { consult_memo: '덮어쓰기 시도' },
      }),
    );
    expect(e.code).toBe('conflict');
  });

  test('학부모 원본 응답은 관리자도 수정할 수 없다', async () => {
    const { id } = await submitValid(TOKENS.math);
    const e = await err(t.sql(ADMIN, `update public.submissions set parent_name = '변경' where id = $1`, [id]));
    expect(e.code).toBe('original_is_read_only');
  });

  test('응답 삭제는 학생 이름 확인 후 관련 기록까지 함께 지운다', async () => {
    const { id } = await submitValid(TOKENS.multi, undefined, (f) => f.courses!.slice(0, 2).map((c) => c.id));
    const wrong = await err(t.rpc(ADMIN, 'admin_delete_submission', { p_id: id, p_confirm_student_name: '다른이름' }));
    expect(wrong.code).toBe('confirm_mismatch');
    await t.rpc(ADMIN, 'admin_delete_submission', { p_id: id, p_confirm_student_name: '민준' });
    const left = await t.root<{ n: number }>(
      `select (select count(*) from submission_courses where submission_id = $1)
            + (select count(*) from answers where submission_id = $1)
            + (select count(*) from consultation_records cr where not exists (select 1 from submission_courses sc where sc.id = cr.submission_course_id)) as n`,
      [id],
    );
    expect(Number(left[0].n)).toBe(0);
    const log = await t.root<{ course_count: number }>('select course_count from deletion_log order by id desc limit 1');
    expect(log[0].course_count).toBe(2);
    const logText = JSON.stringify(await t.root('select * from deletion_log'));
    expect(logText).not.toContain('민준');
  });

  test('목록은 제출 단위로, 수업별 상태를 함께 돌려준다', async () => {
    const list = await t.rpc<ListSubmission[]>(ADMIN, 'admin_list_submissions');
    expect(list.length).toBeGreaterThan(0);
    const multi = list.find((s) => s.courses.length === 2)!;
    expect(multi.courses.map((c) => c.subject_name)).toEqual(['수학', '과학']);
  });
});

describe('과목·양식 확장과 버전', () => {
  test('코드 수정 없이 영어 과목을 추가하고 양식을 발행해 접수까지 받는다', async () => {
    const subject = await t.rpc<{ id: string; default_template_id: string }>(ADMIN, 'admin_save_subject', {
      p: { name: '영어', description: '중학교 영어', perspective: '교과서 본문을 정확히 읽고 문법을 문장 속에서 확인합니다.', template_source: 'standard' },
    });
    expect(subject.default_template_id).toBeTruthy();
    let catalog = await t.rpc<Catalog>(ADMIN, 'admin_catalog');
    const tpl = catalog.templates.find((x) => x.id === subject.default_template_id)!;
    expect(tpl.published).toBeNull();
    expect(tpl.draft!.questions.length).toBeGreaterThan(5);

    // 영어용 선택지로 바꾸고 질문 하나 추가
    const qs: Question[] = tpl.draft!.questions.map((q) =>
      q.id === 'difficulties'
        ? { ...q, options: [{ value: 'vocab', label: '어휘' }, { value: 'grammar', label: '문법' }, { value: 'reading', label: '독해' }, { value: 'other', label: '기타' }, { value: 'not_sure', label: '잘 모르겠음', exclusive: true }] }
        : q,
    );
    qs.push({ id: 'listening', type: 'single', label: '듣기 평가 준비가 필요한가요?', required: false, active: true, options: [{ value: 'yes', label: '필요해요' }, { value: 'no', label: '괜찮아요' }] });
    await t.rpc(ADMIN, 'admin_save_draft', { p_template_id: tpl.id, p_questions: qs });
    const pub = await t.rpc<{ version_no: number }>(ADMIN, 'admin_publish_draft', { p_template_id: tpl.id });
    expect(pub.version_no).toBe(1);

    const course = await t.rpc<{ id: string }>(ADMIN, 'admin_save_course', {
      p: {
        name: '중1 영어', subject_id: subject.id, template_id: tpl.id, school_level: 'middle', grades: [1],
        mode: 'online', group_type: 'individual', minutes_per_session: 60, sessions_per_week: 2,
        weekdays: [2, 4], time_bands: ['evening'], fixed_conditions: ['minutes', 'sessions'], status: 'open',
      },
    });
    const inv = await t.rpc<{ token: string }>(ADMIN, 'admin_create_invitation', { p: { course_ids: [course.id], label: '영어' } });
    expect(inv.token).toMatch(/^[0-9a-f]{64}$/);

    const f = await t.rpc<PublicForm>(ANON, 'get_public_form', { p_token: inv.token });
    expect(f.status).toBe('open');
    expect(f.courses![0].subject_name).toBe('영어');
    expect(f.courses![0].questions.some((q) => q.id === 'listening')).toBe(true);
    const d = validDraft(f);
    const r = await t.rpc<{ ok: boolean }>(ANON, 'submit_consultation', {
      p_token: inv.token, p_idempotency_key: crypto.randomUUID(), p_payload: buildPayload(f, d),
    });
    expect(r.ok).toBe(true);
    catalog = await t.rpc<Catalog>(ADMIN, 'admin_catalog');
    expect(catalog.subjects.find((s) => s.name === '영어')!.response_count).toBe(1);
  });

  test('양식을 고쳐 발행해도 이전 응답은 당시 질문·선택지로 보존된다', async () => {
    const { id } = await submitValid(TOKENS.integrated);
    const before = await t.rpc<SubmissionDetail>(ADMIN, 'admin_get_submission', { p_id: id });
    const catalog = await t.rpc<Catalog>(ADMIN, 'admin_catalog');
    const tpl = catalog.templates.find((x) => x.name === '고등학교 통합과학 기본 양식')!;
    const qs = tpl.published!.questions.map((q) =>
      q.id === 'difficulties' ? { ...q, label: '바뀐 질문 문구', options: q.options!.map((o) => (o.value === 'terms' ? { ...o, label: '바뀐 선택지' } : o)) } : q,
    );
    await t.rpc(ADMIN, 'admin_save_draft', { p_template_id: tpl.id, p_questions: qs });
    await t.rpc(ADMIN, 'admin_publish_draft', { p_template_id: tpl.id });

    const after = await t.rpc<SubmissionDetail>(ADMIN, 'admin_get_submission', { p_id: id });
    const q = after.courses[0].questions.find((x) => x.id === 'difficulties')!;
    expect(q.label).toBe('어려워하는 부분');
    expect(q.options!.find((o) => o.value === 'terms')!.label).toBe('용어·개념 이해');
    expect(after.courses[0].version_no).toBe(before.courses[0].version_no);
    expect(after.courses[0].course.name).toBe('통합과학 정규 클래스');

    // 발행된 버전의 질문은 직접 바꿀 수 없다
    const e = await err(t.sql(ADMIN, `update public.form_versions set questions = '[]' where id = $1`, [before.courses[0].version_id]));
    expect(e.code).toBe('published_version_is_immutable');
  });

  test('작성 도중 새 버전이 발행되어도 이전 버전 답변으로 제출할 수 있다 (유예 기간)', async () => {
    const f = await t.rpc<PublicForm>(ANON, 'get_public_form', { p_token: TOKENS.science });
    const d = validDraft(f);
    const oldVersion = f.courses![0].version_id;
    const catalog = await t.rpc<Catalog>(ADMIN, 'admin_catalog');
    const tpl = catalog.templates.find((x) => x.name === '중학교 과학 기본 양식')!;
    await t.rpc(ADMIN, 'admin_save_draft', {
      p_template_id: tpl.id,
      p_questions: tpl.published!.questions.map((q) => (q.id === 'goal' ? { ...q, label: '새 버전 문구' } : q)),
    });
    await t.rpc(ADMIN, 'admin_publish_draft', { p_template_id: tpl.id });
    const r = await t.rpc<{ receipt_code: string }>(ANON, 'submit_consultation', {
      p_token: TOKENS.science, p_idempotency_key: crypto.randomUUID(), p_payload: buildPayload(f, d),
    });
    const stored = await t.root<{ form_version_id: string }>(
      'select sc.form_version_id from submission_courses sc join submissions s on s.id = sc.submission_id where s.receipt_code = $1',
      [r.receipt_code],
    );
    expect(stored[0].form_version_id).toBe(oldVersion);

    // 유예 기간이 지난 이전 버전은 거부
    await t.root(`update form_versions set superseded_at = now() - interval '8 days' where id = $1`, [oldVersion]);
    const e = await err(
      t.rpc(ANON, 'submit_consultation', { p_token: TOKENS.science, p_idempotency_key: crypto.randomUUID(), p_payload: buildPayload(f, d) }),
    );
    expect(e.code).toBe('form_outdated');
  });

  test('기본 질문(locked)은 초안에서 지울 수 없다', async () => {
    const catalog = await t.rpc<Catalog>(ADMIN, 'admin_catalog');
    const tpl = catalog.templates.find((x) => x.name === '중학교 수학 기본 양식')!;
    const e = await err(
      t.rpc(ADMIN, 'admin_save_draft', { p_template_id: tpl.id, p_questions: tpl.published!.questions.filter((q) => q.id !== 'goal') }),
    );
    expect(e.code).toBe('invalid_questions');
    expect(e.detail).toBe('goal:locked_question_removed');
  });

  test('잘못된 질문 정의는 저장되지 않는다', async () => {
    const catalog = await t.rpc<Catalog>(ADMIN, 'admin_catalog');
    const tpl = catalog.templates.find((x) => x.name === '중학교 수학 기본 양식')!;
    const bad = [...tpl.published!.questions, { id: 'Bad Id', type: 'short_text', label: 'x', required: false, active: true }];
    const e = await err(t.rpc(ADMIN, 'admin_save_draft', { p_template_id: tpl.id, p_questions: bad }));
    expect(e.code).toBe('invalid_questions');
    const script = [...tpl.published!.questions, { id: 'evil', type: 'short_text', label: 'x', required: false, active: true, show_if: { question: 'goal', any_of: ['nope'] } }];
    const e2 = await err(t.rpc(ADMIN, 'admin_save_draft', { p_template_id: tpl.id, p_questions: script }));
    expect(e2.detail).toBe('evil:show_if_option');
  });

  test('응답과 연결된 수업·과목은 삭제할 수 없고 보관만 된다', async () => {
    const catalog = await t.rpc<Catalog>(ADMIN, 'admin_catalog');
    const math = catalog.subjects.find((s) => s.name === '수학')!;
    expect((await err(t.rpc(ADMIN, 'admin_delete_subject', { p_id: math.id }))).code).toBe('in_use');
    const course = catalog.courses.find((c) => c.name === '중등수학 정규 클래스')!;
    expect((await err(t.rpc(ADMIN, 'admin_delete_course', { p_id: course.id }))).code).toBe('in_use');
    await t.rpc(ADMIN, 'admin_archive_subject', { p_id: math.id, p_archived: true });
    const f = await t.rpc<PublicForm>(ANON, 'get_public_form', { p_token: TOKENS.math });
    expect(f.status).toBe('closed');
    await t.rpc(ADMIN, 'admin_archive_subject', { p_id: math.id, p_archived: false });
    await t.rpc(ADMIN, 'admin_save_subject', { p: { id: math.id, name: '수학', is_active: true } });
    expect((await t.rpc<PublicForm>(ANON, 'get_public_form', { p_token: TOKENS.math })).status).toBe('open');
  });

  test('개인정보 안내를 확정하지 않으면 접수가 열리지 않는다', async () => {
    await t.rpc(ADMIN, 'admin_update_settings', { p: { privacy_confirmed: false } });
    expect((await t.rpc<PublicForm>(ANON, 'get_public_form', { p_token: TOKENS.math })).status).toBe('not_ready');
    await t.rpc(ADMIN, 'admin_update_settings', { p: { operator_contact: '' } });
    const e = await err(t.rpc(ADMIN, 'admin_update_settings', { p: { privacy_confirmed: true } }));
    expect(e.code).toBe('privacy_incomplete');
    await t.rpc(ADMIN, 'admin_update_settings', { p: { operator_contact: '010-0000-0000', privacy_confirmed: true } });
    expect((await t.rpc<PublicForm>(ANON, 'get_public_form', { p_token: TOKENS.math })).status).toBe('open');
  });

  test('운영 마이그레이션만 적용한 DB에는 응답·수업·운영자 정보가 없다', async () => {
    const clean = await createDb(false);
    const counts = await clean.root<{ s: number; c: number; i: number; confirmed: boolean; op: string }>(
      `select (select count(*) from submissions)::int s, (select count(*) from courses)::int c,
              (select count(*) from invitations)::int i, privacy_confirmed confirmed, operator_name op from app_settings`,
    );
    expect(counts[0]).toEqual({ s: 0, c: 0, i: 0, confirmed: false, op: '' });
    const subjects = await clean.root<{ name: string }>('select name from subjects order by sort_order');
    expect(subjects.map((s) => s.name)).toEqual(['수학', '과학', '통합과학']);
  });
});
