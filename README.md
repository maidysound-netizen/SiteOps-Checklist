# SiteOps Checklist

개인 웹사이트 운영 점검 항목을 관리하는 Todo 앱입니다. (학교 과제 — To Do App)

> 과제가 끝나 클라우드 배포(Vercel + Supabase)는 종료했습니다 (v2.3). 지금은 **내 컴퓨터에서만** 실행합니다.
> 저장소는 SQLite(기본) 또는 로컬 Docker Supabase(Google 로그인)입니다.

- 기본 기능: 점검 항목 추가 · 조회 · 수정 · 삭제, 완료 체크
- 추가 기능: **카테고리**(보안·배포·백업·DNS·콘텐츠) 지정과 필터, **마감일** 지정과 기한 지남·오늘 마감·D-n 표시, 마감일순 정렬
- 확장 기능: **Google 로그인** — 사람마다 자기 사이트·점검 항목만 보고 관리 (Supabase 모드)
- 저장소: 로컬 SQLite 파일 (`db/siteops.db`, 로그인 없음) 또는 Supabase

자세한 기획은 [PRD.md](PRD.md)에 있습니다.

## 실행 방법

Node.js 22.13 이상이 필요합니다. 별도 DB 설치 없이 Node 내장 `node:sqlite`를 사용합니다.

```bash
npm install
npm start
```

브라우저에서 http://localhost:3000 을 엽니다.

- 처음 실행하면 `db/siteops.db`가 만들어지고 예시 데이터가 들어갑니다.
- 서버를 껐다 켜도 데이터는 그대로 남습니다.
- 처음 상태로 되돌리려면 서버를 끄고 `npm run db:reset` 후 다시 `npm start` 합니다.
- 포트를 바꾸려면 `PORT=4000 npm start`.

## 테스트

```bash
npm test
```

Node 내장 `node:test`로 [`test/api.test.js`](test/api.test.js)를 실행합니다. 메모리 SQLite DB로 서버를 띄워 실제 HTTP 요청을 보내므로 설치할 것도, 지워질 데이터도 없습니다.
추가·조회·수정·삭제, 필터·정렬, 입력 검증(제목·메모 길이와 타입, `is_done`은 true/false만, 날짜 형식), 사이트 추가·중복을 확인합니다.

## Supabase + Google 로그인으로 전환하기 (선택)

지금은 아래 [로컬 Docker로 실행하기](#로컬-docker로-실행하기-서버-비용-없음)를 씁니다. 이 절은 클라우드 Supabase에 다시 올릴 때를 위한 기록입니다.

기본 저장소는 SQLite(로그인 없음)입니다. `.env` 설정만 바꾸면 같은 화면·API가 Supabase(Postgres)에 저장되고, Google 로그인 후 사람마다 자기 데이터만 보게 됩니다.

1. [supabase.com](https://supabase.com)에서 **새 프로젝트**를 만듭니다.
2. 대시보드 **SQL Editor**에 [`supabase/setup.sql`](supabase/setup.sql) 내용을 붙여넣고 **Run** 합니다. (테이블 · 트리거 · 뷰 · RLS 정책 · 카테고리, 여러 번 실행해도 안전)
3. Google 로그인 설정
   - [Google Cloud Console](https://console.cloud.google.com) → Google 인증 플랫폼에서 OAuth 동의 화면(외부)을 만들고, **웹 애플리케이션** 클라이언트를 만듭니다. 승인된 리디렉션 URI: `https://<프로젝트 ID>.supabase.co/auth/v1/callback`
   - Supabase → Authentication → **Sign In / Providers → Google**을 켜고 Client ID·Client Secret을 넣습니다.
   - Supabase → Authentication → **URL Configuration**: Site URL에 배포 주소, Redirect URLs에 `https://<배포 주소>/**`, `http://localhost:3000/**`
   - 다른 사람도 로그인하게 하려면 Google 인증 플랫폼 → 대상 → **앱 게시**
4. `.env.example`을 `.env`로 복사하고 값을 채웁니다. (Vercel이면 같은 값을 환경 변수에)
   ```
   DB_DRIVER=supabase
   SUPABASE_URL=https://<프로젝트 ID>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
5. `npm start` → 브라우저에서 **Google로 로그인**.
6. (v1에서 업그레이드한 경우만) 처음 로그인한 뒤 [`supabase/claim.sql`](supabase/claim.sql)을 SQL Editor에서 한 번 실행하면 예전 데이터가 내 계정으로 옮겨집니다.

보안 메모

- 앱은 **secret 키를 쓰지 않습니다.** publishable 키는 브라우저에 내려가도 되는 공개용 키이고, 실제 권한은 로그인 토큰 + RLS 정책(`user_id = auth.uid()`)이 정합니다. 서버 코드에 실수가 있어도 DB가 남의 데이터를 막습니다.
- 로그인하지 않은 요청은 서버에서 401, DB에서도 권한 없음으로 막힙니다.
- `permission denied for table ...` 오류가 나면 `setup.sql`의 `grant ... to authenticated` 부분이 실행됐는지 확인하세요.
- Google Client Secret은 클라우드에서는 Supabase 대시보드에만, 로컬 Docker에서는 git에 올라가지 않는 `supabase/.env`에만 둡니다. 코드·루트 `.env`에는 넣지 않습니다.
- 다시 SQLite로 돌아가려면 `.env`에서 `DB_DRIVER=sqlite`로 바꿉니다.

## 로컬 Docker로 실행하기 (서버 비용 없음)

클라우드 Supabase 대신 내 컴퓨터의 Docker에서 Supabase(Postgres + 로그인)를 띄웁니다. 설정은 [`supabase/config.toml`](supabase/config.toml)에 있고, 필요 없는 서비스(Realtime·Storage 등)는 꺼 두었습니다.

준비 (처음 한 번)

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/)을 설치하고 켭니다.
2. `npm install` (Supabase CLI가 함께 설치됩니다)
3. Google Cloud Console → OAuth 클라이언트의 승인된 리디렉션 URI에 `http://localhost:54321/auth/v1/callback`을 추가합니다.
4. `supabase/.env.example`을 `supabase/.env`로 복사하고 `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=`에 Google Client Secret을 넣습니다.
5. `npm run db:start` → 처음 실행이면 [`supabase/setup.sql`](supabase/setup.sql)을 로컬 DB에 넣습니다.
   ```
   docker exec -i supabase_db_todo-assignment psql -U postgres < supabase/setup.sql
   ```
6. 루트 `.env`를 로컬 주소로 맞춥니다. publishable 키는 `npm run db:start` 출력에 나오는 로컬 전용 키입니다.
   ```
   DB_DRIVER=supabase
   SUPABASE_URL=http://localhost:54321
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

매번 실행

```
npm run db:start   # Docker Desktop이 켜져 있어야 함
npm start          # http://localhost:3000
npm run db:stop    # 끝낼 때 (데이터는 유지)
```

- 로컬 관리 화면(Studio): http://localhost:54323
- 다른 DB에서 옮겨 온 v1 데이터는 첫 로그인 후 `docker exec -i supabase_db_todo-assignment psql -U postgres < supabase/claim.sql`로 내 계정에 붙입니다.
- Secret을 바꾼 뒤에는 `npm run db:stop && npm run db:start`로 다시 켜야 적용됩니다.

## 폴더 구조

```
todo-assignment/
├── PRD.md            기획 문서
├── server.js         Express 서버 + REST API (입력 검증, 저장소 선택)
├── .env.example      환경 변수 예시 (복사해서 .env로 사용)
├── lib/
│   ├── store-sqlite.js    SQLite 저장소
│   ├── store-supabase.js  Supabase 저장소 (로그인한 사용자 권한으로 접속)
│   └── errors.js          공통 오류
├── db/
│   ├── schema.sql    테이블 · 인덱스 · 트리거 · 뷰 (SQLite)
│   └── seed.sql      예시 데이터
├── supabase/
│   ├── setup.sql     같은 구조의 Postgres 버전 + 사용자별 RLS 정책 + 카테고리
│   └── claim.sql     v1 데이터를 내 계정으로 옮기기 (업그레이드 시 한 번)
└── public/
    ├── index.html    화면
    ├── app.js        화면 동작 (fetch로 API 호출, Google 로그인)
    └── style.css     스타일 (다크 모드 · 모바일 대응)
```

## DB 구조

```
sites (1) ──< todos >── (1) categories
```

| 테이블 | 설명 |
| --- | --- |
| `todos` | 점검 항목: 제목, 메모, 사이트, 카테고리, 마감일, 완료 여부, 완료 시각 (Supabase: 사용자별) |
| `categories` | 점검 분류와 배지 색상 |
| `sites` | 관리 대상 사이트 (Supabase: 사용자별) |
| `todo_list` (뷰) | 목록 화면용 — 이름 조인과 마감 상태(`overdue` / `today` / `upcoming`) 계산 |

## API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/todos?site=&category=&status=` | 목록 (`status`: `all` / `open` / `done` / `overdue`) |
| GET | `/api/todos/:id` | 단건 조회 |
| POST | `/api/todos` | 추가 (`title` 필수) |
| PATCH | `/api/todos/:id` | 수정 · 완료 토글 (`{"is_done": true}`) |
| DELETE | `/api/todos/:id` | 삭제 |
| GET | `/api/categories` | 카테고리 목록 |
| GET | `/api/sites` | 사이트 목록 |
| POST | `/api/sites` | 사이트 추가 (`name` 필수, `url` 선택) |
| GET | `/api/config` | 로그인 모드 여부 (화면용) |
| GET | `/api/summary` | 전체 / 미완료 / 완료 / 기한 지남 개수 |

Supabase 모드에서는 `/api/config`를 뺀 모든 API에 로그인 토큰(`Authorization: Bearer ...`)이 필요합니다.
