// SQLite 저장소 (기본값) — Node 내장 node:sqlite 사용
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { badInput, badReference, duplicateSite } from './errors.js';

export function createSqliteStore({ dbPath, sqlDir }) {
  // 파일이 없을 때만 예시 데이터를 넣는다 (재시작해도 데이터 유지)
  const isNewDb = dbPath === ':memory:' || !existsSync(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(path.join(sqlDir, 'schema.sql'), 'utf8'));
  if (isNewDb) db.exec(readFileSync(path.join(sqlDir, 'seed.sql'), 'utf8'));

  const getTodo = db.prepare('SELECT * FROM todo_list WHERE id = ?');

  // 제약 조건 위반 → 400 오류
  function run(fn) {
    try {
      return fn();
    } catch (err) {
      if (/FOREIGN KEY constraint failed/.test(err.message)) throw badReference();
      if (/CHECK constraint failed/.test(err.message)) throw badInput();
      if (/UNIQUE constraint failed: sites\.name/.test(err.message)) throw duplicateSite();
      throw err;
    }
  }

  return {
    label: `SQLite (${dbPath})`,

    async listTodos({ site, category, status }) {
      const where = [];
      const params = [];
      if (site) {
        where.push('site_id = ?');
        params.push(site);
      }
      if (category) {
        where.push('category_id = ?');
        params.push(category);
      }
      if (status === 'open') where.push('is_done = 0');
      else if (status === 'done') where.push('is_done = 1');
      else if (status === 'overdue') where.push("due_status = 'overdue'");

      // 미완료 먼저 → 마감일 빠른 순(없으면 뒤) → 최근 등록 순
      const sql = `SELECT * FROM todo_list
                   ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                   ORDER BY is_done, due_date IS NULL, due_date, id DESC`;
      return db.prepare(sql).all(...params);
    },

    async getTodo(id) {
      return getTodo.get(id) ?? null;
    },

    async createTodo(input) {
      const columns = Object.keys(input);
      const sql = `INSERT INTO todos (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
      const { lastInsertRowid } = run(() => db.prepare(sql).run(...Object.values(input)));
      return getTodo.get(lastInsertRowid);
    },

    async updateTodo(id, input) {
      const columns = Object.keys(input);
      const sql = `UPDATE todos SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
      const { changes } = run(() => db.prepare(sql).run(...Object.values(input), id));
      return changes === 0 ? null : getTodo.get(id);
    },

    async deleteTodo(id) {
      return db.prepare('DELETE FROM todos WHERE id = ?').run(id).changes > 0;
    },

    async listCategories() {
      return db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
    },

    async listSites() {
      return db.prepare('SELECT * FROM sites ORDER BY name').all();
    },

    async createSite({ name, url }) {
      const { lastInsertRowid } = run(() => db.prepare('INSERT INTO sites (name, url) VALUES (?, ?)').run(name, url));
      return db.prepare('SELECT * FROM sites WHERE id = ?').get(lastInsertRowid);
    },

    async summary() {
      return db.prepare(`SELECT COUNT(*)                                 AS total,
                                COALESCE(SUM(is_done = 0), 0)            AS open,
                                COALESCE(SUM(is_done = 1), 0)            AS done,
                                COALESCE(SUM(due_status = 'overdue'), 0) AS overdue
                           FROM todo_list`).get();
    },
  };
}
