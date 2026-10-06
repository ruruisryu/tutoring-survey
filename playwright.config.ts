import { defineConfig, devices } from '@playwright/test';

// 개발용 로컬 DB(PGlite) 모드로 띄운 개발 서버를 대상으로 화면 흐름을 검증한다.
// 실제 Supabase 연결은 이 테스트로 확인하지 않는다 (README 의 ‘미검증 항목’ 참고).
const PORT = 5291;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } }, testIgnore: /desktop|basepath/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } }, testMatch: /desktop|admin|basepath/ },
  ],
  webServer: [
    {
      command: `npx vite --mode localdb --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
