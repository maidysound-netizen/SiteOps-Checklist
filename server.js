// SiteOps Checklist — Express 서버 (나 혼자 쓰는 로컬 앱, SQLite 저장)
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, notFound } from './lib/errors.js';
import { createSqliteStore } from './lib/store-sqlite.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const store = createSqliteStore({
  dbPath: process.env.DB_PATH ?? path.join(ROOT, 'db', 'siteops.db'),
  sqlDir: path.join(ROOT, 'db'),
});

// ---------- 입력 검증 ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['all', 'open', 'done', 'overdue'];
const MEMO_MAX = 1000;

function toOptionalId(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `${label} 값이 올바르지 않습니다.`);
  return id;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}

// 요청 본문 → 허용된 컬럼만 담은 객체. partial=true면 들어온 필드만 검사(PATCH)
function parseTodoInput(body = {}, { partial = false } = {}) {
  const has = (key) => Object.hasOwn(body, key);
  const out = {};

  // 타입부터 확인한다 (객체가 '[object Object]'로, 문자열 "false"가 참으로 저장되는 것 방지)
  if (!partial || has('title')) {
    if (typeof body.title !== 'string') throw new HttpError(400, '제목은 1~100자로 입력해 주세요.');
    const title = body.title.trim();
    if (title.length < 1 || title.length > 100) throw new HttpError(400, '제목은 1~100자로 입력해 주세요.');
    out.title = title;
  }
  if (has('memo')) {
    if (body.memo !== null && typeof body.memo !== 'string') throw new HttpError(400, '메모는 글자로 입력해 주세요.');
    const memo = (body.memo ?? '').trim();
    if (memo.length > MEMO_MAX) throw new HttpError(400, `메모는 ${MEMO_MAX}자 이하로 입력해 주세요.`);
    out.memo = memo || null;
  }
  if (has('site_id')) out.site_id = toOptionalId(body.site_id, '사이트');
  if (has('category_id')) out.category_id = toOptionalId(body.category_id, '카테고리');
  if (has('due_date')) {
    const due = body.due_date || null;
    if (due !== null && !DATE_RE.test(due)) throw new HttpError(400, '마감일은 YYYY-MM-DD 형식이어야 합니다.');
    out.due_date = due;
  }
  if (has('is_done')) {
    if (typeof body.is_done !== 'boolean') throw new HttpError(400, 'is_done은 true 또는 false여야 합니다.');
    out.is_done = body.is_done ? 1 : 0;
  }

  return out;
}

function parseSiteInput(body = {}) {
  const name = String(body.name ?? '').trim();
  if (name.length < 1 || name.length > 50) throw new HttpError(400, '사이트 이름은 1~50자로 입력해 주세요.');
  const url = String(body.url ?? '').trim() || null;
  if (url !== null && !/^https?:\/\/\S+$/.test(url)) throw new HttpError(400, '주소는 http:// 또는 https://로 시작해야 합니다.');
  return { name, url };
}

// ---------- API ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/todos', async (req, res) => {
  const status = req.query.status ?? 'all';
  if (!STATUSES.includes(status)) throw new HttpError(400, '상태 필터가 올바르지 않습니다.');
  res.json(
    await store.listTodos({
      site: toOptionalId(req.query.site, '사이트'),
      category: toOptionalId(req.query.category, '카테고리'),
      status,
    }),
  );
});

app.get('/api/todos/:id', async (req, res) => {
  const todo = await store.getTodo(parseId(req.params.id));
  if (!todo) throw notFound();
  res.json(todo);
});

app.post('/api/todos', async (req, res) => {
  res.status(201).json(await store.createTodo(parseTodoInput(req.body)));
});

app.patch('/api/todos/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const input = parseTodoInput(req.body, { partial: true });
  if (Object.keys(input).length === 0) throw new HttpError(400, '수정할 내용이 없습니다.');
  const todo = await store.updateTodo(id, input);
  if (!todo) throw notFound();
  res.json(todo);
});

app.delete('/api/todos/:id', async (req, res) => {
  if (!(await store.deleteTodo(parseId(req.params.id)))) throw notFound();
  res.status(204).end();
});

app.get('/api/categories', async (req, res) => {
  res.json(await store.listCategories());
});

app.get('/api/sites', async (req, res) => {
  res.json(await store.listSites());
});

app.post('/api/sites', async (req, res) => {
  res.status(201).json(await store.createSite(parseSiteInput(req.body)));
});

app.get('/api/summary', async (req, res) => {
  res.json(await store.summary());
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: '없는 API 경로입니다.' });
});

// ---------- 오류 처리 ----------
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '요청 형식(JSON)이 올바르지 않습니다.' });
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

// ---------- 시작 ----------
// 테스트는 NO_LISTEN=1로 불러와 직접 띄운다
if (!process.env.NO_LISTEN) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`SiteOps Checklist → http://localhost:${PORT}  (DB: ${store.label})`);
  });
}

export default app;
