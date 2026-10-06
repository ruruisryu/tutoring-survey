/// <reference types="vitest/config" />
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** GitHub Pages 는 없는 경로에 404.html 을 준다. 같은 앱을 내보내 /저장소이름/아무경로 로 들어와도 첫 화면이 열리게 한다. */
function pages404(): Plugin {
  let outDir = 'dist';
  return {
    name: 'pages-404',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    writeBundle() {
      copyFileSync(join(outDir, 'index.html'), join(outDir, '404.html'));
    },
  };
}

// GitHub Pages 프로젝트 사이트는 /<저장소이름>/ 아래에서 열린다.
// 배포 워크플로가 VITE_BASE_PATH 를 저장소 이름으로 채운다. 로컬 개발은 '/'.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const raw = env.VITE_BASE_PATH || '/';
  const base = raw.endsWith('/') ? raw : `${raw}/`;
  return {
    base,
    plugins: [react(), tailwindcss(), pages404()],
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    build: { sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 700 }, // 첫 화면 JS 는 gzip 약 184KB (React·라우터·supabase-js 포함)
    test: {
      include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/db/**/*.test.ts'],
      environment: 'node',
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  };
});
