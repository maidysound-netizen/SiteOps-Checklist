// Turso 모드 테스트 — 임시 파일 libSQL DB로 서버를 띄운다 (실제 Turso·Google에는 접속하지 않음)
// 서버와 테스트가 같은 DB 파일을 쓰므로, 테스트가 만든 사용자로 서버 API를 호출할 수 있다.
// 세션 쿠키는 서버와 같은 SESSION_SECRET으로 직접 만들어 로그인한 상태를 흉내 낸다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SECRET = 'test-session-secret-0123456789abcdef';
const TMP = mkdtempSync(path.join(os.tmpdir(), 'siteops-turso-test-'));
const DB_URL = pathToFileURL(path.join(TMP, 'test.db')).href;
Object.assign(process.env, {
  NO_LISTEN: '1',
  DB_DRIVER: 'turso',
  TURSO_DATABASE_URL: DB_URL,
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  SESSION_SECRET: SECRET,
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});
const { default: app } = await import('../server.js');
const { createTursoStore } = await import('../lib/store-turso.js');

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  rmSync(TMP, { recursive: true, force: true });
});

function sessionCookie(uid, exp = Date.now() + 60_000, v = 0) {
  const data = Buffer.from(JSON.stringify({ uid, v, exp })).toString('base64url');
  return `sid=${data}.${crypto.createHmac('sha256', SECRET).update(data).digest('base64url')}`;
}

async function call(cookie, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

// 서버와 같은 메모리 DB를 쓸 수 없으므로, 사용자는 로그인 경로 대신 저장소로 만든다 → 별도 저장소 테스트에서 확인
// 여기서는 서버가 첫 요청 때 만든 DB에 사용자가 없으므로, 세션의 uid가 DB에 없을 때의 동작을 먼저 본다.
test('로그인 쿠키가 없거나 위조·만료면 401', async () => {
  assert.equal((await call(null, 'GET', '/api/todos')).status, 401);
  assert.equal((await call(sessionCookie(1).replace(/.$/, 'x'), 'GET', '/api/todos')).status, 401);
  assert.equal((await call(sessionCookie(1, Date.now() - 1), 'GET', '/api/todos')).status, 401);
  assert.equal((await call('sid=garbage', 'GET', '/api/me')).status, 401);
});

test('/auth/google: Google로 보내고 state·PKCE는 HttpOnly 쿠키에', async () => {
  const res = await fetch(`${base}/auth/google`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.searchParams.get('client_id'), 'test-client.apps.googleusercontent.com');
  assert.equal(location.searchParams.get('redirect_uri'), `${base}/auth/callback`);
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(location.searchParams.get('state'));
  assert.doesNotMatch(location.search, /test-client-secret/);
  assert.match(res.headers.get('set-cookie'), /^g_login=.*HttpOnly.*SameSite=Lax/i);
});

test('/auth/callback: state가 맞지 않으면 로그인 오류', async () => {
  const res = await fetch(`${base}/auth/callback?code=abc&state=wrong`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/\?login_error=/);
});

// ---------- 저장소 (사용자 분리) ----------
const store = createTursoStore({ url: DB_URL, sqlDir: fileURLToPath(new URL('../db', import.meta.url)), dataKey: process.env.DATA_ENCRYPTION_KEY });

test('처음 가입하면 예시 사이트 2개·항목 4개, 다시 로그인하면 그대로', async () => {
  const id = await store.upsertUser({ sub: 'google-a', email: 'a@example.com', name: 'A' });
  assert.equal(await store.upsertUser({ sub: 'google-a', email: 'a2@example.com', name: 'A' }), id);
  const a = store.forUser(id);
  assert.deepEqual((await a.listSites()).map((s) => s.name).sort(), ['내 블로그', '회사 홈페이지']);
  assert.deepEqual(await a.summary(), { total: 4, open: 3, done: 1, overdue: 1 });
  assert.equal((await store.getUser(id)).email, 'a2@example.com');
});

test('다른 사람의 항목·사이트는 보이지도, 고쳐지지도, 지워지지도 않는다', async () => {
  const a = store.forUser(await store.upsertUser({ sub: 'google-a' }));
  const b = store.forUser(await store.upsertUser({ sub: 'google-b' }));
  const todo = await a.createTodo({ title: 'A만 볼 수 있음' });
  const aSite = (await a.listSites())[0];

  assert.equal(await b.getTodo(todo.id), null);
  assert.ok(!(await b.listTodos({ status: 'all' })).some((t) => t.id === todo.id));
  assert.equal(await b.updateTodo(todo.id, { title: '바꿈' }), null);
  assert.equal(await b.deleteTodo(todo.id), false);
  assert.equal((await a.getTodo(todo.id)).title, 'A만 볼 수 있음');

  // 남의 사이트에 붙이기: DB 트리거가 거부 → 400
  await assert.rejects(b.createTodo({ title: '남의 사이트', site_id: aSite.id }), { status: 400 });
  const bTodo = await b.createTodo({ title: 'B 항목' });
  await assert.rejects(b.updateTodo(bTodo.id, { site_id: aSite.id }), { status: 400 });

  // 사이트 이름은 사람마다 따로 (같은 이름 허용), 내 안에서는 중복 409
  assert.ok(await b.createSite({ name: '새 사이트', url: null }));
  assert.ok(await a.createSite({ name: '새 사이트', url: null }));
  await assert.rejects(a.createSite({ name: '새 사이트', url: null }), { status: 409 });
});

test('완료하면 한국 시간으로 completed_at 기록', async () => {
  const a = store.forUser(await store.upsertUser({ sub: 'google-a' }));
  const todo = await a.createTodo({ title: '시간' });
  const done = await a.updateTodo(todo.id, { is_done: 1 });
  const seoul = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  assert.equal(done.completed_at.slice(0, 10), seoul);
  assert.equal(done.user_id, undefined, '응답에 user_id를 내보내지 않는다');
});

test('서비스 탈퇴: 그 사람의 계정·사이트·항목만 지워지고 다른 사람은 그대로', async () => {
  const goneId = await store.upsertUser({ sub: 'google-gone', email: 'gone@example.com' });
  const keep = store.forUser(await store.upsertUser({ sub: 'google-keep' }));
  const keepBefore = await keep.summary();
  await store.forUser(goneId).createTodo({ title: '지워질 항목' });

  await store.deleteUser(goneId);
  assert.equal(await store.getUser(goneId), null);
  const gone = store.forUser(goneId);
  assert.deepEqual(await gone.listTodos({ status: 'all' }), []);
  assert.deepEqual(await gone.listSites(), []);
  assert.deepEqual(await keep.summary(), keepBefore);

  // 같은 Google 계정으로 다시 로그인하면 새 계정(새 id, 예시 데이터부터)
  const againId = await store.upsertUser({ sub: 'google-gone' });
  assert.notEqual(againId, goneId);
  assert.equal((await store.forUser(againId).summary()).total, 4);
});

test('DB에 없는 계정의 쿠키로는 탈퇴·쓰기 불가(401)', async () => {
  assert.equal((await call(sessionCookie(999), 'DELETE', '/api/me')).status, 401);
  assert.equal((await call(sessionCookie(999), 'POST', '/api/todos', { title: 'x' })).status, 401);
});

test('사이트 빼기: 내 사이트만, 항목은 남고 사이트 없음으로', async () => {
  const a = store.forUser(await store.upsertUser({ sub: 'google-site-a' }));
  const b = store.forUser(await store.upsertUser({ sub: 'google-site-b' }));
  const site = (await a.listSites())[0];
  const todo = await a.createTodo({ title: '사이트에 붙은 항목', site_id: site.id });

  assert.equal(await b.deleteSite(site.id), false, '남의 사이트는 못 뺀다');
  assert.equal((await a.getTodo(todo.id)).site_id, site.id);

  assert.equal(await a.deleteSite(site.id), true);
  assert.ok(!(await a.listSites()).some((s) => s.id === site.id));
  assert.equal((await a.getTodo(todo.id)).site_id, null);
  assert.equal(await a.deleteSite(site.id), false);
});

test('서버: DELETE /api/sites/:id — 204, 남의 사이트·없는 사이트 404', async () => {
  const aId = await store.upsertUser({ sub: 'google-site-c' });
  const bId = await store.upsertUser({ sub: 'google-site-d' });
  const site = (await store.forUser(aId).listSites())[0];
  assert.equal((await call(sessionCookie(bId), 'DELETE', `/api/sites/${site.id}`)).status, 404);
  assert.equal((await call(sessionCookie(aId), 'DELETE', `/api/sites/${site.id}`)).status, 204);
  assert.equal((await call(sessionCookie(aId), 'DELETE', `/api/sites/${site.id}`)).status, 404);
});

test('모든 기기에서 로그아웃: 예전 쿠키는 읽기·쓰기 모두 401, 다른 사람은 그대로', async () => {
  const id = await store.upsertUser({ sub: 'google-logout-all' });
  const other = await store.upsertUser({ sub: 'google-logout-other' });
  const phone = sessionCookie(id); // 잃어버린 폰에 남은 쿠키라고 가정
  const pc = sessionCookie(id);
  assert.equal((await call(phone, 'GET', '/api/me')).status, 200);

  const res = await call(pc, 'POST', '/api/logout-all');
  assert.equal(res.status, 204);
  assert.equal((await store.getUser(id)).session_version, 1);
  assert.equal((await call(phone, 'GET', '/api/todos')).status, 401);
  assert.equal((await call(phone, 'POST', '/api/todos', { title: 'x' })).status, 401);
  assert.equal((await call(sessionCookie(id, undefined, 1), 'GET', '/api/me')).status, 200, '새로 로그인한 쿠키는 통과');
  assert.equal((await call(sessionCookie(other), 'GET', '/api/me')).status, 200);
});

test('쿠키 자동 연장: 발급한 지 하루 넘은 쿠키로 요청하면 새 7일 쿠키', async () => {
  const id = await store.upsertUser({ sub: 'google-renew' });
  const fresh = await fetch(`${base}/api/me`, { headers: { cookie: sessionCookie(id, Date.now() + 7 * 86_400_000) } });
  assert.equal(fresh.headers.get('set-cookie'), null, '방금 받은 쿠키는 그대로');
  const old = await fetch(`${base}/api/me`, { headers: { cookie: sessionCookie(id, Date.now() + 3 * 86_400_000) } });
  assert.match(old.headers.get('set-cookie'), /^sid=.*Max-Age=604800.*HttpOnly/i);
});

test('예전 DB(session_version 열 없음)도 서버가 열을 추가해 그대로 쓴다', async () => {
  const { createClient } = await import('@libsql/client');
  const url = pathToFileURL(path.join(TMP, 'old.db')).href;
  const old = createClient({ url });
  await old.execute('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, google_sub TEXT NOT NULL UNIQUE, email TEXT, name TEXT, created_at TEXT)');
  await old.execute("INSERT INTO users (google_sub, email) VALUES ('google-old', 'old@example.com')");
  old.close();

  const migrated = createTursoStore({ url, sqlDir: fileURLToPath(new URL('../db', import.meta.url)), dataKey: process.env.DATA_ENCRYPTION_KEY });
  const user = await migrated.getUser(1);
  assert.equal(user.email, 'old@example.com');
  assert.equal(user.session_version, 0);
});

// ---------- 저장 시 암호화 ----------
const { createClient } = await import('@libsql/client');
const raw = createClient({ url: DB_URL }); // DB 파일을 통째로 훔쳐 간 사람의 시점

test('암호화: DB에는 자물쇠와 암호문만, 앱에서는 원래 글자 그대로', async () => {
  const id = await store.upsertUser({ sub: 'enc-a' });
  const a = store.forUser(id);
  const todo = await a.createTodo({ title: '결제 서버 점검 비밀 작전', memo: '아무도 몰라야 하는 메모' });
  assert.equal(todo.title, '결제 서버 점검 비밀 작전');
  assert.equal(todo.memo, '아무도 몰라야 하는 메모');
  assert.equal(todo.title_enc, undefined, '암호문 칸은 응답에 없음');

  const row = (await raw.execute({ sql: 'SELECT * FROM todos WHERE id = ?', args: [todo.id] })).rows[0];
  assert.equal(row.title, '🔒');
  assert.equal(row.memo, null);
  assert.match(row.title_enc, /^v1\./);
  assert.doesNotMatch(JSON.stringify(row), /비밀 작전|몰라야/);

  const updated = await a.updateTodo(todo.id, { memo: null, title: '바꾼 제목' });
  assert.equal(updated.title, '바꾼 제목');
  assert.equal(updated.memo, null);
  const all = (await raw.execute('SELECT title, memo FROM todos')).rows;
  assert.ok(all.every((r) => r.title === '🔒' && r.memo === null), '예시 데이터까지 전부 암호화');
});

test('암호화: 암호문을 남의 항목으로 옮겨 붙이면 읽을 수 없다', async () => {
  const a = store.forUser(await store.upsertUser({ sub: 'enc-b' }));
  const bId = await store.upsertUser({ sub: 'enc-c' });
  const mine = await a.createTodo({ title: 'A의 항목' });
  const theirs = await store.forUser(bId).createTodo({ title: 'B의 항목' });
  await raw.execute({
    sql: 'UPDATE todos SET title_enc = (SELECT title_enc FROM todos WHERE id = ?) WHERE id = ?',
    args: [mine.id, theirs.id],
  });
  await assert.rejects(store.forUser(bId).getTodo(theirs.id));
});

test('암호화: 예전 평문 DB는 서버가 열을 추가하고 기존 항목을 암호화한다', async () => {
  const url = pathToFileURL(path.join(TMP, 'plain.db')).href;
  const old = createClient({ url });
  await old.execute('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, google_sub TEXT NOT NULL UNIQUE, email TEXT, name TEXT, created_at TEXT)');
  await old.execute(`CREATE TABLE todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
    memo TEXT, site_id INTEGER, category_id INTEGER, due_date TEXT, is_done INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await old.execute("INSERT INTO users (google_sub) VALUES ('plain-user')");
  await old.execute("INSERT INTO todos (user_id, title, memo) VALUES (1, '예전 평문 제목', '예전 메모')");

  const migrated = createTursoStore({ url, sqlDir: fileURLToPath(new URL('../db', import.meta.url)), dataKey: process.env.DATA_ENCRYPTION_KEY });
  const [todo] = await migrated.forUser(1).listTodos({ status: 'all' });
  assert.equal(todo.title, '예전 평문 제목');
  assert.equal(todo.memo, '예전 메모');
  const row = (await old.execute('SELECT title, memo, title_enc FROM todos')).rows[0];
  assert.equal(row.title, '🔒');
  assert.equal(row.memo, null);
  assert.match(row.title_enc, /^v1\./);
  old.close();
});

test('암호화: 키가 다르면 읽을 수 없고, 키 형식이 틀리면 시작하지 않는다', async () => {
  const other = createTursoStore({ url: DB_URL, sqlDir: fileURLToPath(new URL('../db', import.meta.url)), dataKey: Buffer.alloc(32, 9).toString('base64') });
  const id = await store.upsertUser({ sub: 'enc-a' });
  await assert.rejects(other.forUser(id).listTodos({ status: 'all' }));
  assert.throws(() => createTursoStore({ url: DB_URL, sqlDir: '.', dataKey: 'too-short' }), /32바이트/);
});

// ---------- 완료 항목 자동 정리 ----------
test('자동 정리: 완료 후 90일 지난 항목만, 그 사람 것만 지운다', async () => {
  const id = await store.upsertUser({ sub: 'cleanup-a' });
  const otherId = await store.upsertUser({ sub: 'cleanup-b' });
  const a = store.forUser(id);
  const old = await a.updateTodo((await a.createTodo({ title: '오래전에 끝낸 일' })).id, { is_done: 1 });
  const recent = await a.updateTodo((await a.createTodo({ title: '최근에 끝낸 일' })).id, { is_done: 1 });
  const open = await a.createTodo({ title: '아직 안 끝낸 일' });
  const others = await store.forUser(otherId).updateTodo((await store.forUser(otherId).createTodo({ title: '남의 오래된 완료' })).id, { is_done: 1 });
  const ago = "datetime('now', '+9 hours', '-91 days')";
  await raw.execute({ sql: `UPDATE todos SET completed_at = ${ago} WHERE id IN (?, ?)`, args: [old.id, others.id] });

  assert.equal(await store.purgeCompleted(id, 90), 1);
  assert.equal(await a.getTodo(old.id), null);
  assert.ok(await a.getTodo(recent.id));
  assert.ok(await a.getTodo(open.id));
  assert.ok(await store.forUser(otherId).getTodo(others.id), '다른 사람 것은 그 사람이 쓸 때 정리');
});

test('자동 정리: 앱을 쓰면 서버가 하루 한 번 알아서 정리, /api/me가 기간을 알려 줌', async () => {
  const id = await store.upsertUser({ sub: 'cleanup-c' });
  const a = store.forUser(id);
  const old = await a.updateTodo((await a.createTodo({ title: '옛 기록' })).id, { is_done: 1 });
  await raw.execute({ sql: "UPDATE todos SET completed_at = datetime('now', '+9 hours', '-100 days') WHERE id = ?", args: [old.id] });
  const me = await call(sessionCookie(id), 'GET', '/api/me');
  assert.equal(me.data.cleanupDays, 90);
  assert.equal(await a.getTodo(old.id), null);
});
