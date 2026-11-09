# SiteOps Checklist

## 개요
웹사이트 운영 점검 항목(할 일)을 추가·완료·조회하는 Todo 앱. 웹 화면(`npm start`)과 명령줄(`cli.js`)이 같은 로컬 SQLite 데이터를 쓴다.

## 명령 (할 일 데이터는 이 명령으로만 읽고 쓴다)
- 목록: `node cli.js list`
- 추가: `node cli.js add "<내용>"`
- 완료: `node cli.js done <번호>`
- 오늘 완료 요약: `node cli.js summary`
- 웹 화면: `npm start` → http://localhost:3000 / 테스트: `npm test`

## 규칙
- CLI 데이터는 `db/siteops.db`(로컬 SQLite)에 저장된다. 클라우드(Turso)에는 접속하지 않는다.
- 화면·CLI 문구는 존댓말로. 코드를 고치기 전에 `git commit`으로 되돌릴 지점을 만든다.

## 하지 말 것
- `db/siteops.db`를 직접 지우거나 덮어쓰지 말 것 (`npm run db:reset` 포함). SQL로 직접 수정하지 말 것.
- `.env`의 값(Turso 주소·토큰, Google Client Secret, SESSION_SECRET)을 출력하거나 규칙 파일·스킬·Git에 넣지 말 것.
