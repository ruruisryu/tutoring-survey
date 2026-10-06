import { beforeAll, describe, expect, test } from 'vitest';
import { ApiError } from '../../src/lib/backend/errors';
import { buildPayload } from '../../src/lib/survey';
import type { Catalog, PublicForm, SubmissionDetail } from '../../src/lib/types';
import { validDraft } from './fixtures';
import { ADMIN, ANON, MEMBER, createDb, TOKENS, type TestDb } from './harness';

let t: TestDb;

async function err(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
}

const upload = (who = ANON, name: string) =>
  t.sql(who, `insert into storage.objects (bucket_id, name) values ('exam-photos', $1)`, [name]);

beforeAll(async () => {
  t = await createDb();
}, 60_000);

describe('시험지 사진', () => {
  test('과목 양식이 새 버전으로 발행되어 목표는 복수 선택, 점수 아래에 사진 질문이 있다', async () => {
    const f = await t.rpc<PublicForm>(ANON, 'get_public_form', { p_token: TOKENS.math });
    const qs = f.courses![0].questions;
    expect(f.courses![0].version_no).toBe(2);
    const ids = qs.map((q) => q.id);
    expect(ids.indexOf('exam_photos')).toBe(ids.indexOf('recent_score') + 1);
    expect(qs.find((q) => q.id === 'exam_photos')?.type).toBe('photos');
    expect(qs.find((q) => q.id === 'goal')?.type).toBe('multi');
    const catalog = await t.rpc<Catalog>(ADMIN, 'admin_catalog');
    const tpl = catalog.templates.find((x) => x.name === '중학교 수학 기본 양식')!;
    expect(tpl.versions.map((v) => [v.version_no, v.status])).toEqual([
      [2, 'published'],
      [1, 'superseded'],
    ]);
  });

  test('익명은 정해진 경로에만 올릴 수 있고, 올린 파일을 볼 수 없다', async () => {
    const key = crypto.randomUUID();
    await upload(ANON, `pending/${key}/a.jpg`);
    const bad = await err(upload(ANON, `other/${key}/a.jpg`));
    expect(bad.code).toBe('permission_denied'); // RLS 위반(42501)
    expect(await t.sql(ANON, `select * from storage.objects where bucket_id = 'exam-photos'`)).toEqual([]);
    expect(await t.sql(MEMBER, `select * from storage.objects where bucket_id = 'exam-photos'`)).toEqual([]);
    const adminRows = await t.sql<{ name: string }>(ADMIN, `select name from storage.objects where bucket_id = 'exam-photos'`);
    expect(adminRows.map((r) => r.name)).toContain(`pending/${key}/a.jpg`);
    // 익명은 지울 수 없다
    await t.sql(ANON, `delete from storage.objects where name = $1`, [`pending/${key}/a.jpg`]);
    expect((await t.root(`select 1 from storage.objects where name = $1`, [`pending/${key}/a.jpg`])).length).toBe(1);
  });

  test('제출 시 사진 경로·제출 키·파일 존재를 확인하고 저장한다', async () => {
    const f = await t.rpc<PublicForm>(ANON, 'get_public_form', { p_token: TOKENS.math });
    const key = crypto.randomUUID();
    const d = validDraft(f);
    const cid = f.courses![0].id;
    const submit = (payload: unknown) =>
      t.rpc<{ receipt_code: string }>(ANON, 'submit_consultation', { p_token: TOKENS.math, p_idempotency_key: key, p_payload: payload });

    // 올리지 않은 파일
    d.courses[cid].answers.exam_photos = { status: 'answered', value: [`pending/${key}/missing.jpg`] };
    expect((await err(submit(buildPayload(f, d)))).code).toBe('photo_missing');

    // 다른 제출 키 경로의 파일
    const otherKey = crypto.randomUUID();
    await upload(ANON, `pending/${otherKey}/x.jpg`);
    d.courses[cid].answers.exam_photos = { status: 'answered', value: [`pending/${otherKey}/x.jpg`] };
    expect((await err(submit(buildPayload(f, d)))).code).toBe('photo_missing');

    // 형식이 틀린 경로·6장 이상
    d.courses[cid].answers.exam_photos = { status: 'answered', value: ['../../etc/passwd'] };
    expect((await err(submit(buildPayload(f, d)))).fieldErrors).toContainEqual({ path: 'courses.0.answers.exam_photos', code: 'invalid' });
    d.courses[cid].answers.exam_photos = { status: 'answered', value: [1, 2, 3, 4, 5, 6].map((n) => `pending/${key}/${n}.jpg`) };
    expect((await err(submit(buildPayload(f, d)))).fieldErrors).toContainEqual({ path: 'courses.0.answers.exam_photos', code: 'too_many' });

    // 정상
    await upload(ANON, `pending/${key}/p1.jpg`);
    await upload(ANON, `pending/${key}/p2.jpg`);
    d.courses[cid].answers.exam_photos = { status: 'answered', value: [`pending/${key}/p1.jpg`, `pending/${key}/p2.jpg`] };
    d.courses[cid].answers.goal = { status: 'answered', value: ['school_exam', 'habit'] };
    const r = await submit(buildPayload(f, d));
    const id = (await t.root<{ id: string }>('select id from submissions where receipt_code = $1', [r.receipt_code]))[0].id;
    const detail = await t.rpc<SubmissionDetail>(ADMIN, 'admin_get_submission', { p_id: id });
    expect(detail.courses[0].answers.exam_photos).toEqual({ status: 'answered', value: [`pending/${key}/p1.jpg`, `pending/${key}/p2.jpg`] });
    expect(detail.courses[0].answers.goal).toEqual({ status: 'answered', value: ['school_exam', 'habit'] });
  });
});
