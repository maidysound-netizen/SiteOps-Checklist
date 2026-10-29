-- SiteOps Checklist — SQLite schema
-- 실행: sqlite3 db/siteops.db < db/schema.sql

PRAGMA foreign_keys = ON;

-- 관리 대상 사이트
CREATE TABLE IF NOT EXISTS sites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  url        TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 점검 분류 (추가 기능 1)
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  color      TEXT    NOT NULL DEFAULT '#6b7280',  -- 배지 색상 (hex)
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 점검 항목 (Todo)
CREATE TABLE IF NOT EXISTS todos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  memo         TEXT,
  site_id      INTEGER REFERENCES sites(id)      ON DELETE SET NULL,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  due_date     TEXT    CHECK (due_date IS NULL OR due_date IS date(due_date)),  -- 추가 기능 2, YYYY-MM-DD (IS: 잘못된 날짜면 date()가 NULL)
  is_done      INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
  completed_at TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_todos_status_due ON todos (is_done, due_date);
CREATE INDEX IF NOT EXISTS idx_todos_category   ON todos (category_id);
CREATE INDEX IF NOT EXISTS idx_todos_site       ON todos (site_id);

-- 수정 시 updated_at 자동 갱신
CREATE TRIGGER IF NOT EXISTS trg_todos_updated_at
AFTER UPDATE ON todos
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE todos SET updated_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;

-- 완료 토글 시 completed_at 자동 기록/해제
CREATE TRIGGER IF NOT EXISTS trg_todos_completed_at
AFTER UPDATE OF is_done ON todos
FOR EACH ROW
WHEN NEW.is_done <> OLD.is_done
BEGIN
  UPDATE todos
     SET completed_at = CASE WHEN NEW.is_done = 1 THEN datetime('now', 'localtime') END
   WHERE id = NEW.id;
END;

-- 목록 화면용 뷰: 이름 조인 + 마감 상태 계산
CREATE VIEW IF NOT EXISTS todo_list AS
SELECT
  t.id, t.title, t.memo, t.due_date, t.is_done, t.completed_at,
  t.created_at, t.updated_at,
  t.site_id,     s.name  AS site_name,
  t.category_id, c.name  AS category_name, c.color AS category_color,
  CASE
    WHEN t.is_done = 1 OR t.due_date IS NULL       THEN NULL
    WHEN t.due_date <  date('now', 'localtime')     THEN 'overdue'
    WHEN t.due_date =  date('now', 'localtime')     THEN 'today'
    ELSE 'upcoming'
  END AS due_status
FROM todos t
LEFT JOIN sites      s ON s.id = t.site_id
LEFT JOIN categories c ON c.id = t.category_id;
