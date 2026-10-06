// 저장소 파일 또는 빌드 결과(dist)에 비밀 키·개발용 값이 들어가지 않았는지 검사한다.
//   npm run check:secrets          → 저장소 전체 (node_modules, dist 제외)
//   npm run check:secrets -- dist  → 빌드 결과 (개발용 DB·계정 흔적까지 검사)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const target = process.argv[2] ?? '.';
const isDist = /(^|[\/])dist$/.test(target);
const SKIP = new Set(['node_modules', '.git', 'dist', 'test-results', 'playwright-report', 'scratch', '_workspace']);
const TEXT = /\.(js|mjs|cjs|ts|tsx|json|html|css|md|sql|yml|yaml|toml|txt|env|example|map)$|^\.env/;

const rules = [
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: 'Private key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'service_role 값 대입', re: /SERVICE_ROLE(?:_KEY)?\s*[=:]\s*['"]?ey[A-Za-z0-9_-]{20,}/i },
  { name: 'Postgres 접속 문자열(비밀번호 포함)', re: /postgres(?:ql)?:\/\/[^:\s'"]+:[^@\s'"]{6,}@(?!localhost|127\.0\.0\.1)/ },
];
if (isDist) {
  rules.push(
    { name: '개발용 비밀번호', re: /dev-only-password/ },
    { name: '개발용 DB(PGlite)', re: /pglite|PGlite/ },
    { name: '개발용 계정', re: /@dev\.localhost/ },
    { name: '개발용 초대 토큰', re: /devmathsingle|devmultiplecourses/ },
  );
}

// JWT 의 role 이 service_role 인지 확인
function serviceRoleJwt(text) {
  const found = [];
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') found.push(m[0].slice(0, 20) + '…');
    } catch {
      /* JWT 가 아님 */
    }
  }
  return found;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) && !(isDist && dir === target)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (TEXT.test(name) && st.size < 5_000_000) yield p;
  }
}

const problems = [];
let files = 0;
for (const file of walk(target)) {
  if (file.endsWith('check-secrets.mjs')) continue;
  files++;
  const text = readFileSync(file, 'utf8');
  for (const r of rules) if (r.re.test(text)) problems.push(`${relative('.', file)}: ${r.name}`);
  for (const jwt of serviceRoleJwt(text)) problems.push(`${relative('.', file)}: service_role JWT (${jwt})`);
}

if (problems.length) {
  console.error(`비밀 값 검사 실패 (${files}개 파일 검사):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`비밀 값 검사 통과: ${files}개 파일 (${isDist ? '빌드 결과' : '저장소'})`);
