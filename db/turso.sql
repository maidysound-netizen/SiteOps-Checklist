-- SiteOps Checklist — Turso(libSQL) 스키마: SQLite 스키마(db/schema.sql) + 사용자별 데이터
-- 서버가 시작할 때 자동으로 실행한다 (여러 번 실행해도 안전)
-- 시각: Turso 서버는 UTC이므로 'localtime' 대신 '+9 hours'(한국 시간, 서머타임 없음)를 쓴다.

PRAGMA foreign_keys = ON;

-- Google 로그인 사용자 (google_sub: Google 계정 고유 ID)
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT    NOT NULL UNIQUE,
  email      TEXT,
  name       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', '+9 hours')),
  -- 로그인 쿠키 세대: "모든 기기에서 로그아웃"하면 1 올라가고, 예전 쿠키는 전부 무효가 된다
  -- (이 열이 없던 기존 DB에는 서버가 ALTER TABLE로 추가한다 → lib/store-turso.js)
  session_version INTEGER NOT NULL DEFAULT 0
);

-- 관리 대상 사이트 (사용자마다 이름 고유)
CREATE TABLE IF NOT EXISTS sites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  url        TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', '+9 hours')),
  UNIQUE (user_id, name)
);

-- 점검 분류 (모두 공통)
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  color      TEXT    NOT NULL DEFAULT '#6b7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

-- 점검 항목
CREATE TABLE IF NOT EXISTS todos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  memo         TEXT,
  site_id      INTEGER REFERENCES sites(id)      ON DELETE SET NULL,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  due_date     TEXT    CHECK (due_date IS NULL OR due_date IS date(due_date)),
  is_done      INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
  completed_at TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_todos_user_status ON todos (user_id, is_done, due_date);
CREATE INDEX IF NOT EXISTS idx_sites_user        ON sites (user_id);

-- 남의 사이트에 항목을 붙이지 못하게 DB에서 한 번 더 막는다 (Supabase RLS의 '내 사이트만' 정책 대신)
CREATE TRIGGER IF NOT EXISTS trg_todos_site_owner_insert
BEFORE INSERT ON todos
FOR EACH ROW
WHEN NEW.site_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM sites WHERE id = NEW.site_id AND user_id = NEW.user_id)
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: site owner');
END;

CREATE TRIGGER IF NOT EXISTS trg_todos_site_owner_update
BEFORE UPDATE OF site_id, user_id ON todos
FOR EACH ROW
WHEN NEW.site_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM sites WHERE id = NEW.site_id AND user_id = NEW.user_id)
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: site owner');
END;

CREATE TRIGGER IF NOT EXISTS trg_todos_updated_at
AFTER UPDATE ON todos
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE todos SET updated_at = datetime('now', '+9 hours') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_todos_completed_at
AFTER UPDATE OF is_done ON todos
FOR EACH ROW
WHEN NEW.is_done <> OLD.is_done
BEGIN
  UPDATE todos
     SET completed_at = CASE WHEN NEW.is_done = 1 THEN datetime('now', '+9 hours') END
   WHERE id = NEW.id;
END;

-- 목록 화면용 뷰 (user_id 포함 — 조회할 때 항상 user_id로 거른다)
CREATE VIEW IF NOT EXISTS todo_list AS
SELECT
  t.id, t.user_id, t.title, t.memo, t.due_date, t.is_done, t.completed_at,
  t.created_at, t.updated_at,
  t.site_id,     s.name  AS site_name,
  t.category_id, c.name  AS category_name, c.color AS category_color,
  CASE
    WHEN t.is_done = 1 OR t.due_date IS NULL      THEN NULL
    WHEN t.due_date <  date('now', '+9 hours')    THEN 'overdue'
    WHEN t.due_date =  date('now', '+9 hours')    THEN 'today'
    ELSE 'upcoming'
  END AS due_status
FROM todos t
LEFT JOIN sites      s ON s.id = t.site_id
LEFT JOIN categories c ON c.id = t.category_id;

INSERT OR IGNORE INTO categories (name, color, sort_order) VALUES
  ('보안',   '#dc2626', 1),
  ('배포',   '#2563eb', 2),
  ('백업',   '#16a34a', 3),
  ('DNS',    '#9333ea', 4),
  ('콘텐츠', '#d97706', 5);
