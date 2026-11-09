// 처음 쓰는 사람에게 보여 줄 예시 데이터 — 누구나 쓰는 웹사이트 운영 점검 항목 (개인 정보 없음)
// 로컬 SQLite의 예시(db/seed.sql)와 같은 내용이다.
export const EXAMPLE_SITES = [
  { name: '내 블로그', url: null },
  { name: '회사 홈페이지', url: null },
];

// dueDays: 오늘 기준 마감일(일), null이면 마감일 없음
export const EXAMPLE_TODOS = [
  { title: '관리자 비밀번호 변경·2단계 인증 확인', site: '내 블로그', category: '보안', dueDays: -1, done: false },
  { title: '배포 후 주요 페이지 동작 확인', site: '회사 홈페이지', category: '배포', dueDays: 0, done: false },
  { title: '데이터베이스 백업 복원 테스트', site: '회사 홈페이지', category: '백업', dueDays: 7, done: false },
  { title: 'SSL 인증서 만료일 확인', site: '내 블로그', category: '보안', dueDays: null, done: true },
];
