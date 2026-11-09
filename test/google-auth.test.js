// Google 로그인(lib/google-auth.js) 테스트 — 가짜 Google 토큰 서버로 로그인 성공·실패 흐름을 확인한다
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createGoogleAuth } from '../lib/google-auth.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
let idTokenClaims = {};
let lastTokenRequest = null;

// 가짜 Google 토큰 서버
const google = express();
google.use(express.urlencoded({ extended: false }));
google.post('/token', (req, res) => {
  lastTokenRequest = req.body;
  const payload = Buffer.from(JSON.stringify(idTokenClaims)).toString('base64url');
  res.json({ id_token: `x.${payload}.y`, access_token: 'unused' });
});
const googleServer = google.listen(0, '127.0.0.1');
await new Promise((resolve) => googleServer.once('listening', resolve));

const upserted = [];
const auth = createGoogleAuth({
  clientId: CLIENT_ID,
  clientSecret: 'test-secret',
  sessionSecret: 'test-session-secret-0123456789abcdef',
  users: { upsertUser: async (user) => (upserted.push(user), 42) },
  tokenUrl: `http://127.0.0.1:${googleServer.address().port}/token`,
});

const app = express();
app.get('/auth/google', auth.start);
app.get('/auth/callback', auth.callback);
app.get('/whoami', (req, res) => res.json({ uid: auth.userId(req) }));
app.use((err, req, res, next) => res.status(err.status ?? 500).json({ error: err.message }));
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  googleServer.close();
});

const cookieOf = (res, name) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(';')[0];

async function loginWith(claims) {
  idTokenClaims = claims;
  const start = await fetch(`${base}/auth/google`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  return fetch(`${base}/auth/callback?code=good-code&state=${state}`, {
    redirect: 'manual',
    headers: { cookie: cookieOf(start, 'g_login') },
  });
}

const validClaims = () => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: 'google-123',
  email: 'me@example.com',
  name: '나',
  exp: Math.floor(Date.now() / 1000) + 300,
});

test('로그인 성공: code+verifier를 서버가 교환하고, 서명한 HttpOnly 세션 쿠키 발급', async () => {
  const res = await loginWith(validClaims());
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/');
  assert.equal(lastTokenRequest.code, 'good-code');
  assert.equal(lastTokenRequest.client_secret, 'test-secret');
  assert.ok(lastTokenRequest.code_verifier.length >= 43);
  assert.deepEqual(upserted.at(-1), { sub: 'google-123', email: 'me@example.com', name: '나' });

  const sid = cookieOf(res, 'sid');
  assert.ok(sid);
  assert.match(res.headers.getSetCookie().find((c) => c.startsWith('sid=')), /HttpOnly/i);
  const who = await fetch(`${base}/whoami`, { headers: { cookie: sid } });
  assert.deepEqual(await who.json(), { uid: 42 });
});

test('다른 앱(aud)·다른 발급자·만료된 토큰은 거부', async () => {
  for (const bad of [{ aud: 'other-app' }, { iss: 'https://evil.example' }, { exp: 1 }]) {
    const res = await loginWith({ ...validClaims(), ...bad });
    assert.match(res.headers.get('location'), /^\/\?login_error=/, JSON.stringify(bad));
    assert.equal(cookieOf(res, 'sid'), undefined);
  }
});

test('로그인 쿠키(g_login) 없이 돌아오면 거부 (다른 사람이 만든 로그인 링크 방지)', async () => {
  const res = await fetch(`${base}/auth/callback?code=good-code&state=anything`, { redirect: 'manual' });
  assert.match(res.headers.get('location'), /^\/\?login_error=/);
});

test('SESSION_SECRET이 짧으면 서버가 시작을 거부', () => {
  assert.throws(() => createGoogleAuth({ clientId: 'x', sessionSecret: 'short' }), /32자/);
});
