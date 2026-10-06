import { expect, test } from '@playwright/test';

const BASE = '/tutoring-survey/';

test('하위 경로에서 자산을 불러오고, 직접 링크·새로고침이 동작한다', async ({ page }) => {
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.url().startsWith('http://127.0.0.1:5292') && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(`${BASE}`);
  await expect(page.getByRole('heading', { name: '수업 준비실' })).toBeVisible();
  // 관리자 화면(나중에 불러오는 코드 조각)도 하위 경로에서 열린다
  await page.goto(`${BASE}#/admin/responses`);
  await expect(page.getByRole('heading', { name: '관리자 로그인' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '관리자 로그인' })).toBeVisible();

  // 서버에 연결할 수 없을 때: 학부모 링크는 재시도 안내
  await page.goto(`${BASE}#/s/abcdefabcdefabcdefabcdefabcdefabcdef`);
  await expect(page.getByRole('heading', { name: '상담 양식을 불러오지 못했습니다' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '상담 양식을 불러오지 못했습니다' })).toBeVisible({ timeout: 30_000 });

  // 관리자 로그인 실패 시 네트워크 안내
  await page.goto(`${BASE}#/admin/login`);
  await page.getByLabel('이메일').fill('teacher@example.com');
  await page.getByLabel('비밀번호').fill('not-a-real-password');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('alert')).toContainText(/인터넷 연결|비밀번호가 맞지 않습니다/);

  // 해시 없이 하위 경로를 직접 열어도 404.html 이 앱을 보여준다
  const res = await page.goto(`${BASE}admin`);
  expect(res?.status()).toBeLessThan(500);

  expect(failed.filter((f) => !f.includes('127.0.0.1:9'))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('운영 빌드에는 개발용 DB·계정이 들어 있지 않다', async ({ request }) => {
  const html = await (await request.get(`${BASE}`)).text();
  const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) {
    expect(s.startsWith(BASE)).toBe(true);
    const js = await (await request.get(s)).text();
    expect(js).not.toContain('dev-only-password');
    expect(js).not.toContain('@dev.localhost');
    expect(js.toLowerCase()).not.toContain('pglite');
  }
});
