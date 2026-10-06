# 수업 준비실

학부모가 초대 링크로 **수업 전 학습 상담**을 작성하고, 선생님이 수업별로 응답·상담 기록을 관리하는 웹사이트입니다.

- 프런트엔드: React 19 + TypeScript + Vite 8 + Tailwind CSS 4 (GitHub Pages 정적 배포, 해시 라우팅)
- 서버: Supabase (PostgreSQL · RLS · Auth · SQL 함수)
- 테스트: Vitest(로직·DB) + Playwright(화면 흐름). DB 테스트는 PGlite에 실제 마이그레이션을 적용해 RLS·권한까지 검사합니다.

## 현재 상태

| 구분 | 상태 | 근거 |
| --- | --- | --- |
| 화면 구현 | 완료 | 학부모 설문·관리자 화면 전체. 모바일 360·375·390px, 데스크톱 1366px에서 E2E·스크린샷으로 확인 |
| 저장·인증 로직 (SQL·RLS·함수) | 코드 완료, PGlite로 검증 | `tests/db` 52개 테스트 통과 (실제 Supabase 프로젝트에서는 아직 실행하지 않음) |
| 실제 Supabase 연결 | **미완료** | Supabase 프로젝트와 키가 필요합니다. 아래 ‘최소 설정’ 참고 |
| GitHub Pages 운영 배포 | **미완료** | 워크플로는 준비됨. 저장소 생성·푸시가 필요합니다 |

## 폴더 구조

```
src/
  parent/          학부모 설문 (안내 → 기본 정보 → 수업·일정 → 과목별 학습 정보 → 검토·동의 → 완료)
  admin/           관리자 (대시보드, 응답·상담, 수업 관리, 과목·설문 관리, 운영 설정)
  components/      공통 UI (입력·오류 요약·대화상자·과목 배지)
  copy/ko.ts       화면 문구 모음 (버튼·상태 이름은 여기서만 정의)
  lib/             도메인 로직 (질문 검증, 일정, 숙제 합계, 미확인 항목, 문자 초안, CSV, 백엔드 연결)
supabase/
  migrations/      스키마 · 검증 함수 · 공개 API · 관리자 API · 초기 과목/양식 (운영에 적용)
  setup_all.sql    위 마이그레이션을 합친 파일 (SQL Editor 에 한 번에 붙여넣기용, npm run sql:bundle)
  local/           개발 전용 (PGlite용 auth 흉내, 예시 수업·초대 링크) — 운영에 적용하지 않음
tests/
  unit/  db/       Vitest
  e2e/             Playwright (개발용 로컬 DB 모드)
  e2e-basepath/    운영 빌드를 /tutoring-survey/ 하위 경로로 띄워 확인
.github/workflows/deploy.yml   테스트 → 빌드 → 비밀 값 검사 → GitHub Pages 배포
```

## 로컬에서 실행하기

```bash
npm install
```

Supabase 없이 화면을 확인하려면 개발용 로컬 DB 모드로 띄웁니다. 브라우저 안의 PGlite에 실제 마이그레이션을 적용하며, 화면 상단에 “개발용 로컬 DB” 안내가 표시됩니다. 이 모드는 운영 빌드에 포함되지 않습니다.

```bash
npm run dev:localdb
```

- 주소: http://127.0.0.1:5281/
- 예시 링크: `#/s/devmultiplecourses000000000000000000000` (여러 수업 선택), `#/s/devsciencesingle0000000000000000000000` (중학교 과학 토요반)
- 관리자 화면: `#/admin` — 개발용 계정과 비밀번호는 `.env.localdb`와 `supabase/local/seed.dev.sql`에 있습니다 (개발 전용 값)

실제 Supabase에 연결해 띄우려면 `.env.example`을 `.env.local`로 복사해 채운 뒤 `npm run dev`를 실행합니다.

## 사용자가 해야 할 최소 설정

비밀 키를 대화창이나 저장소에 붙여넣지 마세요. 아래 작업은 모두 Supabase·GitHub 화면에서 직접 합니다.

### 1. Supabase 프로젝트

1. https://supabase.com 에서 새 프로젝트를 만듭니다 (지역: Northeast Asia (Seoul) 권장).
2. **SQL Editor**에 `supabase/setup_all.sql` 전체를 붙여넣고 한 번 실행합니다.
   - CLI를 쓰려면 `npx supabase init` → `npx supabase link --project-ref <프로젝트 ref>` → `npx supabase db push`
3. **Authentication → Sign In / Providers**
   - Email 로그인을 켜고 **Allow new users to sign up을 끕니다** (공개 회원가입 없음).
4. **Authentication → URL Configuration**
   - Site URL: `https://<GitHub 사용자명>.github.io/<저장소이름>/`
   - Redirect URLs: `https://<GitHub 사용자명>.github.io/<저장소이름>/**` (로컬 확인용으로 `http://127.0.0.1:5281/**` 추가 가능)
5. **Authentication → Emails → Reset Password** 템플릿의 링크를 아래로 바꾸는 것을 권장합니다. 메일을 연 기기와 다른 브라우저에서도 재설정할 수 있고, 메일 보안 검사기가 링크를 먼저 열어도 토큰이 소모되지 않습니다(화면에서 버튼을 눌러야 확인).
   ```html
   <a href="{{ .SiteURL }}#/admin/reset?token_hash={{ .TokenHash }}&type=recovery">비밀번호 재설정</a>
   ```
   기본 템플릿을 그대로 두어도 `?auth=recovery&code=...` 방식으로 동작하지만, 재설정을 요청한 같은 브라우저에서 메일을 열어야 합니다.
   Supabase 기본 메일 발송은 시간당 발송량 제한이 있으니 운영 시에는 Custom SMTP 설정을 권장합니다.

### 2. 관리자 계정 등록

1. **Authentication → Users → Add user**에서 선생님 이메일과 비밀번호로 사용자를 만듭니다 (Auto Confirm 체크).
2. **SQL Editor**에서 실행합니다 (이메일만 바꿔서).
   ```sql
   insert into public.admin_memberships (user_id, note)
   select id, '선생님' from auth.users where email = 'teacher@example.com';
   ```
   로그인만 된 계정은 데이터에 접근할 수 없고, 이 표에 등록된 계정만 관리자 기능을 씁니다. 클라이언트에는 이 표에 쓰는 권한이 없습니다.

### 3. GitHub Pages 배포

1. 이 폴더(`source/claude`)의 내용을 새 GitHub 저장소의 루트로 올립니다.
   ```bash
   git init -b main
   git add .
   git commit -m "수업 준비실 첫 버전"
   git remote add origin https://github.com/<사용자명>/<저장소이름>.git
   git push -u origin main
   ```
2. 저장소 **Settings → Pages → Source: GitHub Actions**
3. 저장소 **Settings → Secrets and variables → Actions → Variables**에 공개 설정 2개를 등록합니다.
   - `VITE_SUPABASE_URL`: `https://<프로젝트 ref>.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: Project Settings → API Keys의 **Publishable key** (`sb_publishable_...`)
   - 사용자 사이트(`<이름>.github.io` 저장소)나 개인 도메인을 쓰면 `VITE_BASE_PATH` = `/` 도 추가합니다. 그 밖에는 워크플로가 `/<저장소이름>/`을 자동으로 씁니다.
4. `main`에 푸시하면 테스트 → 빌드 → 빌드 결과 비밀 값 검사 → 배포 순서로 실행됩니다. 접속 주소: `https://<사용자명>.github.io/<저장소이름>/`

### 4. 공개 접수 전 운영 설정

관리자 화면 **운영 설정**에서

1. 선생님 이름(입력하면 학부모 화면 머리말이 “○○○ 선생님 | 학습 상담”이 됩니다)
2. 개인정보 안내: 운영자 이름, 연락처, 이용 목적, **보관 기간**, **삭제 요청 방법**을 실제 운영 내용으로 채우고 “확정”을 체크합니다.
   확정 전에는 학부모가 링크를 열어도 “아직 접수를 준비하고 있습니다”만 보입니다. 이 화면은 법적 요건 충족 여부를 판단하지 않습니다.

## 실제 운영 내용 입력

입력 형식은 [docs/운영-설정-예시.md](docs/운영-설정-예시.md)에 있습니다. 실제 선생님 소개·수업료·환불 문구는 저장소에 넣지 않고 배포 후 관리자 화면에서 입력합니다(원문은 저장소에서 제외된 `private/` 폴더에 보관).

## 과목·수업·설문 추가 방법

- **과목 추가**: 과목·설문 관리 → 새 과목 추가. 기본 학습 질문으로 시작하거나 기존 과목 양식을 복사합니다. 새 과목 양식은 초안 상태이니 질문을 확인하고 **발행**합니다. 배지 색은 과목 이름에서 자동으로 정해집니다.
- **질문 편집**: 짧은 글·긴 글·단일 선택·복수 선택·숫자·날짜·시각, ‘모름·미정’ 선택지, 필수, 사용/숨김, 적용 학년, 적용 수업, 앞선 선택형 질문에 따른 표시 조건, 문자 초안 문구를 고칠 수 있습니다. 오른쪽 모바일 미리보기에 바로 반영됩니다.
  - 기본 질문(출판사·단원·어려운 부분·목표 등)은 삭제·유형 변경을 막고 문구 수정·숨기기만 허용합니다.
  - 학부모·학생 기본 정보, 일정, 시험·숙제, 개인정보 동의는 시스템 항목이라 양식 편집으로 사라지지 않습니다.
  - **적용 학년**을 고른 질문은 그 학년 학생에게만 보입니다. 기본 양식에는 학년별 선수 개념 질문(중1: 초등 분수·소수, 중2: 일차방정식, 중3: 식의 계산·일차함수)과 학년별 단원 목록이 들어 있습니다. 단원 목록은 고르기 쉽게 돕는 선택 질문이며 학교 진도표가 아닙니다. 교육과정이 바뀌면 화면에서 고쳐주세요.
- **버전**: 발행하면 새 버전이 생기고 이후 접수부터 적용됩니다. 이미 받은 응답은 작성 당시 버전의 질문·선택지·수업 조건으로 보입니다. 작성 도중 새 버전이 발행되어도 7일 동안은 이전 버전으로 제출할 수 있습니다.
- **수업 추가**: 수업 관리 → 새 수업 만들기. 과목·대상·범위·방식·형태·횟수·시간·요일·시간대·시작일·기간을 넣고, 이미 정해진 조건만 “확정”으로 체크합니다. 체크하지 않은 조건은 학부모에게 희망을 묻습니다. 시작 시각과 회당 시간을 넣으면 종료 시각을 계산합니다.
  예) 중학교 과학 토요반(대상 중1~3): 요일 토, 시간대 오전, 120분, `요일·회당 시간·주당 횟수` 확정 → 첫 수업 날짜와 정확한 시작 시각은 학부모 희망을 받고 상담하면서 정함
- **초대 링크**: 수업 관리 아래 ‘초대 링크 만들기’. 수업 1개 고정 또는 여러 수업 중 선택. 마감 일시·최대 접수 건수를 둘 수 있고 링크를 끄면 바로 접수가 막힙니다. 링크에는 64자리 무작위 값만 들어가며, 링크로 기존 응답을 볼 수 없습니다.
- 응답과 연결된 과목·수업은 삭제되지 않고 보관만 됩니다.

## 보안 설계 요약

- 모든 테이블에 RLS를 켜고 `anon`·`authenticated`의 테이블 권한을 회수한 뒤, 관리자 정책(`is_admin()`)만 둡니다.
- 익명 사용자는 `get_public_form`(안내·질문만)과 `submit_consultation`(제출만) 두 함수만 실행할 수 있습니다. 응답 조회·수정·삭제 경로가 없습니다.
- 관리자 함수는 `security invoker`로 실행되어 RLS가 그대로 적용되고, 함수 안에서 관리자 여부를 서버에서 다시 확인합니다. 클라이언트가 보낸 사용자·관리자 ID를 쓰지 않습니다.
- 제출 함수가 필수값·형식·길이·허용 값·질문 ID·수업 ID·초대 링크 허용 수업·양식 버전·확정 조건을 모두 다시 검증하고, 복수 수업을 한 트랜잭션으로 저장합니다(일부 저장 없음). `idempotency_key`로 중복 생성을 막습니다.
- 요청 제한: 링크당 1시간 30건, 같은 접속 주소(해시로만 저장, 하루 뒤 삭제)당 10분 5건. 숨은 입력칸으로 단순 스팸을 거릅니다.
- 학부모 원본 응답은 수정할 수 없고(트리거), 선생님 기록은 별도 표에 저장합니다. 삭제는 학생 이름 확인 후 관련 답변·기록까지 함께 지우고, 개인정보 없이 삭제 시각과 건수만 남깁니다.
- 화면은 사용자 입력을 HTML로 렌더링하지 않습니다. URL에는 이름·전화번호를 넣지 않고, 외부 분석·광고 스크립트가 없습니다. 폰트(Pretendard)도 직접 배포합니다.
- **CAPTCHA**: 첫 버전에는 넣지 않았습니다. 스팸이 생기면 Cloudflare Turnstile을 붙이는 방법을 권장합니다 — Supabase Edge Function에서 Turnstile 토큰을 검증한 뒤 서버 권한으로 `submit_consultation`을 호출하고, `submit_consultation`의 `anon` 실행 권한을 회수하는 구성입니다. CORS 설정만으로는 보호되지 않습니다.

## 환경 변수

| 이름 | 구분 | 어디에 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | 클라이언트 공개 | `.env.local`, GitHub Actions Variables |
| `VITE_SUPABASE_PUBLISHABLE_KEY` (또는 legacy `VITE_SUPABASE_ANON_KEY`) | 클라이언트 공개 | 위와 같음 |
| `VITE_BASE_PATH` | 클라이언트 공개 (선택) | 사용자 사이트·개인 도메인일 때만 |
| Supabase secret key / service_role, DB 비밀번호 | **서버 비밀** | 이 프로젝트에 넣지 않음. 필요한 작업은 Supabase 화면에서 |

`npm run check:secrets`는 저장소를, 배포 워크플로는 빌드 결과(`dist`)를 검사합니다(비밀 키·service_role JWT·개발용 DB·개발용 계정 흔적).

## 테스트

```bash
npm run typecheck
npm test                  # 단위 + DB(PGlite) 100개
npm run test:e2e          # Playwright: 모바일 7 + 데스크톱 8 (개발용 로컬 DB 모드)
npm run test:e2e:basepath # 운영 빌드를 /tutoring-survey/ 하위 경로에서 확인
```

처음 한 번은 `npx playwright install chromium`이 필요합니다.

## 데이터 모델

`subjects` · `form_templates` / `form_versions`(질문 정의 스냅숏, 발행 후 수정 불가) · `courses` · `invitations` / `invitation_courses` · `submissions`(제출 공통 정보) · `submission_courses`(수업별 원본 + 당시 수업 조건 스냅숏) · `submission_course_slots` · `submission_assessments` · `answers`(질문별 타입 컬럼으로 저장) · `consultation_records` / `consultation_slots`(선생님 기록, 수업별 독립 상태) · `admin_memberships` · `app_settings` · `deletion_log`
