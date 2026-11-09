// Turso 모드 테스트 — 메모리 libSQL DB로 서버를 띄운다 (실제 Turso·Google에는 접속하지 않음)
// 세션 쿠키는 서버와 같은 SESSION_SECRET으로 직접 만들어 로그인한 상태를 흉내 낸다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SECRET = 'test-session-secret-0123456789abcdef';
Object.assign(process.env, {
  NO_LISTEN: '1',
  DB_DRIVER: 'turso',
  TURSO_DATABASE_URL: ':memory:',
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  SESSION_SECRET: SECRET,
});
const { default: app } = await import('../server.js');
const { createTursoStore } = await import('../lib/store-turso.js');

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

function sessionCookie(uid, exp = Date.now() + 60_000) {
  const data = Buffer.from(JSON.stringify({ uid, exp })).toString('base64url');
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
const store = createTursoStore({ url: ':memory:', sqlDir: fileURLToPath(new URL('../db', import.meta.url)) });

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
