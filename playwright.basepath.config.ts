import { defineConfig, devices } from '@playwright/test';

// 운영 빌드를 GitHub Pages 와 같은 하위 경로(/tutoring-survey/)로 띄워 확인한다.
// Supabase 주소는 일부러 닫힌 포트로 두어, 서버 연결 실패 시 화면을 함께 검증한다.
const PORT = 5292;
export const BASE = '/tutoring-survey/';

export default defineConfig({
  testDir: 'tests/e2e-basepath',
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...devices['Desktop Chrome'] },
  webServer: {
    command: `npx vite build --outDir dist-basepath-test && npx vite preview --outDir dist-basepath-test --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}${BASE}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_BASE_PATH: BASE,
      VITE_SUPABASE_URL: 'http://127.0.0.1:9',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_placeholder_for_test',
    },
  },
});
