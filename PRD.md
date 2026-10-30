# PRD — SiteOps Checklist

> 개인 웹사이트 운영 점검 관리 Todo 앱 (학교 과제: To Do App)

| 버전 | 날짜 | 내용 |
| --- | --- | --- |
| v1.0 | 2026-10-29 | 기본 CRUD + 카테고리 + 마감일, 로컬 SQLite 저장 |
| v1.1 | 2026-10-29 | Supabase(Postgres) 저장소 선택 기능 추가, RLS 적용 |
| v1.2 | 2026-10-29 | Vercel 배포 (https://siteops-checklist.vercel.app) |
| v2.0 | 2026-10-29 | Google 로그인(Supabase Auth) + 사용자별 데이터(RLS 정책), 사이트 추가 |
| v2.1 | 2026-10-30 | 서버 비용 문제로 클라우드 Supabase 일시정지 → 로컬 Docker(Supabase CLI)에서 실행 |
| v2.2 | 2026-10-30 | 파트너 코드 리뷰([Review.md](Review.md)) 반영: 입력 타입 검증, 메모 길이 제한, Supabase 요약을 DB에서 개수만 세기, 자동 테스트(`npm test`) |

## 1. 개요

| 항목 | 내용 |
| --- | --- |
| 제품명 | SiteOps Checklist |
| 한 줄 설명 | 여러 개인 사이트(GitHub, Vercel, Supabase, DNS, Blogger 등)의 운영 점검 항목을 등록하고 완료 여부를 추적하는 Todo 앱 |
| 사용자 | 배포 사이트: Google 계정으로 로그인한 누구나 (각자 자기 데이터만) / 로컬 SQLite: 본인 1명 (로그인 없음) |
| 배포 주소 | https://siteops-checklist.vercel.app (Vercel, Supabase 저장소) |
| 저장소 | 기본: 로컬 SQLite 파일 (`db/siteops.db`) / 선택: Supabase (`.env`에서 `DB_DRIVER=supabase`) |
| 기술 스택 | Node.js 22.13+ · Express 5 · `node:sqlite`(내장) · `@supabase/supabase-js` · HTML/CSS/JavaScript(프레임워크 없음) |
| 범위 원칙 | 사람이 직접 점검 결과를 등록·기록한다. 외부 서비스 API 연동, 기존 운영 저장소·Supabase 프로젝트 수정은 **하지 않는다**. Supabase는 이 앱 전용 **새 프로젝트**만 사용한다 |

## 2. 문제 정의

여러 서비스에 걸쳐 사이트를 운영하다 보면 "무엇을 점검했고, 무엇이 아직 남았는지"가 흩어진다.
사이트별·분류별로 점검 항목을 모아 두고, 마감일이 지난 항목을 바로 볼 수 있어야 한다.

## 3. 과제 요구사항 대응표

| 과제 요구 | SiteOps 구현 | 상태 |
| --- | --- | --- |
| Todo 추가 (Create) | 운영 점검 항목 등록 | 완료 |
| Todo 조회 (Read) | 전체 / 사이트별 / 카테고리별 / 상태별 점검 목록 | 완료 |
| Todo 수정 (Update) | 제목·메모·사이트·카테고리·마감일 수정, 완료 상태 토글 | 완료 |
| Todo 삭제 (Delete) | 확인창을 거쳐 항목 삭제 | 완료 |
| 추가 기능 1 — 카테고리 | 점검 분류(보안 / 배포 / 백업 / DNS / 콘텐츠), 색상 배지, 탭 필터 | 완료 |
| 추가 기능 2 — 마감일 | 기한 지정, 기한 지남·오늘 마감·D-n 표시, 마감일순 정렬 | 완료 |
| (보조) 사이트 분류 | 항목이 속한 사이트 지정, 사이트 필터 | 완료 |
| SQLite | 로컬 파일에 영구 저장 (재시작 후에도 유지) | 완료 |
| Supabase 연동 | 같은 API·화면을 Supabase(Postgres)에 저장 | 완료 |
| (확장) 로그인 | Google 로그인, 사용자별 사이트·점검 항목 분리 | 완료 |

## 4. 기능 요구사항

### 4.1 필수 — CRUD

| ID | 기능 | 상세 | 완료 기준 |
| --- | --- | --- | --- |
| F-01 | 항목 추가 | 제목(필수, 1~100자), 메모(1000자 이하), 사이트, 카테고리, 마감일 입력 후 등록. 타입이 맞지 않으면 400 (`is_done`은 true/false만) | 등록 즉시 목록에 표시되고 DB에 저장됨 |
| F-02 | 목록 조회 | 미완료 항목 먼저, 그 안에서 마감일 빠른 순(마감일 없는 항목은 뒤), 같으면 최근 등록 순 | 앱을 다시 열어도 같은 목록이 보임 |
| F-03 | 항목 수정 | 수정 창(dialog)에서 모든 입력값 수정, 기존 값 미리 채움 | 수정 후 `updated_at` 갱신 |
| F-04 | 완료 토글 | 체크박스로 완료 ↔ 미완료 | 완료 시 `completed_at` 기록, 해제 시 비움 |
| F-05 | 항목 삭제 | 삭제 전 확인창 | DB에서 행 삭제, 목록에서 사라짐 |

### 4.2 추가 기능 — 카테고리

| ID | 기능 | 상세 |
| --- | --- | --- |
| F-10 | 카테고리 선택 | 항목 등록·수정 시 카테고리 1개 선택 (선택 안 함 허용) |
| F-11 | 카테고리 필터 | 상단 탭: 전체 / 보안 / 배포 / 백업 / DNS / 콘텐츠 |
| F-12 | 카테고리 배지 | 각 항목에 카테고리 이름·색상 배지 표시 |

기본 카테고리는 예시 데이터로 제공한다. 카테고리 추가·삭제 화면은 범위 밖이다.

### 4.3 추가 기능 — 마감일

| ID | 기능 | 상세 |
| --- | --- | --- |
| F-20 | 마감일 지정 | 날짜 선택(`YYYY-MM-DD`), 비워 둘 수 있음 |
| F-21 | 마감 상태 표시 | 미완료 항목 중 `기한 지남`(빨강), `오늘 마감`(주황), `D-n` 표시 |
| F-22 | 마감일 정렬 | 기본 정렬에 마감일 반영 (F-02) |
| F-23 | 기한 지남 필터 | 상태 필터에서 `기한 지남`만 보기 |

마감 상태는 DB 뷰(`todo_list.due_status`)에서 계산한다. Supabase는 서버 시간대가 UTC이므로 `Asia/Seoul` 날짜 기준으로 계산한다.

### 4.4 대시보드 요약

| ID | 기능 | 상세 |
| --- | --- | --- |
| F-30 | 요약 카드 | 전체 / 미완료 / 완료 / 기한 지남 개수 |
| F-31 | 사이트·상태 필터 | 사이트 선택, 상태(모든 상태 / 미완료 / 완료 / 기한 지남) 선택, 카테고리 탭과 함께 사용 가능 |

### 4.5 저장소 선택 (v1.1)

| ID | 기능 | 상세 |
| --- | --- | --- |
| F-40 | SQLite 모드 | 기본값. 처음 실행 시 `db/siteops.db` 생성 + 예시 데이터 입력 |
| F-41 | Supabase 모드 | `.env`에 `DB_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` 설정 시 사용 (v2부터 로그인 필수) |
| F-42 | 시작 시 연결 확인 | Supabase 설정 누락·주소·키 오류면 이유를 출력하고 서버 시작 중단, Google 로그인이 꺼져 있으면 경고 |

두 모드는 같은 API 응답 형식을 돌려주므로 화면 코드(`public/`)는 저장소와 무관하다.

### 4.6 로그인과 사용자별 데이터 (v2.0, Supabase 모드)

| ID | 기능 | 상세 |
| --- | --- | --- |
| F-50 | Google 로그인 | 로그인하지 않으면 로그인 화면만 표시. 처음 로그인하면 자동 가입 (별도 가입 폼 없음) |
| F-51 | 로그아웃 | 오른쪽 위에 내 이메일과 로그아웃 버튼 |
| F-52 | 사용자별 데이터 | 점검 항목·사이트는 만든 사람만 조회·수정·삭제. 카테고리는 모두 공통 |
| F-53 | 사이트 추가 | "+ 사이트 추가"에서 이름(1~50자, 내 사이트 중 중복 불가)과 주소(선택, http/https) 입력 |
| F-54 | 기존 데이터 이전 | v1 데이터(주인 없음)를 처음 가입한 계정으로 옮기는 `supabase/claim.sql` |

로그인 흐름: 브라우저가 Supabase Auth로 Google 로그인(PKCE) → 받은 access token을 API 요청의 `Authorization: Bearer` 헤더로 보냄 → 서버는 그 토큰으로 Supabase에 접속 → DB의 RLS 정책이 `user_id = auth.uid()`인 행만 허용.

## 5. 비기능 요구사항

- **영구 저장**: 서버를 재시작해도 데이터가 유지된다.
- **입력 검증 (이중)**: 서버에서 먼저 검사하고, DB 제약 조건으로 한 번 더 막는다.
  - 제목: 앞뒤 공백 제거 후 1~100자
  - 마감일: `YYYY-MM-DD` 형식 + 실제 존재하는 날짜
  - 사이트·카테고리: 존재하는 ID만 허용 (외래 키)
- **SQL 인젝션 방지**: SQLite는 파라미터 바인딩(`?`), Supabase는 클라이언트 라이브러리의 쿼리 빌더만 사용한다. 수정 가능한 컬럼은 서버의 허용 목록으로 제한한다.
- **XSS 방지**: 화면에 사용자 입력을 넣을 때 `textContent`만 사용한다 (`innerHTML` 미사용).
- **키 관리 (v2)**: 앱은 secret 키를 쓰지 않고 공개용 publishable 키만 쓴다. 이 키는 브라우저에 내려가도 되는 키이며, 권한은 로그인 토큰과 RLS가 정한다. Google OAuth Client Secret은 Supabase 대시보드에만 저장한다.
- **사용자별 접근 제한 (RLS)**: `sites`·`todos`에 `user_id`(기본값 `auth.uid()`) 컬럼을 두고 정책 `user_id = auth.uid()`로 자기 행만 읽고 쓰게 한다. 항목에 붙이는 사이트도 내 사이트여야 한다. 로그인하지 않은 공개 키(anon)는 권한이 없어 모두 차단된다. 뷰는 `security_invoker`로 만들어 RLS를 우회하지 못하게 한다.
- **테이블 권한 (GRANT)**: 최근 Supabase 프로젝트는 SQL로 만든 테이블에 권한을 자동으로 주지 않으므로, `setup.sql`에서 `authenticated`에 필요한 권한만 명시적으로 준다 (카테고리는 읽기만).
- **오류 응답**: JSON `{ "error": "한국어 메시지" }` + 400 / 401(로그인 필요) / 403 / 404 / 409(사이트 이름 중복) / 500 상태 코드.
- **화면**: 휴대폰 폭(375px)에서 가로 스크롤 없이 표시, 시스템 다크 모드 지원.

## 6. 시스템 구조

```
브라우저 (public/)                    서버 (server.js)                      저장소 (lib/)
index.html · app.js · style.css ──▶  Express REST API            ──▶  store-sqlite.js   ──▶ db/siteops.db
        fetch /api/...                 입력 검증 · 오류 처리              store-supabase.js ──▶ Supabase (Postgres)
  (Supabase 모드) Google 로그인         DB_DRIVER로 저장소 선택            요청마다 사용자 토큰으로 접속 → RLS
  → Authorization: Bearer 토큰          토큰 없으면 401
```

| 파일 | 역할 |
| --- | --- |
| `server.js` | API 경로, 입력 검증, 오류 처리, `.env`에 따라 저장소 선택 |
| `lib/store-sqlite.js` | SQLite 읽기·쓰기 (Node 내장 `node:sqlite`) |
| `lib/store-supabase.js` | Supabase 읽기·쓰기 (요청한 사용자 권한으로), Postgres 오류 코드를 HTTP 오류로 변환 |
| `lib/errors.js` | 공통 HTTP 오류 |
| `db/schema.sql`, `db/seed.sql` | SQLite 스키마와 예시 데이터 |
| `supabase/setup.sql` | 같은 구조의 Postgres 버전 + `user_id` + RLS 정책 + 카테고리 (SQL Editor에서 실행, 여러 번 실행해도 안전, v1 DB도 그대로 업그레이드) |
| `supabase/claim.sql` | v1 데이터를 처음 가입한 계정으로 옮김 (첫 로그인 후 한 번) |
| `.env.example` | 환경 변수 예시 |

## 7. 데이터 모델

```
sites (1) ──< todos >── (1) categories
```

| 테이블 | 역할 | 핵심 컬럼 |
| --- | --- | --- |
| `sites` | 관리 대상 사이트 | `name`, `url`, `user_id`(Supabase) — 이름은 사용자마다 고유 |
| `categories` | 점검 분류 | `name`(고유), `color`, `sort_order` |
| `todos` | 점검 항목 | `title`, `memo`, `site_id`, `category_id`, `due_date`, `is_done`, `completed_at`, `created_at`, `updated_at`, `user_id`(Supabase) |
| `todo_list` (뷰) | 목록 화면용 | 사이트·카테고리 이름 조인, `due_status`(`overdue` / `today` / `upcoming`) |

- 사이트·카테고리를 지워도 항목은 남고 해당 칸만 비워진다 (`ON DELETE SET NULL`).
- `updated_at`, `completed_at`은 트리거가 자동으로 관리한다.

SQLite와 Postgres의 차이

| 항목 | SQLite (`db/schema.sql`) | Postgres (`supabase/setup.sql`) |
| --- | --- | --- |
| ID | `INTEGER PRIMARY KEY AUTOINCREMENT` | `bigint generated always as identity` |
| 완료 여부 | `INTEGER` 0/1 | `boolean` (API 응답은 0/1로 통일) |
| 마감일 | `TEXT` + 날짜 형식 `CHECK` | `date` 타입 |
| 시각 | `TEXT` (로컬 시각) | `timestamptz` |
| 트리거 | `AFTER UPDATE` 2개 | `BEFORE INSERT OR UPDATE` 함수 1개 |
| 접근 제어 | 로컬 파일 (로그인 없음) | Google 로그인 + RLS 정책 (`user_id = auth.uid()`) |

## 8. API 설계 (REST)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/todos?site=&category=&status=` | 목록 조회 (`status`: `all` / `open` / `done` / `overdue`) |
| GET | `/api/todos/:id` | 단건 조회 |
| POST | `/api/todos` | 항목 추가 (`title` 필수) → 201 |
| PATCH | `/api/todos/:id` | 항목 수정(부분) · 완료 토글 (`{"is_done": true}`) |
| DELETE | `/api/todos/:id` | 항목 삭제 → 204 |
| GET | `/api/categories` | 카테고리 목록 |
| GET | `/api/config` | 로그인 모드 여부, Supabase 주소·publishable 키 |
| GET | `/api/sites` | 사이트 목록 |
| POST | `/api/sites` | 사이트 추가 (`name` 필수, `url` 선택) → 201, 이름 중복 409 |
| GET | `/api/summary` | 전체 / 미완료 / 완료 / 기한 지남 개수 |

Supabase 모드에서는 `/api/config`를 뺀 모든 API에 `Authorization: Bearer <access token>`이 필요하다 (없거나 만료되면 401).

## 9. 범위 밖

- 로컬 SQLite 모드의 로그인 (과제 기본 실행은 로그인 없이)
- 카테고리 추가·삭제, 사이트 수정·삭제 화면
- Google 외 로그인 방법 (이메일·GitHub 등)
- GitHub / Vercel / Supabase API 연동, 자동 상태 감시
- 반복 점검 주기, 알림, 배포 이력
- 기존 운영 저장소·Supabase 프로젝트 접근 또는 수정

## 10. 향후 확장

1. 사용자별 카테고리, 사이트 수정·삭제 화면
2. 여러 사람이 한 사이트를 함께 관리하는 팀 기능
3. 정기 점검 주기, 마지막 점검일, 다음 점검 예정일 자동 계산
4. GitHub·Vercel API로 배포 상태 자동 조회

## 11. 테스트 결과

| 구분 | 내용 | 결과 |
| --- | --- | --- |
| SQLite API | 추가·조회·수정·완료 토글·삭제·필터, 잘못된 입력(빈 제목, 101자, 잘못된 날짜, 없는 카테고리, 깨진 JSON), 없는 항목 404 | 통과 |
| SQLite 영구 저장 | 서버 재시작 후 데이터 유지 | 통과 |
| 화면 | 추가 → 완료 → 수정 창 → 카테고리·상태 필터 → 삭제, 요약 카드 갱신 | 통과 |
| 화면 보안 | 제목에 HTML 입력 시 글자 그대로 표시 | 통과 |
| 모바일 | 375px 폭에서 가로 스크롤 없음 | 통과 |
| Supabase SQL | PGlite(Postgres)에서 `setup.sql` 2회 실행 — 중복 없음, 트리거·제약 조건·한국 날짜 기준 동작 | 통과 |
| Supabase RLS | 공개 키 권한으로 조회 0건, 추가 거부 | 통과 |
| Supabase 시작 오류 | 키 누락·잘못된 주소 시 안내 메시지 후 중단 | 통과 |
| Supabase 실제 연결 | 새 프로젝트에서 추가·조회·수정·완료 토글·삭제·필터, 잘못된 입력 400, 없는 항목 404 | 통과 |
| Supabase 권한 문제 | 처음에 `permission denied (42501)` 발생 → `service_role` GRANT 추가로 해결 | 해결 |
| Vercel 배포 | 실제 사이트에서 추가·완료 토글·수정·삭제, 빈 제목 400, 브라우저 코드에 키 없음 | 통과 |
| v2 SQL (PGlite) | v1 DB → `setup.sql` 2회 업그레이드, `claim.sql`로 기존 4건 이전, 사용자 A·B 분리: B는 A의 항목·사이트 0건 조회, 수정·삭제 0건, A 사이트 연결·A로 위장 추가 거부(42501), 같은 사이트 이름은 사람마다 허용·본인 중복 거부, 카테고리 쓰기 거부, 비로그인 조회 거부 | 통과 |
| v2 서버 | SQLite 모드는 로그인 없이 동작, 사이트 추가·중복 409·잘못된 주소 400; Supabase 모드는 토큰 없으면 401 | 통과 |
| v2 화면 | 로그인 전 로그인 화면만 표시 | 통과 |
| v2 실제 배포 | 배포 사이트에서 Google 로그인(첫 로그인 = 가입), `claim.sql`로 기존 사이트 2개·항목 5개를 내 계정으로 이전, 비로그인 API 401 | 통과 |
| v2 배포 문제 | 환경 변수 `SUPABASE_PUBLISHABLE_KEY` 누락으로 서버 시작 실패(500) → 변수 추가 후 재배포로 해결 | 해결 |
| v2.1 로컬 Docker | 클라우드 데이터 백업 → 로컬 Supabase에 `setup.sql`·백업 복원(사이트 2개·항목 5개), 로컬에서 Google 로그인, `claim.sql`로 내 계정에 이전 후 화면에 5개 표시 | 통과 |
| v2.1 로컬 문제 | `supabase/.env`의 Google Secret이 비어 로그인 불가 → Secret 다시 저장 후 `db:stop`/`db:start`로 해결 | 해결 |
| v2.1 배포 영향 | Mac 전용 CLI 패키지를 optionalDependencies로 옮김 → Linux 설치 시뮬레이션에서 건너뜀 확인 | 통과 |
| v2.2 리뷰 결함 | 리뷰어가 찾은 문제: `is_done: "false"`(문자열)가 완료로 저장, 객체 제목이 `[object Object]`로 저장 → 타입 검사 추가 | 해결 |
| v2.2 자동 테스트 | `npm test` 18건 통과. 고치기 전 코드로 돌리면 3건 실패(제목 타입, 메모 길이·타입, `is_done` 타입) → 테스트가 결함을 잡는 것 확인 | 통과 |
| v2.2 마감일 비우기 | 수정 창이 보내는 빈 값('')으로 마감일·사이트·카테고리·메모를 비우면 null로 저장 (테스트 포함) | 통과 |
| v2.2 클라우드 로그인 복구 | Google Cloud에서 예전 Client Secret 삭제 후 배포 사이트 로그인 실패(`Unable to exchange external code`) → Supabase Google 설정에 현재 Secret 저장 후 로그인 확인 | 해결 |

## 12. 완료 기준 (과제 제출 체크리스트)

- [x] 항목 추가 / 조회 / 수정 / 삭제가 모두 동작한다
- [x] 카테고리 지정·필터가 동작한다
- [x] 마감일 지정·표시·정렬이 동작한다
- [x] 서버를 재시작해도 데이터가 유지된다
- [x] README에 실행 방법이 적혀 있다
- [x] Supabase 새 프로젝트에 연결해 같은 기능이 동작한다
- [x] Vercel에 배포해 인터넷에서 접속할 수 있다
- [x] Google 로그인 후 사람마다 자기 데이터만 보인다 (v2)
- [x] `npm test` 자동 테스트가 모두 통과한다 (v2.2)
