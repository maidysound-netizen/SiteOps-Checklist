# SiteOps Checklist

개인 웹사이트 운영 점검 항목을 관리하는 Todo 앱입니다. 학교 과제(To Do App)로 만들었습니다. (v3.1)

**배포 주소: https://siteops-checklist.vercel.app** (Vercel + Supabase, Google 로그인)

- 기본 기능: 점검 항목 추가 · 조회 · 수정 · 삭제, 완료 체크
- 추가 기능: **카테고리**(보안·배포·백업·DNS·콘텐츠) 지정과 필터, **마감일** 지정과 기한 지남·오늘 마감·D-n 표시, 마감일순 정렬, 사이트별 분류
- 확장 기능: **Google 로그인** — 사람마다 자기 사이트·점검 항목만 보고 관리 (Supabase 모드)
- 저장소: 로컬 SQLite 파일 (`db/siteops.db`, 로그인 없음) 또는 Supabase
- 로그인 구조 (v3.1): **로그인은 서버가 처리**하고, 토큰은 JS가 읽을 수 없는 HttpOnly 쿠키에만 둡니다. 브라우저에는 Supabase 주소·키·토큰이 없습니다.

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
- 서버는 `127.0.0.1`에서만 열려서 같은 와이파이의 다른 기기에서는 접속할 수 없습니다.

## 명령줄(CLI) — AI가 쓰는 입구 (v3.2)

웹 화면과 같은 로컬 SQLite(`db/siteops.db`)를 터미널에서 다룹니다. AI 도구(Claude Code 등)가 이 명령을 직접 실행해 할 일 데이터를 읽습니다.

```bash
node cli.js list               # 목록
node cli.js add "우유 사기"     # 추가
node cli.js done 5             # 완료
node cli.js summary            # 오늘 완료 요약
```

- 사용법은 [`AGENTS.md`](AGENTS.md)(규칙 파일)에 있고, [`CLAUDE.md`](CLAUDE.md)가 `@AGENTS.md`로 불러옵니다.
- 반복 작업 스킬: [`.claude/skills/todo-summary/SKILL.md`](.claude/skills/todo-summary/SKILL.md) — 오늘 완료한 항목을 커밋 메시지 형식으로 요약.
- CLI는 클라우드(Supabase)에 접속하지 않습니다. 인증 정보도 쓰지 않습니다.

## 테스트

```bash
npm test
```

Node 내장 `node:test`로 [`test/api.test.js`](test/api.test.js), [`test/auth.test.js`](test/auth.test.js), [`test/cli.test.js`](test/cli.test.js)를 실행합니다. 메모리 SQLite DB로 서버를 띄워 실제 HTTP 요청을 보내므로 설치할 것도, 지워질 데이터도 없습니다.
추가·조회·수정·삭제, 필터·정렬, 입력 검증(제목·메모 길이와 타입, `is_done`은 true/false만, 날짜 형식), 사이트 추가·중복, CSRF 헤더 검사, 화면 코드에 키가 없는지, 서버 로그인(PKCE 쿠키·리디렉션·토큰 없으면 401)을 확인합니다.

## Supabase + Google 로그인으로 실행하기 (선택)

기본 저장소는 SQLite(로그인 없음)입니다. `.env` 설정만 바꾸면 같은 화면·API가 Supabase(Postgres)에 저장되고, Google 로그인 후 사람마다 자기 데이터만 보게 됩니다.

1. [supabase.com](https://supabase.com)에서 프로젝트를 만들거나, 일시정지한 프로젝트를 **Restore** 합니다.
2. (새 프로젝트만) 대시보드 **SQL Editor**에 [`supabase/setup.sql`](supabase/setup.sql) 내용을 붙여넣고 **Run** 합니다. (여러 번 실행해도 안전)
3. Google 로그인 설정
   - [Google Cloud Console](https://console.cloud.google.com) → Google 인증 플랫폼에서 **웹 애플리케이션** 클라이언트를 만듭니다. 승인된 리디렉션 URI: `https://<프로젝트 ID>.supabase.co/auth/v1/callback`
   - Supabase → Authentication → **Sign In / Providers → Google**을 켜고 Client ID·Client Secret을 넣습니다.
   - Supabase → Authentication → **URL Configuration** → Redirect URLs에 `http://localhost:3000/**` (배포하면 `https://<배포 주소>/**`도)
4. `.env.example`을 `.env`로 복사하고 값을 채웁니다.
   ```
   DB_DRIVER=supabase
   SUPABASE_URL=https://<프로젝트 ID>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
5. `npm start` → 브라우저에서 **Google로 로그인**.
6. (v1에서 업그레이드한 경우만) 처음 로그인한 뒤 [`supabase/claim.sql`](supabase/claim.sql)을 SQL Editor에서 한 번 실행하면 예전 데이터가 내 계정으로 옮겨집니다.

로그인 흐름

```
브라우저 ──/auth/google──▶ 서버: PKCE verifier를 HttpOnly 쿠키에 저장 ──▶ Supabase(Google) 로그인 화면
브라우저 ◀─/auth/callback── 서버: code + verifier → 토큰 교환, access·refresh 토큰을 HttpOnly 쿠키에 저장
브라우저 ──/api/...(쿠키 자동 전송)──▶ 서버: 쿠키의 토큰으로 Supabase 접속 → DB의 RLS가 자기 데이터만 허용
```

보안 메모

- **브라우저에는 키가 없습니다.** 화면(`public/app.js`)은 우리 서버의 `/api`, `/auth`만 호출합니다. publishable 키는 서버 `.env`에만 있습니다.
- **secret 키는 쓰지 않습니다.** 실제 권한은 로그인 토큰 + RLS 정책(`user_id = auth.uid()`)이 정합니다.
- 토큰은 HttpOnly 쿠키라 페이지의 JS(XSS)가 읽을 수 없습니다. 쿠키는 `SameSite=Lax`이고, 쓰기 요청은 `X-Requested-With: fetch` 헤더가 있어야 받습니다 (CSRF 방어).
- access 토큰이 만료되면 서버가 refresh 토큰으로 갱신하고, 실패하면 401 → 로그인 화면.
- Google Client Secret은 Supabase 대시보드에만 둡니다.

## 폴더 구조

```
todo-assignment/
├── PRD.md            기획 문서 (과제 기간 기록 포함)
├── AGENTS.md         AI용 규칙 파일 (CLI 사용법), CLAUDE.md가 불러옴
├── server.js         Express 서버 + REST API (입력 검증)
├── cli.js            명령줄 진입점 (list · add · done · summary)
├── .claude/skills/todo-summary/  오늘 완료 요약 스킬
├── .env.example      환경 변수 예시 (복사해서 .env로 사용)
├── lib/
│   ├── store-sqlite.js    SQLite 저장소
│   ├── store-supabase.js  Supabase 저장소 (로그인한 사용자 권한으로 접속)
│   ├── auth.js            서버 Google 로그인 (PKCE, HttpOnly 쿠키)
│   └── errors.js          공통 오류
├── db/
│   ├── schema.sql    테이블 · 인덱스 · 트리거 · 뷰
│   └── seed.sql      예시 데이터
├── supabase/
│   ├── setup.sql     같은 구조의 Postgres 버전 + 사용자별 RLS 정책 + 카테고리
│   └── claim.sql     v1 데이터를 내 계정으로 옮기기 (업그레이드 시 한 번)
├── test/             자동 테스트 (API, 서버 로그인)
└── public/
    ├── index.html    화면
    ├── app.js        화면 동작 (우리 서버 API만 호출, 키 없음)
    └── style.css     스타일 (다크 모드 · 모바일 대응)
```

## DB 구조

```
sites (1) ──< todos >── (1) categories
```

| 테이블 | 설명 |
| --- | --- |
| `todos` | 점검 항목: 제목, 메모, 사이트, 카테고리, 마감일, 완료 여부, 완료 시각 |
| `categories` | 점검 분류와 배지 색상 |
| `sites` | 관리 대상 사이트 |
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
| GET | `/api/summary` | 전체 / 미완료 / 완료 / 기한 지남 개수 |
| GET | `/api/me` | 로그인 여부와 내 이메일 (화면용) |
| GET | `/auth/google` | Google 로그인 시작 (Supabase 모드) |
| GET | `/auth/callback` | 로그인 후 돌아오는 주소, 토큰을 쿠키에 저장 |
| POST | `/auth/logout` | 로그아웃 (쿠키 삭제) |

Supabase 모드에서는 로그인 쿠키가 없으면 `/api/*`가 401을 돌려줍니다.

