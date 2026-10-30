# AIFFEL Campus Agent Code Review Template_1

- 개발자: maidysound-netizen (커밋 작성자 기준)
- 리뷰어: crystalmoon74
- 리뷰 대상: [SiteOps-Checklist](https://github.com/crystalmoon74/SiteOps-Checklist) (fork, 최신 커밋 `37c9d7b`)
- 리뷰 일자: 2026-10-30

> **프로젝트 한 줄 요약**
> 개인 웹사이트 운영 점검 항목을 관리하는 Todo 앱입니다. Express 5 + 바닐라 JS 화면에, 저장소를 `.env`의 `DB_DRIVER`로 **SQLite(로그인 없음)** 또는 **Supabase(Google 로그인 + RLS)** 중에서 고를 수 있게 만들었습니다. CRUD 외에 카테고리 · 마감일(기한 지남 / 오늘 / D-n) · 사이트 필터 · 요약 카드가 있고, Vercel 배포와 로컬 Docker(Supabase CLI) 실행까지 지원합니다.

**리뷰 환경**: Windows 11, Node.js v25.8.1, SQLite 모드로 로컬 실행 (임시 DB 사용). Supabase 모드와 Google 로그인은 리뷰어 환경에 계정·키가 없어 **직접 실행하지 못했습니다.**

# ART(Agent Review Template)

[O] **1. 원하는 기능이 의도한 대로 동작하나요?**

- 리뷰 결과: **SQLite 모드에서 README/PRD에 적힌 기능이 모두 동작함을 확인했습니다.** Supabase 모드 · Google 로그인 · 사용자별 데이터 분리는 직접 실행하지 못해 **확인 필요**입니다(PRD의 테스트 기록은 있음).
- 확인한 근거:
  - `npm install` 후 `DB_PATH=<임시파일> PORT=3999 node server.js` 로 실행 → `SiteOps Checklist → http://localhost:3999 (DB: SQLite ...)` 출력, 예시 데이터 4건 자동 생성
  - curl로 API 29건 테스트 (아래 표), 브라우저에서 화면 추가 · 완료 토글 확인

  | 테스트 | 요청 | 결과 |
  | --- | --- | --- |
  | 요약 | `GET /api/summary` | 200 `{"total":4,"open":3,"done":1,"overdue":1}` ✅ |
  | 목록 정렬 | `GET /api/todos` | 미완료 → 마감일 빠른 순 → 완료 항목 순 ✅ |
  | 기한 지남 필터 | `GET /api/todos?status=overdue` | 어제 마감 1건만 반환 ✅ |
  | 잘못된 필터 | `?status=xxx`, `?category=abc` | 400 ✅ |
  | 추가 | 제목 앞뒤 공백 포함 POST | 201, 공백 제거되어 저장 ✅ |
  | 빈 제목 / 101자 | POST | 400 `제목은 1~100자로 입력해 주세요.` ✅ |
  | 날짜 형식 오류 | `2026/11/05` | 400 ✅ |
  | 존재하지 않는 날짜 | `2026-02-30` | 400 (DB `CHECK`가 막음) ✅ |
  | 없는 카테고리 | `category_id: 999` | 400 `존재하지 않는 사이트 또는 카테고리` ✅ |
  | 깨진 JSON | `{bad` | 400 `요청 형식(JSON)이 올바르지 않습니다.` ✅ |
  | 허용 안 된 필드 | `{"id":777,"completed_at":"x"}` 포함 | 무시되고 정상 생성 ✅ |
  | 완료 토글 | `PATCH {"is_done":true}` | `completed_at` 자동 기록 ✅ |
  | 빈 수정 / 없는 항목 | `PATCH {}`, `/todos/9999`, `/todos/abc` | 400 / 404 / 404 ✅ |
  | 삭제 / 재삭제 | `DELETE` 2회 | 204 → 404 ✅ |
  | 사이트 추가 / 중복 | `POST /api/sites` | 201 → 409 ✅ |
  | 없는 API | `GET /api/nope` | 404 JSON ✅ |
  | **`is_done: "false"` (문자열)** | PATCH | **200, 완료(1)로 저장됨** ⚠️ |
  | **`title: {"a":1}` (객체)** | POST | **201, 제목이 `[object Object]`로 저장됨** ⚠️ |

  - 화면 테스트(브라우저): 제목 `UI 테스트 항목`, 분류 DNS, 마감일 3일 뒤로 추가 → 목록에 `DNS · D-3 · 2026-11-02` 표시, 체크박스 클릭 → 요약 카드 완료 수 1→2 갱신 확인
  - 배포 사이트: `https://siteops-checklist.vercel.app/` 200 응답, 로그인 없이 `GET /api/todos` → 401 `로그인이 필요합니다.` 확인 (로그인 후 기능은 확인 필요)
- 잘 구현된 부분:
  - **저장소 추상화**: `server.js:14-33`에서 `DB_DRIVER`에 따라 `lib/store-sqlite.js` / `lib/store-supabase.js` 중 하나만 동적 import 합니다. 두 저장소가 같은 메서드와 같은 응답 모양(`is_done`을 0/1로 통일, `store-supabase.js:29`)을 돌려주므로 화면 코드가 저장소를 전혀 몰라도 됩니다.
  - **서버 + DB 이중 검증**: `parseTodoInput`(`server.js:55-78`)이 허용된 컬럼만 골라내고, DB는 `CHECK (due_date IS date(due_date))`(`db/schema.sql:24`)로 실제 존재하지 않는 날짜까지 막습니다. 테스트에서 `2026-02-30`이 정확히 걸렸습니다.
  - **비즈니스 로직을 DB에 둠**: `updated_at`/`completed_at` 트리거, `todo_list` 뷰의 `due_status` 계산이 SQLite·Postgres 양쪽에 같은 의미로 구현되어 있고, Postgres 쪽은 `Asia/Seoul` 기준 날짜로 계산하는 점(`supabase/setup.sql:92-93`)까지 챙겼습니다.
  - Express 5의 async 오류 자동 전달을 활용해 라우트마다 try/catch 없이 오류 처리 미들웨어 하나(`server.js:167-172`)로 모았습니다.
- 추가 확인 또는 개선 사항:
  1. **`is_done` 타입 검사 없음** — `server.js:75` `body.is_done ? 1 : 0` 은 문자열 `"false"`, `"0"`도 참으로 봅니다. 화면은 boolean을 보내서 문제가 없지만, API를 직접 호출하면 의도와 반대로 저장됩니다. `typeof body.is_done !== 'boolean'`이면 400을 주는 것을 권합니다.
  2. **제목·메모 타입 검사 없음** — `String(body.title ?? '')`(`server.js:60`)이 객체를 `[object Object]`로 바꿔 저장합니다. `typeof body.title !== 'string'`이면 400 처리를 권합니다. 메모(`server.js:64-67`)는 길이 제한도 없습니다.
  3. **편집 중 사이트·카테고리를 비우는 경우**: 화면은 `''`를 보내고 서버가 `null`로 바꾸므로 정상입니다. 다만 수정 창에서 마감일을 지울 때도 같은 흐름인지 화면에서 한 번 더 확인해 보면 좋겠습니다(리뷰어는 API로만 확인).
  4. Supabase 모드의 `summary()`(`store-supabase.js:89-97`)는 모든 행을 받아와 JS에서 셉니다. 과제 규모에선 문제없지만, 행이 많아지면 PostgREST 기본 최대 행 수(1000) 때문에 숫자가 잘릴 수 있습니다 — **확인 필요**.
  5. 자동화된 테스트 코드(`npm test`)가 없어 위 결과를 재현하려면 수동으로 다시 해야 합니다(③ 개선 제안 참고).

[O] **2. 보안 검토를 수행했나요?**

- 리뷰 결과: **학습 프로젝트 수준을 넘어서는 보안 설계가 되어 있습니다.** 하드코딩된 비밀값이 없고, 권한을 서버 코드가 아니라 DB의 RLS가 최종 결정하도록 만든 점이 특히 좋습니다. 다만 몇 가지 보완점이 있습니다.
- 확인한 근거:
  - **비밀값 검사**: `git log -p --all` 전체 이력에서 `sb_secret`, `sb_publishable_…`(실제 값), JWT(`eyJ…`), Google Client Secret(`GOCSPX…`) 패턴 검색 → 실제 값 없음, `.env.example`의 예시 문구(`sb_secret_...`)만 검색됨
  - `.gitignore`에 `.env`가 있어 루트 `.env`와 `supabase/.env` 모두 제외됨. Google Secret은 `supabase/config.toml:328`에서 `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)`로 읽음
  - `supabase/config.toml:327`의 Google `client_id`는 공개되어도 되는 값입니다(Secret 아님)
  - `npm audit --omit=dev` → `found 0 vulnerabilities`
  - **XSS 테스트**: 제목에 `<img src=x onerror=alert(1)>` 저장 → 화면에 글자 그대로 표시, 목록 안 `<img>` 요소 0개 확인 (`public/app.js`가 `textContent`만 사용, `innerHTML` 없음)
  - **SQL 인젝션**: `store-sqlite.js`는 모두 `?` 바인딩. `createTodo`/`updateTodo`(`store-sqlite.js:58-70`)는 컬럼 이름을 문자열로 이어 붙이지만, 컬럼 목록이 `parseTodoInput`의 허용 목록에서만 오므로 안전합니다. 테스트에서 `id`, `completed_at`을 보내도 무시됨을 확인
  - **사이트 주소**: `javascript:alert(1)` → 400 (`server.js:84`의 http/https 검사)
  - **비로그인 접근**: 배포 사이트 `GET /api/todos` → 401 확인
- 잘 구현된 부분:
  - **secret 키를 아예 쓰지 않는 설계**: 서버는 publishable 키 + 요청한 사용자의 토큰으로 요청마다 Supabase 클라이언트를 만듭니다(`store-supabase.js:119-125`). 서버 코드에 실수가 있어도 DB가 남의 데이터를 막습니다.
  - **꼼꼼한 RLS 정책**(`supabase/setup.sql:103-121`): `user_id = auth.uid()`뿐 아니라 `with check`에서 "항목에 붙이는 사이트도 내 사이트여야 한다"까지 검사해, 남의 사이트 id를 붙이는 공격을 막았습니다. 뷰도 `security_invoker = true`(`setup.sql:84`)로 RLS 우회를 막았습니다.
  - Postgres 함수에 `set search_path = ''`(`setup.sql:61`)를 지정해 search_path 하이재킹을 예방했습니다.
  - 로그인은 PKCE 흐름(`app.js:277`)을 쓰고, 돌아온 뒤 URL의 `code=`를 지웁니다(`app.js:279`).
  - 500 오류 시 사용자에게는 일반 메시지만, 상세 내용은 서버 콘솔에만 남깁니다(`server.js:170-171`).
- 보안 개선 제안:
  1. **SQLite 모드가 모든 네트워크 주소에서 열림 (중요도: 중)** — `app.listen(PORT)`(`server.js:184`)는 호스트를 지정하지 않아 같은 Wi-Fi의 다른 사람도 인증 없이 데이터를 조회·삭제할 수 있습니다. 로그인 없는 모드라면 `app.listen(PORT, '127.0.0.1')`로 내 컴퓨터에서만 접속되게 하는 것을 권합니다.
  2. **보안 헤더·요청 제한 없음 (중요도: 하~중)** — CSP, `X-Frame-Options` 등이 없고 API 요청 횟수 제한도 없습니다. 배포 사이트라면 `helmet`과 `express-rate-limit` 추가를 고려해 보세요. CSP를 넣으면 jsDelivr 주소(`app.js:12`)를 `script-src`에 허용해야 합니다.
  3. **CDN 스크립트 무결성** — `supabase-js`를 jsDelivr에서 버전 고정(`@2.118.0`)으로 받는 점은 좋지만, 동적 `import()`라 SRI 해시 검사를 할 수 없습니다. npm 패키지를 번들/정적 파일로 직접 제공하면 외부 CDN 의존과 공급망 위험을 줄일 수 있습니다.
  4. **로컬 Supabase 설정** — `config.toml`에 이메일 회원가입(`[auth.email] enable_signup = true`, 이메일 확인 끔)과 `skip_nonce_check = true`(`config.toml:330`)가 켜져 있습니다. 로컬 전용이라 위험은 낮지만, 앱이 Google 로그인만 쓴다면 이메일 가입은 꺼 두는 편이 의도에 맞습니다.
  5. **`claim.sql`** — "가장 먼저 가입한 계정"에 주인 없는 데이터를 붙입니다(`supabase/claim.sql:5-11`). 앱을 공개(게시)한 뒤 다른 사람이 먼저 가입했다면 그 사람에게 데이터가 넘어갈 수 있으니, 이메일로 대상 계정을 지정하는 방식이 더 안전합니다.
  6. **AI Agent 관련**: 앱 자체는 AI Agent가 외부 도구를 실행하지 않습니다. 개발 과정에서 Agent(커밋의 `Co-Authored-By: Claude`)가 Supabase·Vercel·Google 설정을 다뤘는데, PRD의 "범위 원칙"(`PRD.md:23` — 기존 운영 저장소·Supabase 프로젝트는 수정하지 않고 새 프로젝트만 사용)으로 Agent의 작업 범위를 문서로 제한한 점이 좋습니다. Agent에게 Secret을 직접 붙여넣지 않았는지는 **확인 필요**입니다.

[O] **3. 에러가 난 부분을 디버깅하여 "문제를 해결한 기록"을 남겼나요?**

- 리뷰 결과: **오류 → 원인 → 해결이 PRD의 테스트 결과 표에 3건 명확히 기록되어 있고, 해결 결과가 실제 코드에 반영된 것도 확인했습니다.** 다만 기록이 "결과 요약" 위주라 원인을 찾은 과정은 드러나지 않고, 자동 테스트가 없습니다.
- 확인한 근거:
  - 커밋 7개(2026-10-29 ~ 10-30), 커밋 메시지마다 변경 내용을 목록으로 정리
  - `PRD.md:5-11` 버전 이력, `PRD.md:203-225` 테스트 결과 표 (통과 / 해결 표기)
  - `README.md` "보안 메모"에 `permission denied for table ...` 오류 대처법 안내
- 디버깅 및 문제 해결 기록:

  | 문제 | 해결 | 코드 반영 확인 |
  | --- | --- | --- |
  | Supabase 연결 시 `permission denied (42501)` | 최근 Supabase는 SQL로 만든 테이블에 권한을 자동으로 주지 않음 → `GRANT` 추가 (`PRD.md:216`) | 커밋 `662d882`, `supabase/setup.sql:128-133` ✅ |
  | Vercel 배포 후 서버 시작 실패(500) | 환경 변수 `SUPABASE_PUBLISHABLE_KEY` 누락 → 추가 후 재배포 (`PRD.md:222`) | 같은 실수를 막도록 시작 시 누락 검사 + 안내 메시지(`server.js:25-28`), 연결 확인 `check()`(`store-supabase.js:108-115`) ✅ |
  | 로컬 Docker에서 Google 로그인 불가 | `supabase/.env`의 Secret이 비어 있었음 → 다시 저장 후 `db:stop`/`db:start` (`PRD.md:224`) | README에 "Secret을 바꾼 뒤에는 재시작" 안내 추가 ✅ |
  | (예방) Mac 전용 CLI 패키지가 Vercel Linux 빌드에 영향 | `optionalDependencies`로 이동, Linux 설치 시뮬레이션으로 확인 (`PRD.md:225`) | `package.json` ✅ |

  - 이 밖에도 오류 메시지를 원인별로 나눈 `toError()`(`store-supabase.js:8-21`)는 디버깅 경험이 코드로 남은 좋은 예입니다(`42501`을 RLS 위반 403과 권한 미설정 500으로 구분).
  - SQL을 PGlite로 2회 실행해 멱등성(여러 번 실행해도 안전)과 사용자 A·B 분리를 검증한 기록(`PRD.md:212, 218`)도 있습니다. 다만 그 테스트 스크립트는 저장소에 없어 재현은 **확인 필요**입니다.
- 개선 제안:
  1. **자동 테스트 추가** — Node 내장 `node:test`와 `DB_PATH=':memory:'`(이미 `store-sqlite.js:10`에서 지원)를 쓰면 설치 없이 API 테스트를 만들 수 있습니다. PRD의 테스트 표를 그대로 테스트 코드로 옮기면 됩니다(아래 코드 개선 제안 4).
  2. **PGlite RLS 테스트 스크립트를 저장소에 포함** — 가장 가치 있는 보안 검증이므로 `test/rls.test.js` 같은 이름으로 남기면 다른 사람도 재현할 수 있습니다.
  3. **문제 해결 기록 형식** — 표 한 줄 요약에 더해 `증상 → 확인한 것(로그·오류 코드) → 원인 → 해결 → 재발 방지` 순서로 `TROUBLESHOOTING.md`나 PRD 부록에 적으면, 원인을 찾아간 과정이 드러나 학습 기록으로서 가치가 커집니다.
  4. **실행 화면 캡처 추가 권장** — ① 로그인 화면, ② 로그인 후 목록(기한 지남·오늘 마감·D-n 배지가 보이게), ③ 사용자 B로 로그인 시 A의 항목이 안 보이는 화면, ④ `permission denied` 오류 화면(재현 가능하다면)을 README에 넣으면 리뷰어가 Supabase 모드를 직접 실행하지 않아도 동작을 확인할 수 있습니다.

# 참고 링크 및 코드 개선

## 1. 리뷰 시 참고한 링크
- [SiteOps-Checklist 저장소 (fork)](https://github.com/crystalmoon74/SiteOps-Checklist) — 리뷰 대상 코드, README, PRD, 커밋 이력
- [배포 사이트](https://siteops-checklist.vercel.app) — 접속 및 비로그인 401 응답 확인
- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — RLS 정책, `(select auth.uid())` 성능 권장 방식 확인
- [Supabase — API Keys (publishable / secret)](https://supabase.com/docs/guides/api/api-keys) — publishable 키를 브라우저에 노출해도 되는 이유
- [Express 5 — Error Handling](https://expressjs.com/en/guide/error-handling.html) — async 핸들러의 오류 자동 전달
- [OWASP Cheat Sheet — Input Validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html) — 타입 검증 권장
- [Node.js — `node:test`](https://nodejs.org/api/test.html) — 설치 없이 쓰는 테스트 러너

## 2. 코드 개선 제안

**① 입력 타입 검증 강화** (`server.js:55-78`)
- 개선 이유: 문자열 `"false"`가 완료로 저장되고, 객체가 `[object Object]` 제목으로 저장되는 것을 테스트로 확인했습니다.
- 권장 수정 방법:
  ```js
  if (!partial || has('title')) {
    if (typeof body.title !== 'string') throw new HttpError(400, '제목은 문자열이어야 합니다.');
    const title = body.title.trim();
    if (title.length < 1 || title.length > 100) throw new HttpError(400, '제목은 1~100자로 입력해 주세요.');
    out.title = title;
  }
  if (has('memo')) {
    const memo = String(body.memo ?? '').trim();
    if (memo.length > 1000) throw new HttpError(400, '메모는 1000자 이하로 입력해 주세요.');
    out.memo = memo || null;
  }
  if (has('is_done')) {
    if (typeof body.is_done !== 'boolean') throw new HttpError(400, 'is_done은 true 또는 false여야 합니다.');
    out.is_done = body.is_done ? 1 : 0;
  }
  ```

**② SQLite 모드는 내 컴퓨터에서만 접속** (`server.js:184`)
- 개선 이유: 로그인이 없는 모드인데 같은 네트워크의 누구나 API로 데이터를 지울 수 있습니다.
- 권장 수정 방법:
  ```js
  const HOST = process.env.HOST ?? (store.auth ? '0.0.0.0' : '127.0.0.1');
  app.listen(PORT, HOST, () => { ... });
  ```

**③ 보안 헤더와 요청 횟수 제한** (`server.js:89-91`)
- 개선 이유: 배포 사이트에 기본 보안 헤더가 없고, API를 반복 호출하는 것을 막지 않습니다.
- 권장 수정 방법: `npm install helmet express-rate-limit` 후
  ```js
  app.use(helmet({ contentSecurityPolicy: { directives: {
    scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
    connectSrc: ["'self'", process.env.SUPABASE_URL ?? "'self'"],
  } } }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120 }));
  ```
  (CSP는 Google 로그인 리디렉션과 Supabase 주소를 허용해야 하므로 적용 후 로그인 흐름을 꼭 다시 테스트하세요.)

**④ 자동 API 테스트 추가** (새 파일 `test/api.test.js`)
- 개선 이유: 지금은 테스트가 PRD의 표로만 남아 있어, 코드를 고칠 때마다 수동으로 다시 확인해야 합니다.
- 권장 수정 방법: `server.js`가 이미 `app`을 export 하므로, 메모리 DB로 띄워 바로 검사할 수 있습니다. 먼저 `server.js:176`을 `if (!ON_VERCEL && !process.env.NO_LISTEN)`으로 바꿔 테스트에서는 서버가 스스로 listen하지 않게 합니다. (`VERCEL=1`을 쓰면 `server.js:17`이 SQLite를 막기 때문에 별도 플래그가 필요합니다.)
  ```js
  // package.json: "test": "node --test"
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  process.env.NO_LISTEN = '1';
  process.env.DB_DRIVER = 'sqlite';
  process.env.DB_PATH = ':memory:';
  const { default: app } = await import('../server.js');
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}/api`;

  test('빈 제목은 400', async () => {
    const res = await fetch(`${base}/todos`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: ' ' }) });
    assert.equal(res.status, 400);
  });
  test.after(() => server.close());
  ```

**⑤ `claim.sql` 대상 계정 명시** (`supabase/claim.sql:5-11`)
- 개선 이유: "가장 먼저 가입한 계정"은 앱 공개 후 다른 사람일 수 있습니다.
- 권장 수정 방법: `(select id from auth.users where email = 'me@example.com')`처럼 이메일로 지정하고, 파일 상단에 바꿔야 할 값을 주석으로 안내합니다.

# 총평

- **프로젝트의 주요 장점**
  - 과제 요구(CRUD + 추가 기능 2개)를 넘어 SQLite ↔ Supabase 전환, Google 로그인, 사용자별 데이터 분리, Vercel 배포, 로컬 Docker 실행까지 단계적으로(v1.0 → v2.1) 확장했습니다.
  - SQLite 모드에서 직접 실행한 API 테스트 29건 중 27건이 의도대로 동작했고, 나머지 2건도 화면에서는 발생하지 않는 API 직접 호출 시의 타입 문제입니다.
  - README · PRD가 매우 충실해서, 리뷰어가 처음 보는 코드인데도 실행 방법 · API · DB 구조 · 테스트 결과를 바로 파악할 수 있었습니다.
- **배울 만한 구현 방식**
  - "권한은 서버가 아니라 DB(RLS)가 최종 결정한다"는 설계 — secret 키 없이 사용자 토큰으로 접속하고, `with check`로 남의 사이트 연결까지 막은 정책은 그대로 참고할 만합니다.
  - 저장소 인터페이스를 맞춰 화면 코드를 저장소와 분리한 구조, 서버 검증 + DB 제약 조건의 이중 검증.
  - DB 오류 코드를 사용자가 이해할 수 있는 한국어 메시지로 바꾸는 `toError()` — 겪은 오류를 코드로 남긴 좋은 사례입니다.
- **우선적으로 개선하면 좋을 사항** (중요도 순)
  1. 입력 타입 검증 강화 (`is_done`, `title`, `memo` 길이) — 테스트로 확인된 실제 결함
  2. 자동 테스트(`node:test`) 추가 및 PGlite RLS 테스트 스크립트 저장소 포함 — 기록을 재현 가능하게
  3. SQLite 모드 `127.0.0.1` 바인딩, 배포 사이트 보안 헤더·요청 제한
- **리뷰어의 종합 의견**
  - AI Agent와 함께 개발하면서도 범위 원칙(PRD)으로 Agent의 작업 범위를 정하고, 버전마다 테스트 결과와 문제 해결을 기록한 점이 인상적이었습니다. 보안 설계는 교육 과정 프로젝트로서 매우 높은 수준입니다. 위 개선점은 대부분 몇 줄 수정으로 해결되는 내용이며, 자동 테스트를 더하면 지금의 꼼꼼한 문서가 "실행해서 증명되는 기록"이 될 것입니다.
  - 리뷰어 환경에서 Supabase 모드 · Google 로그인 · 사용자 간 데이터 분리는 직접 확인하지 못했으므로, 해당 부분은 PRD 기록을 근거로 한 **확인 필요** 항목으로 남깁니다.

---

### 개발자에게 드리는 질문
1. PRD의 PGlite RLS 테스트(사용자 A·B 분리, 위장 추가 거부)는 어떤 스크립트로 실행하셨나요? 저장소에 함께 올려 주시면 리뷰어도 재현해 보고 싶습니다.
2. 배포 사이트는 v2.1에서 클라우드 Supabase를 일시정지했다고 되어 있는데(`PRD.md:11`), 현재 배포 사이트에서 로그인 후 기능이 동작하나요? 아니면 로컬 Docker 실행만 유지하실 계획인가요?
