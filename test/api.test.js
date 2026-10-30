// API 자동 테스트 — SQLite 메모리 DB로 서버를 띄워 실제 HTTP 요청을 보낸다
// 실행: npm test   (Node 내장 node:test, 설치할 것 없음)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NO_LISTEN = '1';
process.env.DB_DRIVER = 'sqlite';
process.env.DB_PATH = ':memory:';
const { default: app } = await import('../server.js');

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api`;
after(() => server.close());

async function call(method, path, body, { raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

const create = (body) => call('POST', '/todos', body);

// ---------- 조회 ----------
test('예시 데이터 요약: 전체 4, 미완료 3, 완료 1, 기한 지남 1', async () => {
  const { status, data } = await call('GET', '/summary');
  assert.equal(status, 200);
  assert.deepEqual(data, { total: 4, open: 3, done: 1, overdue: 1 });
});

test('목록 정렬: 미완료 먼저, 그 안에서 마감일 빠른 순', async () => {
  const { data } = await call('GET', '/todos');
  const firstDone = data.findIndex((t) => t.is_done);
  assert.ok(data.slice(firstDone).every((t) => t.is_done), '완료 항목은 뒤에 모여야 함');
  const dues = data.slice(0, firstDone).map((t) => t.due_date).filter(Boolean);
  assert.deepEqual(dues, [...dues].sort());
});

test('기한 지남 필터는 어제 마감 1건만', async () => {
  const { data } = await call('GET', '/todos?status=overdue');
  assert.equal(data.length, 1);
  assert.equal(data[0].due_status, 'overdue');
});

test('잘못된 필터는 400', async () => {
  assert.equal((await call('GET', '/todos?status=xxx')).status, 400);
  assert.equal((await call('GET', '/todos?category=abc')).status, 400);
});

// ---------- 추가 ----------
test('추가: 제목 앞뒤 공백 제거, 201', async () => {
  const { status, data } = await create({ title: '  점검  ' });
  assert.equal(status, 201);
  assert.equal(data.title, '점검');
});

test('제목: 빈 값·101자·문자열이 아닌 값은 400', async () => {
  for (const title of ['   ', 'a'.repeat(101), { a: 1 }, 123, null]) {
    assert.equal((await create({ title })).status, 400, JSON.stringify(title));
  }
  assert.equal((await create({})).status, 400);
});

test('메모: 1000자까지 허용, 1001자·문자열이 아닌 값은 400', async () => {
  assert.equal((await create({ title: 'm', memo: 'a'.repeat(1000) })).status, 201);
  assert.equal((await create({ title: 'm', memo: 'a'.repeat(1001) })).status, 400);
  assert.equal((await create({ title: 'm', memo: { a: 1 } })).status, 400);
  assert.equal((await create({ title: 'm', memo: null })).status, 201);
});

test('마감일: 형식 오류·없는 날짜는 400', async () => {
  assert.equal((await create({ title: 'd', due_date: '2026/11/05' })).status, 400);
  assert.equal((await create({ title: 'd', due_date: '2026-02-30' })).status, 400);
});

test('없는 카테고리는 400', async () => {
  const { status, data } = await create({ title: 'c', category_id: 999 });
  assert.equal(status, 400);
  assert.match(data.error, /존재하지 않는/);
});

test('깨진 JSON은 400', async () => {
  const { status, data } = await call('POST', '/todos', undefined, { raw: '{bad' });
  assert.equal(status, 400);
  assert.match(data.error, /JSON/);
});

test('허용되지 않은 필드(id, completed_at)는 무시', async () => {
  const { status, data } = await create({ title: 'x', id: 777, completed_at: 'x' });
  assert.equal(status, 201);
  assert.notEqual(data.id, 777);
  assert.equal(data.completed_at, null);
});

// ---------- 수정 ----------
test('완료 토글: true면 completed_at 기록, false면 비움', async () => {
  const { data: todo } = await create({ title: '토글' });
  const done = await call('PATCH', `/todos/${todo.id}`, { is_done: true });
  assert.equal(done.data.is_done, 1);
  assert.ok(done.data.completed_at);
  const undone = await call('PATCH', `/todos/${todo.id}`, { is_done: false });
  assert.equal(undone.data.is_done, 0);
  assert.equal(undone.data.completed_at, null);
});

test('is_done이 boolean이 아니면 400 (문자열 "false"가 완료로 저장되던 문제)', async () => {
  const { data: todo } = await create({ title: '타입' });
  for (const is_done of ['false', '0', 1, null]) {
    assert.equal((await call('PATCH', `/todos/${todo.id}`, { is_done })).status, 400, JSON.stringify(is_done));
  }
  assert.equal((await call('GET', `/todos/${todo.id}`)).data.is_done, 0);
});

test('수정 창에서 마감일·사이트·카테고리를 비우면 null로 저장', async () => {
  const { data: todo } = await create({ title: '비우기', due_date: '2030-01-01', site_id: 1, category_id: 1 });
  // 화면의 수정 창은 빈 칸을 ''로 보낸다
  const { status, data } = await call('PATCH', `/todos/${todo.id}`, {
    title: '비우기', site_id: '', category_id: '', due_date: '', memo: '',
  });
  assert.equal(status, 200);
  assert.equal(data.due_date, null);
  assert.equal(data.site_id, null);
  assert.equal(data.category_id, null);
  assert.equal(data.memo, null);
});

test('빈 수정은 400, 없는 항목은 404', async () => {
  const { data: todo } = await create({ title: '빈 수정' });
  assert.equal((await call('PATCH', `/todos/${todo.id}`, {})).status, 400);
  assert.equal((await call('PATCH', '/todos/9999', { title: 'x' })).status, 404);
  assert.equal((await call('GET', '/todos/abc')).status, 404);
});

// ---------- 삭제 ----------
test('삭제 후 다시 삭제하면 404', async () => {
  const { data: todo } = await create({ title: '삭제' });
  assert.equal((await call('DELETE', `/todos/${todo.id}`)).status, 204);
  assert.equal((await call('DELETE', `/todos/${todo.id}`)).status, 404);
});

// ---------- 사이트 ----------
test('사이트 추가 201, 같은 이름 409, http(s)가 아닌 주소 400', async () => {
  assert.equal((await call('POST', '/sites', { name: '새 사이트', url: 'https://example.com' })).status, 201);
  assert.equal((await call('POST', '/sites', { name: '새 사이트' })).status, 409);
  assert.equal((await call('POST', '/sites', { name: '나쁜 주소', url: 'javascript:alert(1)' })).status, 400);
});

// ---------- 기타 ----------
test('SQLite 모드는 로그인 없음, 없는 API는 404', async () => {
  assert.deepEqual((await call('GET', '/config')).data, { auth: false });
  assert.equal((await call('GET', '/nope')).status, 404);
});
