// SiteOps Checklist — Express 서버
// 저장소: 기본 SQLite(로그인 없음), .env에 DB_DRIVER=turso 이면 Turso(클라우드 SQLite) + Google 로그인
// 로그인은 서버가 직접 처리한다 (lib/google-auth.js). 브라우저에는 DB 주소·토큰·Client Secret이 없다.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, notFound } from './lib/errors.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const ON_VERCEL = Boolean(process.env.VERCEL);

// ---------- 저장소 선택 ----------
// 쓰는 저장소만 불러온다 (Vercel에는 SQLite 파일을 쓸 수 없음)
async function createStore() {
  const driver = process.env.DB_DRIVER ?? 'sqlite';
  const sqlDir = path.join(ROOT, 'db');
  if (driver === 'sqlite') {
    if (ON_VERCEL) throw new Error('Vercel에서는 SQLite 파일을 쓸 수 없습니다. 환경 변수에 DB_DRIVER=turso를 설정해 주세요.');
    const { createSqliteStore } = await import('./lib/store-sqlite.js');
    return { store: createSqliteStore({ dbPath: process.env.DB_PATH ?? path.join(sqlDir, 'siteops.db'), sqlDir }) };
  }
  if (driver === 'turso') {
    const env = process.env;
    const missing = ['TURSO_DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET'].filter((k) => !env[k]);
    if (missing.length) throw new Error(`DB_DRIVER=turso 이면 ${missing.join(', ')}가 필요합니다. (.env.example 참고)`);
    const { createTursoStore } = await import('./lib/store-turso.js');
    const { createGoogleAuth } = await import('./lib/google-auth.js');
    const store = createTursoStore({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN, sqlDir });
    const auth = createGoogleAuth({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      sessionSecret: env.SESSION_SECRET,
      users: store,
    });
    return { store, auth };
  }
  throw new Error(`알 수 없는 DB_DRIVER: ${driver} (sqlite 또는 turso)`);
}

const { store, auth } = await createStore();

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
// Vercel 프록시 뒤에서만 X-Forwarded-* 헤더를 믿는다 (https 주소·Secure 쿠키 판단)
if (ON_VERCEL) app.set('trust proxy', true);
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

// 쓰기 요청은 우리 화면(app.js)이 붙이는 헤더가 있어야 한다.
// 로그인이 쿠키 방식이라, 다른 사이트가 몰래 보내는 요청(CSRF)을 막기 위함 (다른 사이트는 이 헤더를 붙이면 CORS에 막힘)
app.use(['/api', '/auth'], (req, res, next) => {
  if (req.method !== 'GET' && req.get('x-requested-with') !== 'fetch') throw new HttpError(403, '잘못된 요청입니다.');
  next();
});

// Google 로그인 (Turso 모드에서만)
if (auth) {
  app.get('/auth/google', auth.start);
  app.get('/auth/callback', auth.callback);
  app.post('/auth/logout', auth.logout);
}

// 로그인 모드: 세션 쿠키의 사용자 id로 그 사람 범위의 저장소를 만든다 (모든 쿼리가 user_id로 걸러짐)
// 쓰기 요청은 계정이 아직 있는지도 확인한다 (탈퇴한 계정의 다른 기기 쿠키로는 아무것도 못 쓰게)
app.use('/api', async (req, res, next) => {
  if (!auth) {
    req.store = store;
    return next();
  }
  req.userId = auth.userId(req);
  if (req.method !== 'GET' && !(await store.getUser(req.userId))) throw new HttpError(401, '로그인이 필요합니다.');
  req.store = store.forUser(req.userId);
  next();
});

// 화면이 로그인 상태를 확인하는 값 (SQLite 모드는 로그인 없음)
app.get('/api/me', async (req, res) => {
  if (!auth) return res.json({ auth: false });
  const user = await store.getUser(req.userId);
  if (!user) throw new HttpError(401, '로그인이 필요합니다.');
  res.json({ auth: true, email: user.email });
});

// 서비스 탈퇴: 계정과 모든 사이트·점검 항목 삭제, 로그인 쿠키 삭제
app.delete('/api/me', async (req, res) => {
  if (!auth) throw new HttpError(400, '로그인 모드에서만 탈퇴할 수 있습니다.');
  await store.deleteUser(req.userId);
  auth.logout(req, res);
});

app.get('/api/todos', async (req, res) => {
  const status = req.query.status ?? 'all';
  if (!STATUSES.includes(status)) throw new HttpError(400, '상태 필터가 올바르지 않습니다.');
  res.json(
    await req.store.listTodos({
      site: toOptionalId(req.query.site, '사이트'),
      category: toOptionalId(req.query.category, '카테고리'),
      status,
    }),
  );
});

app.get('/api/todos/:id', async (req, res) => {
  const todo = await req.store.getTodo(parseId(req.params.id));
  if (!todo) throw notFound();
  res.json(todo);
});

app.post('/api/todos', async (req, res) => {
  res.status(201).json(await req.store.createTodo(parseTodoInput(req.body)));
});

app.patch('/api/todos/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const input = parseTodoInput(req.body, { partial: true });
  if (Object.keys(input).length === 0) throw new HttpError(400, '수정할 내용이 없습니다.');
  const todo = await req.store.updateTodo(id, input);
  if (!todo) throw notFound();
  res.json(todo);
});

app.delete('/api/todos/:id', async (req, res) => {
  if (!(await req.store.deleteTodo(parseId(req.params.id)))) throw notFound();
  res.status(204).end();
});

app.get('/api/categories', async (req, res) => {
  res.json(await req.store.listCategories());
});

app.get('/api/sites', async (req, res) => {
  res.json(await req.store.listSites());
});

app.post('/api/sites', async (req, res) => {
  res.status(201).json(await req.store.createSite(parseSiteInput(req.body)));
});

app.get('/api/summary', async (req, res) => {
  res.json(await req.store.summary());
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
// Vercel은 export한 app을 직접 실행하므로 listen하지 않는다 (테스트도 NO_LISTEN=1로 직접 띄움)
if (!ON_VERCEL && !process.env.NO_LISTEN) {
  try {
    await store.check?.();
  } catch (err) {
    console.error(`DB 연결 확인 실패: ${err.message}`);
    process.exit(1);
  }

  // 내 컴퓨터에서만 접속 가능 (같은 와이파이의 다른 기기에서는 접속 불가)
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`SiteOps Checklist → http://localhost:${PORT}  (DB: ${store.label})`);
  });
}

export default app;
