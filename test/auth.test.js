// 서버 로그인(lib/auth.js) 테스트 — Supabase에 접속하지 않고 확인할 수 있는 부분만
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { createAuth } from '../lib/auth.js';

const SUPABASE = 'https://example.supabase.co';
const auth = createAuth({ url: SUPABASE, key: 'sb_publishable_test' });

const app = express();
app.get('/auth/google', auth.start);
app.get('/auth/callback', auth.callback);
app.get('/token', async (req, res) => res.json({ token: await auth.token(req, res) }));
app.use((err, req, res, next) => res.status(err.status ?? 500).json({ error: err.message }));

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const get = (path, cookie) => fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });

test('/auth/google: PKCE verifier를 HttpOnly 쿠키에 두고 Supabase 로그인으로 보낸다', async () => {
  const res = await get('/auth/google');
  assert.equal(res.status, 302);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^sb_pkce=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  const location = new URL(res.headers.get('location'));
  assert.equal(location.origin + location.pathname, `${SUPABASE}/auth/v1/authorize`);
  assert.equal(location.searchParams.get('provider'), 'google');
  assert.equal(location.searchParams.get('redirect_to'), `${base}/auth/callback`);
  const verifier = cookie.match(/^sb_pkce=([^;]+)/)[1];
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.equal(location.searchParams.get('code_challenge'), challenge);
});

test('/auth/callback: code나 verifier가 없으면 로그인 오류와 함께 첫 화면으로', async () => {
  const res = await get('/auth/callback?code=abc');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/\?login_error=/);
});

test('토큰 쿠키가 없으면 401', async () => {
  assert.equal((await get('/token')).status, 401);
});

test('만료되지 않은 access 토큰은 그대로 사용', async () => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, email: 'me@example.com' }));
  const token = `x.${payload.toString('base64url')}.y`;
  const res = await get('/token', `sb_access=${token}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).token, token);
  assert.equal(auth.email(token), 'me@example.com');
});
