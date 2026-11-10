// 요청 횟수 제한 단위 테스트 — 시계를 직접 움직여 확인한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../lib/security.js';

function fakeRes() {
  const headers = {};
  return { headers, set: (k, v) => (headers[k] = v) };
}

test('IP마다 max번까지 허용, 넘으면 429 + Retry-After, 시간이 지나면 다시 허용', () => {
  let clock = 1_000_000;
  const limit = rateLimit({ windowMs: 60_000, max: 2, now: () => clock });
  const a = { ip: '1.1.1.1' };
  const b = { ip: '2.2.2.2' };
  let passed = 0;
  const next = () => passed++;

  limit(a, fakeRes(), next);
  limit(a, fakeRes(), next);
  const res = fakeRes();
  assert.throws(() => limit(a, res, next), { status: 429 });
  assert.equal(res.headers['Retry-After'], '60');
  limit(b, fakeRes(), next); // 다른 IP는 따로 센다
  assert.equal(passed, 3);

  clock += 60_000;
  limit(a, fakeRes(), next);
  assert.equal(passed, 4);
});

test('onLimit이 있으면 429 대신 그 응답을 쓴다', () => {
  const limit = rateLimit({ windowMs: 1000, max: 0, message: '많음', onLimit: (req, res, message) => message });
  assert.equal(limit({ ip: 'x' }, fakeRes(), () => {}), '많음');
});
