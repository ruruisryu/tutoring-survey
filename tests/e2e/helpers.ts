import { expect, type Page } from '@playwright/test';

export const TOKENS = {
  math: 'devmathsingle00000000000000000000000000',
  science: 'devsciencesingle0000000000000000000000',
  integrated: 'devintegratedscience00000000000000000000',
  multi: 'devmultiplecourses000000000000000000000',
  closedCourse: 'devclosedcourse0000000000000000000000000',
  inactive: 'devinactivelink0000000000000000000000000',
};

// .env.localdb 의 개발 전용 비밀번호 (실제 계정 아님)
export const DEV_PASSWORD = 'dev-only-password-1234';

export async function openSurvey(page: Page, token: string) {
  await page.goto(`/#/s/${token}`);
  await expect(page.getByRole('button', { name: '학습 상담 작성하기' }).first()).toBeVisible({ timeout: 30_000 });
}

export async function startSurvey(page: Page, token: string) {
  await openSurvey(page, token);
  await page.getByRole('button', { name: '학습 상담 작성하기' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: '기본 정보' })).toBeFocused();
}

export async function fillBasic(page: Page, opts: { student?: string; parent?: string; phone?: string } = {}) {
  await page.getByLabel('학부모 성함').fill(opts.parent ?? '김보호');
  await page.getByLabel('연락 가능한 휴대전화 번호').fill(opts.phone ?? '010 1234 5678');
  await page.getByLabel('학생 이름').fill(opts.student ?? '민준');
  await page.getByLabel('학교급·학년').selectOption('middle-2');
}

export async function next(page: Page) {
  await page.getByRole('button', { name: /^(다음|검토 화면으로)$/ }).click();
}

/** 현재 보이는 과목 학습 정보 단계를 필수 항목만 채운다 */
export async function fillCourseRequired(page: Page) {
  await page.getByRole('group', { name: /학교 교과서 출판사/ }).getByRole('radio', { name: '비상교육' }).check();
  await page.getByLabel('지금 학교에서 배우는 단원이나 범위').fill('2단원');
  const difficulties = page.getByRole('group', { name: /어려워하는 부분/ });
  await difficulties.getByRole('checkbox').first().check();
  await page.getByRole('group', { name: /중요하게 생각하는 목표/ }).getByRole('checkbox').first().check();
  for (const group of await page.getByRole('group', { name: /^입력 방식/ }).all()) {
    await group.getByRole('radio', { name: '미정' }).check();
  }
  await page.getByRole('group', { name: /숙제에 쓸 수 있는 시간/ }).getByRole('radio', { name: '주 30~60분' }).check();
}

export async function loginAdmin(page: Page, email = 'admin@dev.localhost') {
  await page.goto('/#/admin/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: '로그인' }).click();
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, '가로 스크롤이 생기면 안 됩니다').toBeLessThanOrEqual(0);
}
