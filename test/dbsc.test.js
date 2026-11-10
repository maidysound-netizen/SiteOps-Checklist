// DBSC 테스트 — "가짜 지원 브라우저"가 기기 키를 만들어 등록·갱신하는 흐름을 그대로 흉내 낸다
// 임시 파일 libSQL DB로 서버를 띄운다 (실제 Turso·Google에는 접속하지 않음)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SECRET = 'dbsc-test-session-secret-0123456789abcdef';
const TMP = mkdtempSync(path.join(os.tmpdir(), 'siteops-dbsc-test-'));
const DB_URL = pathToFileURL(path.join(TMP, 'test.db')).href;
Object.assign(process.env, {
  NO_LISTEN: '1',
  DB_DRIVER: 'turso',
  TURSO_DATABASE_URL: DB_URL,
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  SESSION_SECRET: SECRET,
});
const { default: app } = await import('../server.js');
const { createTursoStore } = await import('../lib/store-turso.js');
const store = createTursoStore({ url: DB_URL, sqlDir: fileURLToPath(new URL('../db', import.meta.url)) });

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  rmSync(TMP, { recursive: true, force: true });
});

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function sessionCookie(uid, v = 0) {
  const data = b64({ uid, v, exp: Date.now() + 60_000 });
  return `sid=${data}.${crypto.createHmac('sha256', SECRET).update(data).digest('base64url')}`;
}

// 기기 키로 서명한 증명 JWT (ES256 = r‖s)
function proof(privateKey, jti, { jwk } = {}) {
  const header = b64({ alg: 'ES256', typ: 'dbsc+jwt', ...(jwk && { jwk }) });
  const payload = b64({ jti });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${sig.toString('base64url')}`;
}

function newDeviceKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) };
}

// Set-Cookie에서 이름=값만 꺼낸다
function cookiesFrom(res) {
  return Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(';')[0].split(/=(.*)/s).slice(0, 2)));
}

const sfParam = (header, name) => header.match(new RegExp(`${name}="([^"]*)"`))?.[1];

async function api(cookie, method = 'GET', pathname = '/api/me') {
  return fetch(base + pathname, { method, headers: { cookie, 'X-Requested-With': 'fetch' } });
}

// 로그인 → 등록 제안 받기 → 기기 키로 등록. 등록 후 쿠키 묶음을 돌려준다
async function registerDevice(sub) {
  const uid = await store.upsertUser({ sub });
  const sid = sessionCookie(uid);
  const me = await api(sid);
  const offer = me.headers.get('secure-session-registration');
  assert.match(offer, /^\(ES256 RS256\);path="\/auth\/dbsc\/register";challenge="/);
  const device = newDeviceKey();
  const res = await fetch(base + sfParam(offer, 'path'), {
    method: 'POST',
    headers: { cookie: sid, 'Secure-Session-Response': `"${proof(device.privateKey, sfParam(offer, 'challenge'), device)}"` },
  });
  return { uid, sid, device, res, offer };
}

test('등록 제안 → 기기 키로 등록 → 세션 설정 JSON과 기기 쿠키', async () => {
  const { res } = await registerDevice('dbsc-a');
  assert.equal(res.status, 200);
  const config = await res.json();
  assert.equal(config.refresh_url, '/auth/dbsc/refresh');
  assert.equal(config.credentials[0].name, 'sid_dev');
  assert.equal(config.scope.include_site, false);
  assert.ok(config.session_identifier);
  const cookies = cookiesFrom(res);
  assert.ok(cookies.sid && cookies.sid_dev);
  assert.match(res.headers.getSetCookie().find((c) => c.startsWith('sid_dev=')), /Max-Age=600.*HttpOnly.*SameSite=Lax/i);
});

test('기기에 묶인 뒤: 두 쿠키 모두 있어야 통과, 로그인 쿠키만 복사해 가면 401, 더 이상 등록 제안 없음', async () => {
  const { res } = await registerDevice('dbsc-b');
  const { sid, sid_dev } = cookiesFrom(res);
  const both = await api(`sid=${sid}; sid_dev=${sid_dev}`);
  assert.equal(both.status, 200);
  assert.equal((await both.json()).deviceBound, true);
  assert.equal(both.headers.get('secure-session-registration'), null);
  assert.equal((await api(`sid=${sid}`)).status, 401, '훔친 로그인 쿠키만으로는 안 됨');
});

test('갱신: 문제(403) → 기기 키 서명 → 새 기기 쿠키', async () => {
  const { res, device } = await registerDevice('dbsc-c');
  const { session_identifier: ds } = await res.json();
  const { sid } = cookiesFrom(res);

  const first = await fetch(`${base}/auth/dbsc/refresh`, { method: 'POST', headers: { 'Sec-Secure-Session-Id': `"${ds}"` } });
  assert.equal(first.status, 403);
  const challengeHeader = first.headers.get('secure-session-challenge');
  assert.match(challengeHeader, new RegExp(`;id="${ds}"$`));
  const challenge = challengeHeader.match(/^"([^"]*)"/)[1];

  const second = await fetch(`${base}/auth/dbsc/refresh`, {
    method: 'POST',
    headers: { 'Sec-Secure-Session-Id': `"${ds}"`, 'Secure-Session-Response': `"${proof(device.privateKey, challenge)}"` },
  });
  assert.equal(second.status, 200);
  const { sid_dev } = cookiesFrom(second);
  assert.equal((await api(`sid=${sid}; sid_dev=${sid_dev}`)).status, 200);
});

test('다른 키로 서명한 갱신은 401, 다른 기기 세션의 문제는 다시 403', async () => {
  const a = await registerDevice('dbsc-d');
  const b = await registerDevice('dbsc-e');
  const dsA = (await a.res.json()).session_identifier;
  const dsB = (await b.res.json()).session_identifier;
  const challengeFor = async (ds) =>
    (await fetch(`${base}/auth/dbsc/refresh`, { method: 'POST', headers: { 'Sec-Secure-Session-Id': ds } }))
      .headers.get('secure-session-challenge').match(/^"([^"]*)"/)[1];

  const attacker = newDeviceKey();
  const forged = await fetch(`${base}/auth/dbsc/refresh`, {
    method: 'POST',
    headers: { 'Sec-Secure-Session-Id': dsA, 'Secure-Session-Response': proof(attacker.privateKey, await challengeFor(dsA)) },
  });
  assert.equal(forged.status, 401);
  assert.equal(forged.headers.getSetCookie().length, 0);

  const wrongChallenge = await fetch(`${base}/auth/dbsc/refresh`, {
    method: 'POST',
    headers: { 'Sec-Secure-Session-Id': dsA, 'Secure-Session-Response': proof(a.device.privateKey, await challengeFor(dsB)) },
  });
  assert.equal(wrongChallenge.status, 403);
  assert.equal(wrongChallenge.headers.getSetCookie().length, 0);
});

test('등록: 남의 문제·위조 증명·CSRF 헤더 없이도 서명이 틀리면 400', async () => {
  const uidA = await store.upsertUser({ sub: 'dbsc-f' });
  const uidB = await store.upsertUser({ sub: 'dbsc-g' });
  const offerA = (await api(sessionCookie(uidA))).headers.get('secure-session-registration');
  const device = newDeviceKey();
  const register = (cookie, token) =>
    fetch(`${base}/auth/dbsc/register`, { method: 'POST', headers: { cookie, 'Secure-Session-Response': token } });

  assert.equal((await register(sessionCookie(uidB), proof(device.privateKey, sfParam(offerA, 'challenge'), device))).status, 400);
  const other = newDeviceKey();
  assert.equal((await register(sessionCookie(uidA), proof(other.privateKey, sfParam(offerA, 'challenge'), device))).status, 400);
  assert.equal((await register(sessionCookie(uidA), 'not-a-jwt')).status, 400);
  assert.equal((await register('', proof(device.privateKey, sfParam(offerA, 'challenge'), device))).status, 401);
});

test('로그아웃·모든 기기 로그아웃·탈퇴 뒤 갱신하면 {"continue": false}', async () => {
  const check = async (ds) => {
    const res = await fetch(`${base}/auth/dbsc/refresh`, { method: 'POST', headers: { 'Sec-Secure-Session-Id': ds } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const one = await registerDevice('dbsc-h');
  const ds1 = (await one.res.json()).session_identifier;
  const c1 = cookiesFrom(one.res);
  assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: `sid=${c1.sid}`, 'X-Requested-With': 'fetch' } })).status, 204);
  assert.deepEqual(await check(ds1), { status: 200, body: { continue: false } });

  const two = await registerDevice('dbsc-i');
  const ds2 = (await two.res.json()).session_identifier;
  const c2 = cookiesFrom(two.res);
  assert.equal((await api(`sid=${c2.sid}; sid_dev=${c2.sid_dev}`, 'POST', '/api/logout-all')).status, 204);
  assert.deepEqual(await check(ds2), { status: 200, body: { continue: false } });

  const three = await registerDevice('dbsc-j');
  const ds3 = (await three.res.json()).session_identifier;
  const c3 = cookiesFrom(three.res);
  assert.equal((await api(`sid=${c3.sid}; sid_dev=${c3.sid_dev}`, 'DELETE', '/api/me')).status, 204);
  assert.deepEqual(await check(ds3), { status: 200, body: { continue: false } });
});
