-- SiteOps Checklist — 예시 데이터 (누구나 쓰는 웹사이트 운영 점검 항목, 개인 정보 없음)
-- Turso 모드에서 처음 가입한 사람에게 넣는 예시(lib/examples.js)와 같은 내용
-- 실행: sqlite3 db/siteops.db < db/seed.sql

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO sites (name, url) VALUES
  ('내 블로그',     NULL),
  ('회사 홈페이지', NULL);

INSERT OR IGNORE INTO categories (name, color, sort_order) VALUES
  ('보안',   '#dc2626', 1),
  ('배포',   '#2563eb', 2),
  ('백업',   '#16a34a', 3),
  ('DNS',    '#9333ea', 4),
  ('콘텐츠', '#d97706', 5);

INSERT INTO todos (title, site_id, category_id, due_date, is_done) VALUES
  ('관리자 비밀번호 변경·2단계 인증 확인',
     (SELECT id FROM sites WHERE name = '내 블로그'),
     (SELECT id FROM categories WHERE name = '보안'), date('now', 'localtime', '-1 day'), 0),
  ('배포 후 주요 페이지 동작 확인',
     (SELECT id FROM sites WHERE name = '회사 홈페이지'),
     (SELECT id FROM categories WHERE name = '배포'), date('now', 'localtime'), 0),
  ('데이터베이스 백업 복원 테스트',
     (SELECT id FROM sites WHERE name = '회사 홈페이지'),
     (SELECT id FROM categories WHERE name = '백업'), date('now', 'localtime', '+7 days'), 0),
  ('SSL 인증서 만료일 확인',
     (SELECT id FROM sites WHERE name = '내 블로그'),
     (SELECT id FROM categories WHERE name = '보안'), NULL, 1);

-- 완료 상태로 넣은 항목의 완료 시각 채우기 (트리거는 UPDATE에만 동작)
UPDATE todos SET completed_at = datetime('now', 'localtime') WHERE is_done = 1 AND completed_at IS NULL;
