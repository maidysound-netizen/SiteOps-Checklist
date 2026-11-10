# SiteOps Checklist

웹사이트 운영 점검 항목(SSL 인증서, 도메인 갱신, 백업 등)을 관리하는 Todo 앱입니다. 누구나 무료로 쓸 수 있고, 휴대폰·PC에 앱(PWA)으로 설치할 수 있습니다. 학교 과제(To Do App)로 시작했습니다. (v4.1)

**배포 주소: https://siteops-checklist.vercel.app** (Vercel + Turso, Google 로그인)

- 기본 기능: 점검 항목 추가 · 조회 · 수정 · 삭제, 완료 체크
- 추가 기능: **카테고리**(보안·배포·백업·DNS·콘텐츠) 지정과 필터, **마감일** 지정과 기한 지남·오늘 마감·D-n 표시, 마감일순 정렬, 사이트별 분류
- 확장 기능: **Google 로그인** — 사람마다 자기 사이트·점검 항목만 보고 관리 (Turso 모드)
- 저장소: 로컬 SQLite 파일 (`db/siteops.db`, 로그인 없음) 또는 Turso(클라우드 SQLite)
- 로그인 구조: **Google 로그인을 서버가 직접 처리**하고(별도 로그인 서비스 없음), 로그인 상태는 서명한 HttpOnly 쿠키에만 둡니다. 브라우저에는 DB 주소·토큰·Client Secret이 없습니다.
- **앱 설치**: 머리글의 📲 앱 설치 버튼, 또는 [설치 안내](https://siteops-checklist.vercel.app/install.html) (아이폰·안드로이드·윈도우·맥)
- **서비스 탈퇴**: 화면 맨 아래 버튼으로 계정과 모든 데이터를 즉시 삭제 ([개인정보처리방침](https://siteops-checklist.vercel.app/privacy.html))
- 보안: 보안 헤더(CSP·다른 사이트에 끼워 넣기 금지), IP별 요청 횟수 제한(초과 시 429), 로그인 쿠키 7일(쓰는 동안 자동 연장), **모든 기기에서 로그아웃**
- 처음 가입하면 예시 사이트 2개·점검 항목 4개가 들어 있어 바로 써 볼 수 있습니다. (개인 정보 없는 일반 예시)

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
- CLI는 클라우드(Turso)에 접속하지 않습니다. 인증 정보도 쓰지 않습니다.

## 테스트

```bash
npm test
```

Node 내장 `node:test`로 [`test/`](test) 폴더의 테스트(API, CLI, Turso 저장소, Google 로그인)를 실행합니다. 메모리 SQLite·libSQL DB와 가짜 Google 토큰 서버로 서버를 띄워 실제 HTTP 요청을 보내므로 설치할 것도, 지워질 데이터도 없습니다.
추가·조회·수정·삭제, 필터·정렬, 입력 검증(제목·메모 길이와 타입, `is_done`은 true/false만, 날짜 형식), 사이트 추가·중복, CSRF 헤더 검사, 화면 코드에 키가 없는지, Google 로그인(state·PKCE, 토큰 교환, 다른 앱·만료 토큰 거부, 위조 쿠키 401), 사용자 분리(남의 항목 조회·수정·삭제 불가, 남의 사이트에 연결 불가)를 확인합니다.

## Turso + Google 로그인으로 실행하기 (배포용)

기본 저장소는 SQLite(로그인 없음)입니다. `.env`만 바꾸면 같은 화면·API가 Turso(클라우드 SQLite)에 저장되고, Google 로그인 후 사람마다 자기 데이터만 보게 됩니다. 테이블은 서버가 처음 요청을 받을 때 [`db/turso.sql`](db/turso.sql)로 자동으로 만듭니다.

1. [turso.tech](https://turso.tech)에서 데이터베이스를 만들고 **URL**(`libsql://...`)과 **토큰**을 받습니다.
2. [Google Cloud Console](https://console.cloud.google.com) → Google 인증 플랫폼 → **클라이언트**(웹 애플리케이션) → 승인된 리디렉션 URI에 추가:
   - `http://localhost:3000/auth/callback`
   - `https://<배포 주소>/auth/callback`
3. `.env.example`을 `.env`로 복사하고 값을 채웁니다. (Vercel이면 같은 값을 프로젝트 환경 변수에)
   ```
   DB_DRIVER=turso
   TURSO_DATABASE_URL=libsql://...
   TURSO_AUTH_TOKEN=...
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   SESSION_SECRET=<32자 이상 무작위 문자열>
   ```
4. `npm start` → 브라우저에서 **Google로 로그인**.

로그인 흐름

```
브라우저 ──/auth/google──▶ 서버: state·PKCE verifier를 서명한 HttpOnly 쿠키에 저장 ──▶ Google 로그인 화면
브라우저 ◀─/auth/callback── 서버: state 확인 → code+verifier+Client Secret으로 Google에서 토큰 교환
                             → id_token 확인(발급자·대상·만료) → users 테이블에 저장 → 서명한 세션 쿠키(sid) 발급
브라우저 ──/api/...(쿠키 자동 전송)──▶ 서버: 쿠키 서명 확인 → 모든 쿼리를 그 사용자의 user_id로만 실행
```

보안 메모

- **브라우저에는 비밀 값이 없습니다.** 화면(`public/app.js`)은 우리 서버의 `/api`, `/auth`만 호출합니다. Turso 토큰·Google Client Secret·SESSION_SECRET은 서버 환경 변수에만 있습니다.
- 세션 쿠키는 HttpOnly(JS가 못 읽음)·SameSite=Lax·배포 시 Secure이고, SESSION_SECRET으로 서명해 위조하면 401입니다.
- 쓰기 요청은 `X-Requested-With: fetch` 헤더가 있어야 받습니다 (CSRF 방어).
- 사용자 분리는 서버 쿼리의 `user_id` 조건이 맡고, 남의 사이트에 항목을 붙이는 것은 DB 트리거가 한 번 더 막습니다.
- Turso는 UTC로 동작하므로 마감·완료 시각은 한국 시간(`+9 hours`)으로 계산합니다.

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
│   ├── store-turso.js     Turso 저장소 (모든 쿼리를 로그인한 사용자 user_id로)
│   ├── google-auth.js     서버 Google 로그인 (OAuth + PKCE, 서명한 HttpOnly 세션 쿠키)
│   ├── examples.js        처음 가입한 사람에게 넣는 예시 데이터
│   ├── security.js        보안 헤더 · IP별 요청 횟수 제한
│   └── errors.js          공통 오류
├── db/
│   ├── schema.sql    테이블 · 인덱스 · 트리거 · 뷰 (로컬 SQLite)
│   ├── seed.sql      예시 데이터 (로컬 SQLite)
│   └── turso.sql     Turso 버전: users 테이블 + user_id + 사이트 주인 확인 트리거 + 한국 시간
├── test/             자동 테스트 (API, CLI, Turso 저장소, Google 로그인)
└── public/
    ├── index.html    화면
    ├── app.js        화면 동작 (우리 서버 API만 호출, 키 없음)
    ├── style.css     스타일 (다크 모드 · 모바일 대응)
    ├── install.html  기기별 앱 설치 안내 (+ install.js)
    ├── privacy.html  개인정보처리방침
    ├── sw.js         서비스 워커 (화면 파일만 저장, API는 저장 안 함)
    └── manifest.webmanifest, icon-*.png  PWA 설치 정보·아이콘
```

## DB 구조

```
sites (1) ──< todos >── (1) categories
```

| 테이블 | 설명 |
| --- | --- |
| `todos` | 점검 항목: 제목, 메모, 사이트, 카테고리, 마감일, 완료 여부, 완료 시각 (Turso: 사용자별) |
| `categories` | 점검 분류와 배지 색상 |
| `sites` | 관리 대상 사이트 (Turso: 사용자별) |
| `users` | Google 로그인 사용자 (Turso 모드만) |
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
| DELETE | `/api/sites/:id` | 사이트 빼기 (그 사이트의 항목은 "사이트 없음"으로 남음) |
| GET | `/api/summary` | 전체 / 미완료 / 완료 / 기한 지남 개수 |
| GET | `/api/me` | 로그인 여부와 내 이메일 (화면용) |
| DELETE | `/api/me` | 서비스 탈퇴: 내 계정·사이트·항목 모두 삭제 (Turso 모드만) |
| POST | `/api/logout-all` | 모든 기기에서 로그아웃: 내 예전 로그인 쿠키 전부 무효 (Turso 모드만) |
| GET | `/auth/google` | Google 로그인 시작 (Turso 모드) |
| GET | `/auth/callback` | 로그인 후 돌아오는 주소, 토큰을 쿠키에 저장 |
| POST | `/auth/logout` | 로그아웃 (쿠키 삭제) |

Turso 모드에서는 로그인 쿠키가 없으면 `/api/*`가 401을 돌려줍니다.

