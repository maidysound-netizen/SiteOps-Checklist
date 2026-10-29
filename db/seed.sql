-- SiteOps Checklist — 예시 데이터 (실제 사이트 상태와 무관한 수동 입력 예시)
-- 실행: sqlite3 db/siteops.db < db/seed.sql

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO sites (name, url) VALUES
  ('Takako World', NULL),
  ('King''s St.',  NULL);

INSERT OR IGNORE INTO categories (name, color, sort_order) VALUES
  ('보안',   '#dc2626', 1),
  ('배포',   '#2563eb', 2),
  ('백업',   '#16a34a', 3),
  ('DNS',    '#9333ea', 4),
  ('콘텐츠', '#d97706', 5);

INSERT INTO todos (title, site_id, category_id, due_date, is_done) VALUES
  ('관리자 로그인 권한 점검',
     (SELECT id FROM sites WHERE name = 'Takako World'),
     (SELECT id FROM categories WHERE name = '보안'), date('now', 'localtime', '-1 day'), 0),
  ('SFX 번역 컨트롤 배포 확인',
     (SELECT id FROM sites WHERE name = 'Takako World'),
     (SELECT id FROM categories WHERE name = '배포'), date('now', 'localtime'), 0),
  ('게임 데이터 백업 방식 검토',
     (SELECT id FROM sites WHERE name = 'King''s St.'),
     (SELECT id FROM categories WHERE name = '백업'), date('now', 'localtime', '+7 days'), 0),
  ('GitHub 저장소 비공개 설정 확인',
     (SELECT id FROM sites WHERE name = 'Takako World'),
     (SELECT id FROM categories WHERE name = '보안'), NULL, 1);

-- 완료 상태로 넣은 항목의 완료 시각 채우기 (트리거는 UPDATE에만 동작)
UPDATE todos SET completed_at = datetime('now', 'localtime') WHERE is_done = 1 AND completed_at IS NULL;
