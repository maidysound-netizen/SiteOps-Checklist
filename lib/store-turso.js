// Turso(libSQL, 클라우드 SQLite) 저장소 — DB_DRIVER=turso 일 때 사용
// 테이블 구조는 db/turso.sql 참고. 모든 조회·수정은 로그인한 사용자의 user_id로 거른다.
// 남의 사이트에 항목을 붙이는 것은 DB 트리거가 한 번 더 막는다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { badInput, badReference, duplicateSite } from './errors.js';
import { EXAMPLE_SITES, EXAMPLE_TODOS } from './examples.js';
import { createCipherBox } from './cipher.js';

const LOCK = '🔒'; // 암호화한 항목의 title 칸에 남기는 표시 (CHECK 1~100자를 만족)
const aad = (userId, field) => `todo:${userId}:${field}`;

// 제약 조건 위반 → 400/409 오류 (SQLite 저장소와 같은 규칙)
function toError(err) {
  const message = `${err.message} ${err.cause?.message ?? ''}`;
  if (/FOREIGN KEY constraint failed/.test(message)) return badReference();
  if (/CHECK constraint failed/.test(message)) return badInput();
  if (/UNIQUE constraint failed: sites\./.test(message)) return duplicateSite();
  return err;
}

// dataKey: 할 일 제목·메모 암호화 키 (DATA_ENCRYPTION_KEY)
export function createTursoStore({ url, authToken, sqlDir, dataKey }) {
  const db = createClient({ url, authToken, intMode: 'number' });
  const box = createCipherBox(dataKey);
  const sqlText = () => readFileSync(path.join(sqlDir, 'turso.sql'), 'utf8');

  // 저장할 값 → 제목·메모는 암호문 칸으로 (title에는 자물쇠만)
  function seal(userId, input) {
    const out = { ...input };
    if ('title' in out) {
      out.title_enc = box.encrypt(out.title, aad(userId, 'title'));
      out.title = LOCK;
    }
    if ('memo' in out) {
      out.memo_enc = out.memo == null ? null : box.encrypt(out.memo, aad(userId, 'memo'));
      out.memo = null;
    }
    return out;
  }

  // 읽은 행 → 복호화한 제목·메모 (user_id와 암호문 칸은 응답에서 뺀다)
  function open({ user_id, title_enc, memo_enc, ...row }) {
    return {
      ...row,
      title: title_enc ? box.decrypt(title_enc, aad(user_id, 'title')) : row.title,
      memo: memo_enc ? box.decrypt(memo_enc, aad(user_id, 'memo')) : row.memo,
    };
  }
  let ready = null;

  // 처음 쓸 때 한 번 스키마를 맞춘다 (Vercel은 요청마다 서버가 새로 뜰 수 있어 시작 시점 대신 첫 요청에)
  function init() {
    ready ??= db.executeMultiple(sqlText()).then(migrate).catch((err) => {
      ready = null;
      throw err;
    });
    return ready;
  }

  // 예전에 만든 DB에 새 열 추가 (데이터는 그대로, 여러 번 실행해도 안전)
  async function migrate() {
    const columns = async (table) => (await db.execute(`PRAGMA table_info(${table})`)).rows.map((row) => row.name);
    if (!(await columns('users')).includes('session_version')) {
      await db.execute('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
    }
    const todoColumns = await columns('todos');
    for (const column of ['title_enc', 'memo_enc']) {
      if (!todoColumns.includes(column)) await db.execute(`ALTER TABLE todos ADD COLUMN ${column} TEXT`);
    }
    // 뷰가 예전 모양이면 turso.sql의 정의로 다시 만든다
    if (!(await columns('todo_list')).includes('title_enc')) {
      const view = sqlText().match(/CREATE VIEW IF NOT EXISTS todo_list AS[\s\S]*?;/)[0];
      await db.batch(['DROP VIEW IF EXISTS todo_list', view], 'write');
    }
    // 아직 평문인 항목을 암호화 (한 번만 일어남)
    const { rows } = await db.execute('SELECT id, user_id, title, memo FROM todos WHERE title_enc IS NULL');
    for (let i = 0; i < rows.length; i += 100) {
      await db.batch(
        rows.slice(i, i + 100).map((row) => {
          const sealed = seal(row.user_id, { title: row.title, memo: row.memo });
          return {
            sql: 'UPDATE todos SET title = ?, title_enc = ?, memo = NULL, memo_enc = ? WHERE id = ? AND title_enc IS NULL',
            args: [sealed.title, sealed.title_enc, sealed.memo_enc, row.id],
          };
        }),
        'write',
      );
    }
  }

  async function query(sql, args = []) {
    await init();
    try {
      const { rows, columns, lastInsertRowid, rowsAffected } = await db.execute({ sql, args });
      return {
        rows: rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]]))),
        lastInsertRowid: lastInsertRowid === undefined ? undefined : Number(lastInsertRowid),
        rowsAffected,
      };
    } catch (err) {
      throw toError(err);
    }
  }

  // 예시 사이트·항목을 한 번에 넣는다 (중간에 실패하면 모두 취소)
  async function addExamples(userId) {
    await db.batch(
      [
        ...EXAMPLE_SITES.map(({ name, url }) => ({
          sql: 'INSERT INTO sites (user_id, name, url) VALUES (?, ?, ?)',
          args: [userId, name, url],
        })),
        ...EXAMPLE_TODOS.map(({ title, site, category, dueDays, done }) => ({
          sql: `INSERT INTO todos (user_id, title, title_enc, site_id, category_id, due_date, is_done, completed_at)
                VALUES (?, ?, ?, (SELECT id FROM sites WHERE user_id = ? AND name = ?),
                        (SELECT id FROM categories WHERE name = ?),
                        CASE WHEN ? IS NULL THEN NULL ELSE date('now', '+9 hours', ? || ' days') END,
                        ?, CASE WHEN ? = 1 THEN datetime('now', '+9 hours') END)`,
          args: [userId, LOCK, box.encrypt(title, aad(userId, 'title')), userId, site, category, dueDays, dueDays ?? 0, done ? 1 : 0, done ? 1 : 0],
        })),
      ],
      'write',
    );
  }

  // 한 사용자의 범위로 동작하는 저장소 (응답에서는 user_id를 뺀다)
  function userStore(userId) {
    async function getTodo(id) {
      const { rows } = await query('SELECT * FROM todo_list WHERE id = ? AND user_id = ?', [id, userId]);
      return rows[0] ? open(rows[0]) : null;
    }

    return {
      async listTodos({ site, category, status }) {
        const where = ['user_id = ?'];
        const args = [userId];
        if (site) {
          where.push('site_id = ?');
          args.push(site);
        }
        if (category) {
          where.push('category_id = ?');
          args.push(category);
        }
        if (status === 'open') where.push('is_done = 0');
        else if (status === 'done') where.push('is_done = 1');
        else if (status === 'overdue') where.push("due_status = 'overdue'");

        const { rows } = await query(
          `SELECT * FROM todo_list WHERE ${where.join(' AND ')}
            ORDER BY is_done, due_date IS NULL, due_date, id DESC`,
          args,
        );
        return rows.map(open);
      },

      getTodo,

      // 컬럼 이름은 server.js의 허용 목록에서만 온다
      async createTodo(input) {
        const values = seal(userId, input);
        const columns = ['user_id', ...Object.keys(values)];
        const { lastInsertRowid } = await query(
          `INSERT INTO todos (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
          [userId, ...Object.values(values)],
        );
        return getTodo(lastInsertRowid);
      },

      async updateTodo(id, input) {
        const values = seal(userId, input);
        const columns = Object.keys(values);
        const { rowsAffected } = await query(
          `UPDATE todos SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND user_id = ?`,
          [...Object.values(values), id, userId],
        );
        return rowsAffected === 0 ? null : getTodo(id);
      },

      async deleteTodo(id) {
        const { rowsAffected } = await query('DELETE FROM todos WHERE id = ? AND user_id = ?', [id, userId]);
        return rowsAffected > 0;
      },

      async listCategories() {
        return (await query('SELECT * FROM categories ORDER BY sort_order, name')).rows;
      },

      async listSites() {
        const { rows } = await query(
          'SELECT id, name, url, created_at FROM sites WHERE user_id = ? ORDER BY name',
          [userId],
        );
        return rows;
      },

      async createSite({ name, url }) {
        const { lastInsertRowid } = await query('INSERT INTO sites (user_id, name, url) VALUES (?, ?, ?)', [
          userId,
          name,
          url,
        ]);
        return (await query('SELECT id, name, url, created_at FROM sites WHERE id = ?', [lastInsertRowid])).rows[0];
      },

      // 사이트 빼기: 내 사이트일 때만, 그 사이트의 점검 항목은 '사이트 없음'으로 남긴다 (한 번에 처리)
      async deleteSite(id) {
        await init();
        const [, removed] = await db.batch(
          [
            { sql: 'UPDATE todos SET site_id = NULL WHERE site_id = ? AND user_id = ?', args: [id, userId] },
            { sql: 'DELETE FROM sites WHERE id = ? AND user_id = ?', args: [id, userId] },
          ],
          'write',
        );
        return removed.rowsAffected > 0;
      },

      async summary() {
        const { rows } = await query(
          `SELECT COUNT(*)                                 AS total,
                  COALESCE(SUM(is_done = 0), 0)            AS open,
                  COALESCE(SUM(is_done = 1), 0)            AS done,
                  COALESCE(SUM(due_status = 'overdue'), 0) AS overdue
             FROM todo_list WHERE user_id = ?`,
          [userId],
        );
        return rows[0];
      },
    };
  }

  return {
    label: `Turso (${url.startsWith('libsql://') ? new URL(url).host : url}) + Google 로그인`,

    // 서버 시작 시 주소·토큰 확인
    async check() {
      await init();
    },

    // Google 로그인 사용자를 찾거나 만들고 id를 돌려준다. 처음 가입한 사람에게는 예시 데이터를 넣어 준다.
    async upsertUser({ sub, email, name }) {
      const created = await query(
        'INSERT INTO users (google_sub, email, name) VALUES (?, ?, ?) ON CONFLICT (google_sub) DO NOTHING RETURNING id',
        [sub, email ?? null, name ?? null],
      );
      if (created.rows[0]) {
        const userId = created.rows[0].id;
        await addExamples(userId);
        return userId;
      }
      const { rows } = await query('UPDATE users SET email = ?, name = ? WHERE google_sub = ? RETURNING id', [
        email ?? null,
        name ?? null,
        sub,
      ]);
      return rows[0].id;
    },

    // 서비스 탈퇴: 그 사람의 항목·사이트·계정을 한 번에 지운다 (중간에 실패하면 모두 취소)
    async deleteUser(id) {
      await init();
      await db.batch(
        [
          { sql: 'DELETE FROM todos WHERE user_id = ?', args: [id] },
          { sql: 'DELETE FROM sites WHERE user_id = ?', args: [id] },
          { sql: 'DELETE FROM device_sessions WHERE user_id = ?', args: [id] },
          { sql: 'DELETE FROM users WHERE id = ?', args: [id] },
        ],
        'write',
      );
    },

    async getUser(id) {
      return (await query('SELECT id, email, name, session_version FROM users WHERE id = ?', [id])).rows[0] ?? null;
    },

    // 모든 기기에서 로그아웃: 쿠키 세대를 올려 지금까지 발급한 그 사람의 쿠키를 모두 무효로
    async bumpSessionVersion(id) {
      await init();
      await db.batch(
        [
          { sql: 'UPDATE users SET session_version = session_version + 1 WHERE id = ?', args: [id] },
          { sql: 'DELETE FROM device_sessions WHERE user_id = ?', args: [id] },
        ],
        'write',
      );
    },

    // 완료 항목 자동 정리: 완료한 지 days일이 지난 항목을 지운다 (지운 개수를 돌려줌)
    async purgeCompleted(userId, days) {
      const { rowsAffected } = await query(
        `DELETE FROM todos WHERE user_id = ? AND is_done = 1 AND completed_at IS NOT NULL
            AND completed_at < datetime('now', '+9 hours', ?)`,
        [userId, `-${days} days`],
      );
      return rowsAffected;
    },

    // DBSC 기기 세션: 기기의 공개 키(꺼낼 수 없는 개인 키의 짝)를 저장
    async createDeviceSession({ id, userId, alg, jwk, version }) {
      await query('INSERT INTO device_sessions (id, user_id, alg, jwk, session_version) VALUES (?, ?, ?, ?, ?)', [
        id,
        userId,
        alg,
        JSON.stringify(jwk),
        version,
      ]);
    },

    async getDeviceSession(id) {
      return (await query('SELECT * FROM device_sessions WHERE id = ?', [id])).rows[0] ?? null;
    },

    async deleteDeviceSession(id) {
      await query('DELETE FROM device_sessions WHERE id = ?', [id]);
    },

    forUser: userStore,
  };
}
