// Supabase SQL Editor 에 한 번에 붙여넣을 수 있도록 마이그레이션을 순서대로 합친다.
//   npm run sql:bundle → supabase/setup_all.sql
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join('supabase', 'migrations');
const parts = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => `-- ============================================================\n-- ${f}\n-- ============================================================\n${readFileSync(join(dir, f), 'utf8')}`);
const header = `-- 수업 준비실: 전체 설치 SQL (supabase/migrations 를 순서대로 합친 파일 · 직접 수정하지 말 것)
-- 새 Supabase 프로젝트의 SQL Editor 에 붙여넣어 한 번만 실행한다.
-- 개발용 예시 데이터(supabase/local)는 포함하지 않는다.\n\n`;
writeFileSync(join('supabase', 'setup_all.sql'), header + parts.join('\n\n'));
console.log('supabase/setup_all.sql 을 만들었습니다.');
