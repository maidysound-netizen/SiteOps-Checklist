# SiteOps Checklist

개인 웹사이트 운영 점검 항목을 관리하는 Todo 앱입니다. (학교 과제 — To Do App)

**배포 주소: https://siteops-checklist.vercel.app** (Vercel + Supabase)

- 기본 기능: 점검 항목 추가 · 조회 · 수정 · 삭제, 완료 체크
- 추가 기능: **카테고리**(보안·배포·백업·DNS·콘텐츠) 지정과 필터, **마감일** 지정과 기한 지남·오늘 마감·D-n 표시, 마감일순 정렬
- 저장소: 로컬 SQLite 파일 (`db/siteops.db`)

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

## Supabase로 전환하기 (선택)

기본 저장소는 SQLite입니다. `.env` 설정만 바꾸면 같은 화면·API가 Supabase(Postgres)에 저장됩니다.

1. [supabase.com](https://supabase.com)에서 GitHub 계정으로 로그인하고 **새 프로젝트**를 만듭니다.
2. 대시보드 **SQL Editor**에 [`supabase/setup.sql`](supabase/setup.sql) 내용을 붙여넣고 **Run** 합니다. (테이블 · 트리거 · 뷰 · RLS · 예시 데이터, 여러 번 실행해도 안전)
3. `.env.example`을 `.env`로 복사하고 값을 채웁니다.
   ```
   DB_DRIVER=supabase
   SUPABASE_URL=https://<프로젝트 ID>.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_...
   ```
4. `npm start` — 터미널에 `DB: Supabase (...)`가 보이면 연결된 것입니다.

보안 메모

- `permission denied for table ...` 오류가 나면 `setup.sql`의 `grant ... to service_role` 부분이 실행됐는지 확인하세요. (최근 Supabase 프로젝트는 테이블 권한을 자동으로 주지 않습니다)
- 세 테이블 모두 RLS를 켜고 정책은 만들지 않았습니다. 공개 키(anon/publishable)로는 읽기·쓰기가 모두 막히고, secret 키를 가진 서버만 접근합니다.
- secret 키는 `.env`에만 두며 `.gitignore`로 GitHub에 올라가지 않습니다. 브라우저 코드(`public/`)에는 키가 없습니다.
- 다시 SQLite로 돌아가려면 `.env`에서 `DB_DRIVER=sqlite`로 바꿉니다.

## 폴더 구조

```
todo-assignment/
├── PRD.md            기획 문서
├── server.js         Express 서버 + REST API (입력 검증, 저장소 선택)
├── .env.example      환경 변수 예시 (복사해서 .env로 사용)
├── lib/
│   ├── store-sqlite.js    SQLite 저장소
│   ├── store-supabase.js  Supabase 저장소
│   └── errors.js          공통 오류
├── db/
│   ├── schema.sql    테이블 · 인덱스 · 트리거 · 뷰 (SQLite)
│   └── seed.sql      예시 데이터
├── supabase/
│   └── setup.sql     같은 구조의 Postgres 버전 + RLS + 예시 데이터
└── public/
    ├── index.html    화면
    ├── app.js        화면 동작 (fetch로 API 호출)
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
| GET | `/api/summary` | 전체 / 미완료 / 완료 / 기한 지남 개수 |
