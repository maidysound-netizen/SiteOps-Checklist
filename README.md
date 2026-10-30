# SiteOps Checklist

개인 웹사이트 운영 점검 항목을 관리하는 Todo 앱입니다. 학교 과제(To Do App)로 만들었고, 과제가 끝난 지금은 **나 혼자 내 컴퓨터에서** 씁니다. (v3.0)

- 기본 기능: 점검 항목 추가 · 조회 · 수정 · 삭제, 완료 체크
- 추가 기능: **카테고리**(보안·배포·백업·DNS·콘텐츠) 지정과 필터, **마감일** 지정과 기한 지남·오늘 마감·D-n 표시, 마감일순 정렬, 사이트별 분류
- 저장소: 로컬 SQLite 파일 (`db/siteops.db`), 로그인 없음
- 과제 기간에는 Supabase + Google 로그인 + Vercel 배포까지 했습니다. 그 기록은 [PRD.md](PRD.md)와 git 기록(`v2.3` 커밋까지)에 남아 있습니다.

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

## 테스트

```bash
npm test
```

Node 내장 `node:test`로 [`test/api.test.js`](test/api.test.js)를 실행합니다. 메모리 SQLite DB로 서버를 띄워 실제 HTTP 요청을 보내므로 설치할 것도, 지워질 데이터도 없습니다.
추가·조회·수정·삭제, 필터·정렬, 입력 검증(제목·메모 길이와 타입, `is_done`은 true/false만, 날짜 형식), 사이트 추가·중복을 확인합니다.

## 폴더 구조

```
todo-assignment/
├── PRD.md            기획 문서 (과제 기간 기록 포함)
├── server.js         Express 서버 + REST API (입력 검증)
├── .env.example      환경 변수 예시 (포트·DB 위치, 없어도 됨)
├── lib/
│   ├── store-sqlite.js    SQLite 저장소
│   └── errors.js          공통 오류
├── db/
│   ├── schema.sql    테이블 · 인덱스 · 트리거 · 뷰
│   └── seed.sql      예시 데이터
├── test/api.test.js  자동 테스트
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
| POST | `/api/sites` | 사이트 추가 (`name` 필수, `url` 선택) |
| GET | `/api/summary` | 전체 / 미완료 / 완료 / 기한 지남 개수 |

