import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, fillBasic, fillCourseRequired, loginAdmin, next, openSurvey, startSurvey, TOKENS } from './helpers';

test.describe('학부모 설문', () => {
  test('수학 단독 제출: 단계 이동, 포커스, 검토, 완료', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    await startSurvey(page, TOKENS.math);
    await expect(page.getByText('3단계 중 1단계').or(page.getByText('4단계 중 1단계'))).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await fillBasic(page);
    await next(page);

    await expect(page.getByRole('heading', { level: 1, name: '수업 일정' })).toBeFocused();
    await expect(page.getByText('희망 조건입니다', { exact: false })).toBeVisible();
    // 미정과 날짜는 함께 고를 수 없다
    await page.getByLabel('첫 수업 희망 날짜').fill('2099-01-01');
    await page.getByRole('checkbox', { name: '아직 정하지 않았어요' }).check();
    await expect(page.getByLabel('첫 수업 희망 날짜')).toBeDisabled();
    await expect(page.getByLabel('첫 수업 희망 날짜')).toHaveValue('');
    await page.getByRole('button', { name: '+ 시간 추가' }).click();
    await page.getByLabel('요일').first().selectOption({ label: '수요일' });
    await page.getByLabel('시작 시각').first().selectOption('19:00');
    await expect(page.getByText('21:00 종료')).toBeVisible(); // 회당 120분 → 종료 시각 계산
    await expectNoHorizontalOverflow(page);
    await next(page);

    await expect(page.getByRole('heading', { level: 1, name: '수학 학습 정보' })).toBeFocused();
    await expect(page.getByText('계산 결과와 함께 풀이 과정을 살펴봅니다.', { exact: false })).toBeVisible();
    await expect(page.getByText('점수와 함께 학교에서 배운 범위와 풀이 과정도 살펴봅니다.', { exact: false })).toBeVisible();
    // 학년별 질문: 중2 학생에게는 중2 질문만
    await expect(page.getByRole('group', { name: /중1 일차방정식은 어느 정도 푸나요/ })).toBeVisible();
    await expect(page.getByText('초등학교 분수·소수 계산은 어느 정도 하나요?')).toHaveCount(0);
    await expect(page.getByRole('group', { name: /특히 어려웠던 단원/ }).getByRole('checkbox', { name: '일차함수' })).toBeVisible();
    await fillCourseRequired(page);
    await expectNoHorizontalOverflow(page);
    await next(page);

    await expect(page.getByRole('heading', { level: 1, name: '검토·동의' })).toBeFocused();
    await expect(page.getByText('010-1234-5678')).toBeVisible();
    await expect(page.getByText('수 19:00~21:00')).toBeVisible();
    // 동의하지 않으면 보낼 수 없다
    await expect(page.getByRole('checkbox', { name: /개인정보 수집·이용에 동의합니다/ })).not.toBeChecked();
    await page.getByRole('button', { name: '상담 내용 보내기' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '확인이 필요한 항목이 1개' })).toBeFocused();
    await page.getByRole('checkbox', { name: /개인정보 수집·이용에 동의합니다/ }).check();

    // 검토 화면의 수정 → 해당 단계 → 검토 화면으로 복귀
    await page.getByRole('button', { name: '기본 정보 수정' }).click();
    await expect(page.getByLabel('학생 이름')).toHaveValue('민준');
    await page.getByLabel('학교 이름').fill('한빛중학교');
    await page.getByRole('button', { name: '검토 화면으로' }).click();
    await expect(page.getByText('한빛중학교')).toBeVisible();

    await page.getByRole('button', { name: '상담 내용 보내기' }).click();
    await expect(page.getByRole('heading', { name: '접수되었습니다' })).toBeVisible();
    await expect(page.getByText('상담 내용이 접수되었습니다.', { exact: false })).toBeVisible();
    await expect(page.locator('p.font-mono')).toHaveText(/^[0-9A-F]{8}$/);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('필수 항목 오류: 요약에서 첫 오류로 이동, 입력란 옆 안내, 키보드 조작', async ({ page }) => {
    await startSurvey(page, TOKENS.math);
    await page.getByRole('button', { name: '다음' }).click();
    const summary = page.getByRole('alert').filter({ hasText: '확인이 필요한 항목이 4개' });
    await expect(summary).toBeFocused();
    await expect(page.getByText('학부모 성함을 입력해주세요.').first()).toBeVisible();
    // 요약의 링크를 키보드로 열면 해당 입력란으로 포커스
    await page.keyboard.press('Tab');
    await expect(summary.getByRole('link').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('학부모 성함')).toBeFocused();
    await expect(page.getByLabel('학부모 성함')).toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.type('김보호');

    await page.getByLabel('연락 가능한 휴대전화 번호').fill('02-123-4567');
    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.getByText('휴대전화 번호를 확인해주세요.', { exact: false }).first()).toBeVisible();
  });

  test('모름·미정과 조건부 필수 (기타 → 내용 필수, 잘 모르겠음 단독 선택)', async ({ page }) => {
    await startSurvey(page, TOKENS.math);
    await fillBasic(page);
    await next(page);
    await page.getByRole('checkbox', { name: '아직 정하지 않았어요' }).check();
    await page.getByRole('checkbox', { name: '시간은 상담하면서 정하고 싶어요' }).check();
    await expect(page.getByRole('button', { name: '+ 시간 추가' })).toHaveCount(0);
    await next(page);

    await page.getByRole('group', { name: /학교 교과서 출판사/ }).getByRole('radio', { name: '모름' }).check();
    const diff = page.getByRole('group', { name: /어려워하는 부분/ });
    await diff.getByRole('checkbox', { name: '계산·연산' }).check();
    await diff.getByRole('checkbox', { name: '잘 모르겠음' }).check();
    await expect(diff.getByRole('checkbox', { name: '계산·연산' })).not.toBeChecked();
    await diff.getByRole('checkbox', { name: '기타' }).check();
    await expect(diff.getByRole('checkbox', { name: '잘 모르겠음' })).not.toBeChecked();
    await expect(page.getByLabel('‘기타’에 해당하는 내용')).toBeVisible();

    await page.getByRole('checkbox', { name: '모름' }).first().check(); // 단원 모름
    await expect(page.getByLabel('지금 학교에서 배우는 단원이나 범위')).toBeDisabled();
    await page.getByRole('group', { name: /가장 중요하게 생각하는 목표/ }).getByRole('radio', { name: '상담하면서 정하고 싶어요' }).check();
    for (const g of await page.getByRole('group', { name: /^입력 방식/ }).all()) await g.getByRole('radio', { name: '모름' }).check();
    await page.getByRole('group', { name: /숙제에 쓸 수 있는 시간/ }).getByRole('radio', { name: '상담 후 결정' }).check();
    await next(page);
    await expect(page.getByText('‘기타’에 해당하는 내용: 이 항목에 답해주세요.')).toBeVisible();
    await page.getByLabel('‘기타’에 해당하는 내용').fill('분수 계산');
    await next(page);
    await page.getByRole('checkbox', { name: /개인정보 수집·이용에 동의합니다/ }).check();
    await page.getByRole('button', { name: '상담 내용 보내기' }).click();
    await expect(page.getByRole('heading', { name: '접수되었습니다' })).toBeVisible();
  });

  test('제출 실패 시 입력 유지·재시도, 중복 클릭 방지', async ({ page }) => {
    await startSurvey(page, TOKENS.science);
    await fillBasic(page);
    await next(page);
    // 토요일 오전, 120분 확정 수업: 요일은 토요일만, 시각은 오전만
    await page.getByRole('button', { name: '+ 시간 추가' }).click();
    const daySelect = page.getByRole('combobox', { name: '요일' }).first();
    await expect(daySelect).toHaveValue('6');
    await expect(daySelect.locator('option')).toHaveCount(2);
    const times = await page.getByLabel('시작 시각').first().locator('option').allTextContents();
    expect(times.filter((t) => /^\d/.test(t)).every((t) => t < '12:00')).toBe(true);
    await page.getByLabel('시작 시각').first().selectOption('10:00');
    await expect(page.getByText('12:00 종료')).toBeVisible();
    await page.getByRole('checkbox', { name: '아직 정하지 않았어요' }).check();
    await next(page);
    await fillCourseRequired(page);
    await next(page);
    await page.getByRole('checkbox', { name: /개인정보 수집·이용에 동의합니다/ }).check();

    // 첫 시도는 네트워크 오류
    await page.evaluate(() => {
      window.__dev!.failNext = 1;
    });
    await page.getByRole('button', { name: '상담 내용 보내기' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '작성하신 내용은 그대로 남아 있습니다' })).toBeVisible();
    await expect(page.getByText('민준')).toBeVisible();

    // 느린 응답 중 여러 번 눌러도 한 번만 보낸다
    await page.evaluate(() => {
      window.__dev!.delayMs = 1500;
    });
    const btn = page.getByRole('button', { name: /상담 내용 보내기|보내는 중입니다/ });
    await btn.click();
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveAttribute('aria-busy', 'true');
    await btn.click({ force: true }).catch(() => undefined);
    await expect(page.getByRole('heading', { name: '접수되었습니다' })).toBeVisible();
    await page.evaluate(() => {
      window.__dev!.delayMs = 0;
    });
    // 실패한 첫 시도 + 연속 클릭에도 저장은 한 건
    await loginAdmin(page);
    await page.getByRole('link', { name: '응답·상담' }).click();
    await expect(page.getByText('1건 중 1건')).toBeVisible();
  });

  test('접수 마감·비활성·잘못된 링크 안내', async ({ page }) => {
    await page.goto(`/#/s/${TOKENS.closedCourse}`);
    await expect(page.getByRole('heading', { name: '지금은 접수하지 않습니다' })).toBeVisible({ timeout: 30_000 });
    await page.goto(`/#/s/${TOKENS.inactive}`);
    await expect(page.getByRole('heading', { name: '지금은 접수하지 않습니다' })).toBeVisible();
    await page.goto('/#/s/not-a-real-token');
    await expect(page.getByRole('heading', { name: '링크를 확인할 수 없습니다' })).toBeVisible();
    await page.goto('/#/nowhere');
    await expect(page.getByRole('heading', { name: '페이지를 찾을 수 없습니다' })).toBeVisible();
  });

  test('여러 수업 선택: 시간 복사 미리보기, 시험 기간 복사, 숙제 합계', async ({ page }) => {
    await openSurvey(page, TOKENS.multi);
    await expect(page.getByText('중학교 1~3학년', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: '학습 상담 작성하기' }).first().click();
    await fillBasic(page);
    await page.getByLabel('학교급·학년').selectOption('middle-3');
    await next(page);
    await expect(page.getByRole('heading', { level: 1, name: '수업 선택·일정' })).toBeFocused();
    await next(page);
    await expect(page.getByText('수업을 하나 이상 골라주세요.').first()).toBeVisible();
    await page.getByRole('checkbox', { name: /중등수학 정규 클래스/ }).check();
    await page.getByRole('checkbox', { name: /통합과학 정규 클래스/ }).check();
    await expect(page.getByText('3단계', { exact: false }).or(page.getByText('5단계 중 2단계'))).toBeVisible();

    const math = page.getByRole('region', { name: '중등수학 정규 클래스' });
    const isci = page.getByRole('region', { name: '통합과학 정규 클래스' });
    await math.getByRole('checkbox', { name: '아직 정하지 않았어요' }).check();
    await math.getByRole('button', { name: '+ 시간 추가' }).click();
    await math.getByLabel('요일').first().selectOption({ label: '월요일' });
    await math.getByLabel('시작 시각').first().selectOption('18:00');
    await math.getByRole('button', { name: '+ 시간 추가' }).click();
    await math.getByLabel('요일').nth(1).selectOption({ label: '수요일' });
    await math.getByLabel('시작 시각').nth(1).selectOption('19:00');

    await isci.getByRole('checkbox', { name: '아직 정하지 않았어요' }).check();
    await isci.getByRole('button', { name: '수학 수업에도 같은 시간 적용' }).click();
    const dialog = page.getByRole('dialog', { name: '적용하기 전에 확인해주세요' });
    await expect(dialog.getByText('적용 후')).toBeVisible();
    await expect(dialog.getByText('월 18:00~20:00')).toBeVisible();
    await dialog.getByRole('button', { name: '적용하기' }).click();
    await expect(isci.getByLabel('요일')).toHaveCount(2);
    await page.getByRole('group', { name: /이어서 받고 싶으신가요/ }).getByRole('radio', { name: '이어서 받고 싶어요' }).check();
    await expectNoHorizontalOverflow(page);
    await next(page);

    // 수학: 중간고사 기간 입력
    await expect(page.getByRole('heading', { level: 1, name: '수학 학습 정보' })).toBeFocused();
    await fillCourseRequired(page);
    const mid = page.getByRole('group', { name: '중간고사' });
    await mid.getByRole('radio', { name: '입력' }).check();
    await mid.getByLabel('시험 기간 시작일').fill('2026-10-20');
    await mid.getByLabel('시험 기간 종료일').fill('2026-10-23');
    await mid.getByLabel('이 과목 시험일').fill('2026-10-21');
    await page.getByRole('group', { name: /숙제에 쓸 수 있는 시간/ }).getByRole('radio', { name: '주 120분 이상' }).check();
    await next(page);

    await expect(page.getByRole('heading', { level: 1, name: '통합과학 학습 정보' })).toBeFocused();
    await fillCourseRequired(page);
    await page.getByRole('button', { name: '수학에 입력한 시험 기간 가져오기' }).click();
    const mid2 = page.getByRole('group', { name: '중간고사' });
    await expect(mid2.getByLabel('시험 기간 시작일')).toHaveValue('2026-10-20');
    await expect(mid2.getByLabel('이 과목 시험일')).toHaveValue(''); // 과목별 시험일은 따로
    await expect(page.getByText('선택한 수업 전체: 주 150분 이상')).toBeVisible();
    await page.getByRole('group', { name: /숙제에 쓸 수 있는 시간/ }).getByRole('radio', { name: '상담 후 결정' }).check();
    await expect(page.getByText('합계 미확정', { exact: false })).toBeVisible();
    await next(page);

    await expect(page.getByRole('heading', { level: 1, name: '검토·동의' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '수학 · 과목별 학습 정보' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '통합과학 · 과목별 학습 정보' })).toBeVisible();
    await page.getByRole('checkbox', { name: /개인정보 수집·이용에 동의합니다/ }).check();
    await page.getByRole('button', { name: '상담 내용 보내기' }).click();
    await expect(page.getByRole('heading', { name: '접수되었습니다' })).toBeVisible();
  });

  test('360px 화면에서도 가로 넘침 없음', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openSurvey(page, TOKENS.multi);
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: '학습 상담 작성하기' }).first().click();
    await expectNoHorizontalOverflow(page);
    await fillBasic(page);
    await next(page);
    await page.getByRole('checkbox', { name: /중등과학 정규 클래스 · 토요일 오전반/ }).check();
    await page.getByRole('checkbox', { name: /통합과학 정규 클래스/ }).check();
    await page.getByRole('region', { name: '통합과학 정규 클래스' }).getByRole('button', { name: '+ 시간 추가' }).click();
    await expectNoHorizontalOverflow(page);
  });
});
