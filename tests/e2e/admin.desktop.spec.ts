import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { DEV_PASSWORD, expectNoHorizontalOverflow, fillBasic, fillCourseRequired, loginAdmin, next, startSurvey, TOKENS } from './helpers';

/** 수학·과학 두 수업을 함께 신청하는 제출 하나를 만든다 */
async function submitMathAndScience(page: Page, student = '민준') {
  await startSurvey(page, TOKENS.multi);
  await fillBasic(page, { student });
  await next(page);
  await page.getByRole('checkbox', { name: /중등수학 정규 클래스/ }).check();
  await page.getByRole('checkbox', { name: /중등과학 정규 클래스 · 토요일 오전반/ }).check();
  const math = page.getByRole('region', { name: '중등수학 정규 클래스' });
  await math.getByRole('checkbox', { name: '아직 정하지 않았어요' }).check();
  await math.getByRole('button', { name: '+ 시간 추가' }).click();
  await math.getByLabel('요일').first().selectOption({ label: '수요일' });
  await math.getByLabel('시작 시각').first().selectOption('19:00');
  const sci = page.getByRole('region', { name: '중등과학 정규 클래스 · 토요일 오전반' });
  await sci.getByRole('checkbox', { name: '아직 정하지 않았어요' }).check();
  await sci.getByRole('checkbox', { name: '시간은 상담하면서 정하고 싶어요' }).check();
  await next(page);
  await fillCourseRequired(page);
  await page.getByRole('group', { name: /학교 교과서 출판사/ }).getByRole('radio', { name: '모름' }).check(); // 수학 교과서 출판사 모름
  await next(page);
  await fillCourseRequired(page);
  await next(page);
  await page.getByRole('checkbox', { name: /개인정보 수집·이용에 동의합니다/ }).check();
  await page.getByRole('button', { name: '상담 내용 보내기' }).click();
  await expect(page.getByRole('heading', { name: '접수되었습니다' })).toBeVisible();
}

test.describe('관리자', () => {
  test('로그인하지 않았거나 관리자가 아니면 데이터에 접근할 수 없다', async ({ page }) => {
    await page.goto('/#/admin/responses');
    await expect(page.getByRole('heading', { name: '관리자 로그인' })).toBeVisible({ timeout: 30_000 });
    await loginAdmin(page, 'member@dev.localhost');
    await expect(page.getByText('관리자 권한이 없는 계정입니다', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: '응답·상담' })).toHaveCount(0);
    // 틀린 비밀번호
    await page.getByRole('button', { name: '로그아웃' }).click().catch(() => undefined);
    await page.goto('/#/admin/login');
    await page.getByLabel('이메일').fill('admin@dev.localhost');
    await page.getByLabel('비밀번호').fill('wrong-password');
    await page.getByRole('button', { name: '로그인' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '이메일 또는 비밀번호가 맞지 않습니다.' })).toBeVisible();
  });

  test('수업별 상태·확정 일정, 검색·필터, 문자 초안, CSV, 삭제', async ({ page }) => {
    await submitMathAndScience(page);
    await loginAdmin(page);
    await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible();
    const stats = page.getByRole('region', { name: '요약' });
    await expect(stats.getByText('전체 제출').locator('..').getByText('1', { exact: true })).toBeVisible();
    await expect(stats.getByText('수업별 상담').locator('..').getByText('2', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole('link', { name: '응답·상담' }).click();
    await expect(page.getByRole('link', { name: '민준' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '010-****-5678' })).toBeVisible();
    // 필터: 과목·확인 필요·요일
    await page.getByLabel('과목').selectOption({ label: '통합과학' });
    await expect(page.getByText('조건에 맞는 상담이 없습니다.', { exact: false })).toBeVisible();
    await page.getByLabel('과목').selectOption({ label: '과학' });
    await expect(page.getByRole('link', { name: '민준' })).toBeVisible();
    await page.getByRole('button', { name: '필터 초기화' }).click();
    await page.getByLabel('희망 요일').selectOption({ label: '수요일' });
    await expect(page.getByRole('link', { name: '민준' })).toBeVisible();
    await page.getByLabel('희망 요일').selectOption({ label: '화요일' });
    await expect(page.getByText('조건에 맞는 상담이 없습니다.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '필터 초기화' }).click();
    await page.getByRole('searchbox', { name: '검색' }).fill('5678');
    await expect(page.getByRole('link', { name: '민준' })).toBeVisible();

    // CSV 두 형식
    const [summaryDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV · 제출 요약' }).click()]);
    const summary = readFileSync((await summaryDl.path())!, 'utf8');
    expect(summary.charCodeAt(0)).toBe(0xfeff);
    expect(summary.trim().split('\r\n')).toHaveLength(2);
    const [detailDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV · 수업별 상세' }).click()]);
    const detailCsv = readFileSync((await detailDl.path())!, 'utf8');
    expect(detailCsv.trim().split('\r\n')).toHaveLength(3); // 머리글 + 수업 2개
    expect(detailCsv).toContain('중등수학 정규 클래스');
    expect(detailCsv).toContain('중등과학 정규 클래스 · 토요일 오전반');

    await page.getByRole('link', { name: '민준' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /민준/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /수학/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('학교 교과서 출판사').first()).toBeVisible();

    // 수학: 일정 확정
    const mathPanel = page.getByRole('tabpanel', { name: /수학/ });
    await mathPanel.getByLabel('상담 상태').selectOption({ label: '일정 확정' });
    await mathPanel.getByLabel('지도 계획 메모').fill('일차함수 그래프부터 복습');
    await mathPanel.getByLabel('확정 시작일').fill('2026-10-21');
    await mathPanel.getByRole('button', { name: '+ 요일·시각 추가' }).click();
    await mathPanel.getByLabel('요일', { exact: true }).selectOption({ label: '수' });
    await mathPanel.getByLabel('시작 시각').fill('19:00');
    await mathPanel.getByRole('button', { name: '기록 저장' }).click();
    await expect(mathPanel.getByRole('status').filter({ hasText: '저장했습니다.' })).toBeVisible();

    // 과학: 추가 확인 필요 (독립 상태)
    await page.getByRole('tab', { name: /과학/ }).click();
    const sciPanel = page.getByRole('tabpanel', { name: /과학/ });
    await sciPanel.getByLabel('상담 상태').selectOption({ label: '추가 확인 필요' });
    await sciPanel.getByLabel('다음 연락 예정일').fill('2026-10-08');
    await sciPanel.getByRole('button', { name: '기록 저장' }).click();
    await expect(sciPanel.getByRole('status').filter({ hasText: '저장했습니다.' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /수학/ })).toContainText('일정 확정');
    await expect(page.getByRole('tab', { name: /과학/ })).toContainText('추가 확인 필요');

    // 문자 초안: 공통·과목별 구분, 희망/확정 일정 구분, 자동 발송 없음
    await page.getByRole('button', { name: '확인 문자 초안' }).click();
    const sms = page.getByRole('dialog', { name: '확인 문자 초안' });
    const text = await sms.getByLabel('문자 내용').inputValue();
    expect(text).toContain('[수학]');
    expect(text).toContain('학교 교과서 출판사');
    expect(text).toContain('[공통]');
    expect(text).toContain('첫 수업을 시작하고 싶은 날짜 (수학·과학)');
    expect(text).toContain('수학: 확정: 수 19:00~21:00, 10월 21일(수) 시작');
    expect(text).toContain('과학: 일정은 상담하면서 정하겠습니다.');
    expect(text).not.toContain('2단원'); // 이미 답한 내용은 반복하지 않는다
    await sms.getByRole('checkbox', { name: '수학' }).uncheck();
    await expect(sms.getByLabel('문자 내용')).not.toHaveValue(/\[수학\]/);
    await sms.getByRole('button', { name: '닫기' }).first().click();

    // 목록에서도 수업별 상태가 따로 보인다
    await page.getByRole('link', { name: '← 목록으로' }).click();
    await page.getByRole('search').getByLabel('상담 상태').selectOption({ label: '일정 확정' });
    await expect(page.getByRole('link', { name: '민준' })).toBeVisible();
    await page.getByRole('search').getByLabel('상담 상태').selectOption({ label: '보류' });
    await expect(page.getByText('조건에 맞는 상담이 없습니다.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '필터 초기화' }).click();

    // 대시보드: 다음 연락 예정
    await page.getByRole('link', { name: '대시보드' }).click();
    await expect(page.getByRole('region', { name: '다음 연락 예정' }).getByRole('link', { name: '민준' })).toBeVisible();

    // 삭제: 이름 확인 후 관련 기록 모두 삭제
    await page.getByRole('link', { name: '응답·상담' }).click();
    await page.getByRole('link', { name: '민준' }).click();
    await page.getByRole('button', { name: '응답 삭제' }).click();
    const del = page.getByRole('dialog', { name: /응답 삭제/ });
    await expect(del.getByRole('button', { name: '이 응답 영구 삭제' })).toBeDisabled();
    await del.getByLabel(/학생 이름/).fill('민준');
    await del.getByRole('button', { name: '이 응답 영구 삭제' }).click();
    await expect(page.getByText('접수된 상담이 없습니다.').first()).toBeVisible();
  });

  test('로그인 만료 시 작성 중인 메모를 지키고 다시 로그인 후 저장', async ({ page }) => {
    await submitMathAndScience(page, '서연');
    await loginAdmin(page);
    await page.getByRole('link', { name: '응답·상담' }).click();
    await page.getByRole('link', { name: '서연' }).click();
    const panel = page.getByRole('tabpanel', { name: /수학/ });
    await panel.getByLabel('상담 메모').fill('어머님과 통화: 화요일 저녁 선호');
    // 저장하지 않고 다른 메뉴로 이동하면 확인
    await page.getByRole('link', { name: '수업 관리' }).click();
    const guard = page.getByRole('dialog', { name: '저장하지 않은 내용이 있습니다' });
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: '계속 작성하기' }).click();

    await page.evaluate(() => window.__dev!.expireSession());
    await panel.getByRole('button', { name: '기록 저장' }).click();
    const reauth = page.getByRole('dialog', { name: '다시 로그인해주세요' });
    await expect(reauth).toBeVisible();
    await reauth.getByLabel('비밀번호').fill(DEV_PASSWORD);
    await reauth.getByRole('button', { name: '로그인' }).click();
    await expect(reauth).toBeHidden();
    // 다시 로그인한 뒤에도 작성 중이던 메모가 그대로 남아 있다
    await expect(panel.getByLabel('상담 메모')).toHaveValue('어머님과 통화: 화요일 저녁 선호');
    await panel.getByRole('button', { name: '기록 저장' }).click();
    await expect(panel.getByRole('status').filter({ hasText: '저장했습니다.' })).toBeVisible();
  });

  test('코드 수정 없이 영어 과목 추가 → 양식 발행 → 수업·링크 → 학부모 화면', async ({ page }) => {
    await loginAdmin(page);
    await page.getByRole('link', { name: '과목·설문 관리' }).click();
    await page.getByRole('button', { name: '+ 새 과목 추가' }).click();
    const dlg = page.getByRole('dialog', { name: '새 과목 추가' });
    await dlg.getByLabel('과목 이름').fill('영어');
    await dlg.getByLabel('지도 관점').fill('교과서 본문을 정확히 읽고, 문법을 문장 안에서 확인합니다.');
    await dlg.getByRole('button', { name: '과목 저장' }).click();
    await expect(page.getByText('영어 기본 양식')).toBeVisible();

    await page.getByText('영어 기본 양식').locator('..').locator('..').getByRole('link', { name: '질문 편집' }).click();
    await expect(page.getByRole('heading', { name: '영어 기본 양식 질문 편집' })).toBeVisible();
    await page.getByRole('button', { name: '+ 단일 선택' }).click();
    await page.getByLabel('질문 문구').fill('듣기 평가 준비가 필요한가요?');
    await page.getByLabel('표시 문구 1').fill('필요해요');
    // 모바일 미리보기에 바로 반영
    await expect(page.getByRole('complementary', { name: '모바일 미리보기' }).getByText('듣기 평가 준비가 필요한가요?')).toBeVisible();
    await page.getByRole('button', { name: '발행' }).click();
    await page.getByRole('dialog', { name: '발행' }).getByRole('button', { name: '발행' }).click();
    await expect(page.getByText('v1 발행됨')).toBeVisible();

    await page.getByRole('link', { name: '수업 관리' }).click();
    await page.getByRole('button', { name: '+ 새 수업 만들기' }).click();
    const cd = page.getByRole('dialog', { name: '새 수업 만들기' });
    await cd.getByLabel('수업 이름').fill('중1 영어 온라인반');
    await cd.getByLabel('과목', { exact: false }).first().selectOption({ label: '영어' });
    await cd.getByLabel('설문 양식').selectOption({ label: '영어 기본 양식 (v1)' });
    await cd.getByLabel('수업 방식').selectOption({ label: '화상' });
    await cd.getByLabel('회당 시간(분)').fill('60');
    await cd.getByRole('textbox', { name: /시작 시각/ }).fill('19:00');
    await expect(cd.getByText('종료 시각: 20:00')).toBeVisible();
    await cd.getByRole('button', { name: '수업 저장' }).click();
    await expect(page.getByRole('heading', { name: '중1 영어 온라인반' })).toBeVisible();

    await page.getByRole('button', { name: '+ 초대 링크 만들기' }).click();
    const inv = page.getByRole('dialog', { name: '초대 링크 만들기' });
    await inv.getByLabel('관리용 이름').fill('영어 상담');
    await inv.getByRole('radio', { name: /중1 영어 온라인반/ }).check();
    await inv.getByRole('button', { name: '링크 만들기' }).click();
    const url = await page.getByRole('listitem').filter({ hasText: '영어 상담' }).getByLabel('초대 링크 주소').inputValue();
    expect(url).toMatch(/#\/s\/[0-9a-f]{64}$/);
    expect(url).not.toMatch(/민준|010/);

    await page.goto(url);
    await expect(page.getByRole('heading', { name: '중1 영어 온라인반' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '학습 상담 작성하기' }).first().click();
    await fillBasic(page);
    await next(page);
    await page.getByRole('checkbox', { name: '아직 정하지 않았어요' }).check();
    await page.getByRole('checkbox', { name: '시간은 상담하면서 정하고 싶어요' }).check();
    await next(page);
    await expect(page.getByRole('heading', { level: 1, name: '영어 학습 정보' })).toBeVisible();
    await expect(page.getByText('듣기 평가 준비가 필요한가요?')).toBeVisible();
  });

  test('양식을 고쳐 발행해도 이전 응답은 당시 문구로 보인다', async ({ page }) => {
    await submitMathAndScience(page, '지우');
    await loginAdmin(page);
    await page.getByRole('link', { name: '과목·설문 관리' }).click();
    await page.getByText('중학교 수학 기본 양식').locator('..').locator('..').getByRole('link', { name: '질문 편집' }).click();
    await page.getByRole('button', { name: /^학교 교과서 출판사 단일 선택/ }).click();
    await page.getByLabel('질문 문구').fill('교과서 출판사 (바뀐 문구)');
    await page.getByRole('button', { name: '발행' }).click();
    await page.getByRole('dialog', { name: '발행' }).getByRole('button', { name: '발행' }).click();
    await expect(page.getByText('v3 발행됨')).toBeVisible();
    await page.getByRole('link', { name: '응답·상담' }).click();
    await page.getByRole('link', { name: '지우' }).click();
    await expect(page.getByText('작성 당시 양식 v2').first()).toBeVisible();
    await expect(page.getByText('학교 교과서 출판사').first()).toBeVisible();
    await expect(page.getByText('교과서 출판사 (바뀐 문구)')).toHaveCount(0);
  });

  test('운영 설정: 선생님 이름이 학부모 화면 머리말에 반영된다', async ({ page }) => {
    await loginAdmin(page);
    await page.getByRole('link', { name: '운영 설정' }).click();
    await page.getByLabel('선생님 이름').fill('한지민');
    await page.getByRole('button', { name: '설정 저장' }).click();
    await expect(page.getByRole('status').filter({ hasText: '저장했습니다.' })).toBeVisible();
    await page.goto(`/#/s/${TOKENS.math}`);
    await expect(page.getByText('한지민 선생님 | 학습 상담')).toBeVisible({ timeout: 30_000 });
  });

  test('비밀번호 재설정 흐름과 새로고침·직접 링크', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', (m) => logs.push(m.text()));
    await page.goto('/#/admin/reset');
    await page.getByLabel('이메일').fill('admin@dev.localhost');
    await page.getByRole('button', { name: '재설정 링크 받기' }).click();
    await expect(page.getByRole('status').filter({ hasText: '메일함을 확인해주세요' })).toBeVisible();
    const link = logs.find((l) => l.includes('token_hash='))!.split('주소: ')[1];
    await page.goto(link);
    await page.getByRole('button', { name: '재설정 링크 확인' }).click();
    await page.locator('#new-password').fill('new-dev-password-5678');
    await page.locator('#new-password-2').fill('new-dev-password-5678');
    await page.getByRole('button', { name: '비밀번호 변경' }).click();
    await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '로그아웃' }).click();
    await page.goto('/#/admin/responses');
    await page.getByLabel('이메일').fill('admin@dev.localhost');
    await page.getByLabel('비밀번호').fill('new-dev-password-5678');
    await page.getByRole('button', { name: '로그인' }).click();
    // 로그인 후 원래 가려던 화면으로 돌아온다
    await expect(page.getByRole('heading', { name: '응답·상담' })).toBeVisible();
  });

  test('관리자 화면 모바일 390px 가로 넘침 없음', async ({ page }) => {
    await submitMathAndScience(page, '하준');
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAdmin(page);
    for (const name of ['대시보드', '응답·상담', '수업 관리', '과목·설문 관리', '운영 설정']) {
      await page.getByRole('link', { name, exact: true }).click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    await page.getByRole('link', { name: '응답·상담', exact: true }).click();
    await page.getByRole('link', { name: '하준' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /하준/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
