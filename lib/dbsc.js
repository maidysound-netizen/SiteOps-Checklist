// DBSC (Device Bound Session Credentials) — 로그인을 "그 기기"에 묶는다
// 규격: https://w3c.github.io/webappsec-dbsc/ (편집자 초안, 바뀔 수 있음)
//
// 흐름
//  1) 로그인한 화면이 /api/me를 부르면 Secure-Session-Registration 헤더로 "기기 등록"을 제안한다.
//  2) 지원하는 브라우저(Chrome 등)는 기기 안(TPM 등)에 꺼낼 수 없는 키를 만들고,
//     그 키로 서명한 증명(JWT)을 /auth/dbsc/register로 보낸다 → 공개 키를 DB에 저장.
//  3) 그때부터 로그인에는 10분짜리 쿠키(sid_dev)가 하나 더 필요하다.
//     10분이 지나면 브라우저가 /auth/dbsc/refresh에서 서버 문제(challenge)에 기기 키로 서명해 새로 받는다.
//  → 쿠키를 복사해 가도 기기 키가 없으니 10분 안에 쓸모가 없어진다.
//  지원하지 않는 브라우저는 등록 제안을 무시하고 예전처럼 동작한다.
import crypto from 'node:crypto';
import { HttpError } from './errors.js';

export const DEVICE_COOKIE = 'sid_dev';
export const DEVICE_AGE = 10 * 60 * 1000; // 10분
const CHALLENGE_AGE = 5 * 60 * 1000;
const PATHS = { register: '/auth/dbsc/register', refresh: '/auth/dbsc/refresh' };

// Structured Field 문자열("...")이면 따옴표를 벗긴다 (Chrome 안내 예시처럼 따옴표 없이 와도 받는다)
function sfString(value) {
  const text = String(value ?? '').trim();
  if (text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1).replace(/\\(["\\])/g, '$1');
  return text;
}

const quote = (text) => `"${String(text).replace(/(["\\])/g, '\\$1')}"`;
const fromB64 = (text) => JSON.parse(Buffer.from(text, 'base64url').toString());

// 브라우저가 보낸 증명 JWT 확인. 등록 때는 헤더의 jwk로, 갱신 때는 저장해 둔 키로 서명을 확인한다.
export function verifyProof(token, stored) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) throw new Error('증명 형식이 아닙니다.');
  const [h, p, s] = parts;
  let header;
  let payload;
  try {
    header = fromB64(h);
    payload = fromB64(p);
  } catch {
    throw new Error('증명을 읽을 수 없습니다.');
  }
  if (header.typ !== 'dbsc+jwt') throw new Error('증명 종류(typ)가 다릅니다.');
  const alg = stored?.alg ?? header.alg;
  if (!['ES256', 'RS256'].includes(alg) || header.alg !== alg) throw new Error('지원하지 않는 서명 방식입니다.');
  const jwk = stored?.jwk ?? header.jwk;
  if (!jwk) throw new Error('공개 키가 없습니다.');

  let key;
  try {
    key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    throw new Error('공개 키를 읽을 수 없습니다.');
  }
  if (alg === 'ES256' && !(key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1')) {
    throw new Error('ES256 키가 아닙니다.');
  }
  if (alg === 'RS256' && !(key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails?.modulusLength >= 2048)) {
    throw new Error('RS256 키가 아닙니다.');
  }
  // JWS의 ES256 서명은 DER가 아니라 r‖s 64바이트 (RFC 7518 3.4)
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key,
    Buffer.from(s, 'base64url'),
  );
  if (!ok) throw new Error('서명이 맞지 않습니다.');

  // 저장할 공개 키는 필요한 값만
  const publicJwk = alg === 'ES256' ? { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } : { kty: 'RSA', n: jwk.n, e: jwk.e };
  return { alg, jwk: publicJwk, payload };
}

// seal/unseal: SESSION_SECRET으로 서명·확인 (google-auth.js와 같은 비밀 값)
export function createDbsc({ seal, unseal, users, cookieOptions, issueSession, readCookies }) {
  const newChallenge = (data) => seal({ ...data, n: crypto.randomBytes(12).toString('base64url'), exp: Date.now() + CHALLENGE_AGE });

  function checkChallenge(jti, expect) {
    const data = unseal(jti);
    if (!data || !(data.exp > Date.now())) return false;
    return Object.entries(expect).every(([k, v]) => data[k] === v);
  }

  function issueDevice(req, res, { ds, uid }) {
    res.cookie(DEVICE_COOKIE, seal({ ds, uid, exp: Date.now() + DEVICE_AGE }), cookieOptions(req, DEVICE_AGE));
  }

  // 응답의 쿠키 속성과 똑같아야 한다 (브라우저가 이 이름·속성의 쿠키를 지켜봄)
  const cookieAttributes = (req) => `Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`;

  return {
    // 아직 기기에 묶이지 않은 로그인에 등록 제안 헤더를 붙인다
    offer(req, res, session) {
      if (session.ds) return;
      const challenge = newChallenge({ p: 'reg', uid: session.uid, v: session.v });
      res.set('Secure-Session-Registration', `(ES256 RS256);path=${quote(PATHS.register)};challenge=${quote(challenge)}`);
    },

    // 이 쿠키가 기기에 묶인 로그인이면, 10분짜리 기기 쿠키도 맞아야 한다
    deviceOk(req, session) {
      if (!session.ds) return true;
      const device = unseal(readCookies(req)[DEVICE_COOKIE]);
      return Boolean(device && device.ds === session.ds && device.uid === session.uid && device.exp > Date.now());
    },

    // POST /auth/dbsc/register — 기기 등록 (로그인 쿠키 + 기기 키 증명)
    async register(req, res, session) {
      let proof;
      try {
        proof = verifyProof(sfString(req.get('secure-session-response')));
      } catch (err) {
        throw new HttpError(400, `기기 등록 실패: ${err.message}`);
      }
      if (!checkChallenge(proof.payload.jti, { p: 'reg', uid: session.uid, v: session.v })) {
        throw new HttpError(400, '기기 등록 실패: 문제(challenge)가 맞지 않거나 만료되었습니다.');
      }
      const ds = crypto.randomBytes(18).toString('base64url');
      await users.createDeviceSession({ id: ds, userId: session.uid, alg: proof.alg, jwk: proof.jwk, version: session.v });
      issueSession(req, res, { uid: session.uid, v: session.v, ds });
      issueDevice(req, res, { ds, uid: session.uid });
      res.json({
        session_identifier: ds,
        refresh_url: PATHS.refresh,
        scope: { include_site: false },
        credentials: [{ type: 'cookie', name: DEVICE_COOKIE, attributes: cookieAttributes(req) }],
      });
    },

    // POST /auth/dbsc/refresh — 10분짜리 기기 쿠키 다시 받기
    async refresh(req, res) {
      const ds = sfString(req.get('sec-secure-session-id'));
      const device = ds ? await users.getDeviceSession(ds) : null;
      const user = device ? await users.getUser(device.user_id) : null;
      // 로그아웃·모든 기기 로그아웃·탈퇴로 없어진 기기 → 브라우저에 세션을 끝내라고 알림
      if (!device || !user || (user.session_version ?? 0) !== device.session_version) {
        return res.json({ continue: false });
      }

      const token = req.get('secure-session-response');
      if (!token) {
        res.set('Secure-Session-Challenge', `${quote(newChallenge({ p: 'ref', ds }))};id=${quote(ds)}`);
        return res.status(403).end();
      }
      let proof;
      try {
        proof = verifyProof(sfString(token), { alg: device.alg, jwk: JSON.parse(device.jwk) });
      } catch {
        // 등록한 기기 키의 서명이 아님 → 401 (브라우저는 이 세션을 끝낸다. 403이면 무한 재시도)
        return res.status(401).end();
      }
      if (!checkChallenge(proof.payload.jti, { p: 'ref', ds })) {
        // 서명은 맞지만 오래된 문제 → 새 문제를 주고 다시 시도하게 한다
        res.set('Secure-Session-Challenge', `${quote(newChallenge({ p: 'ref', ds }))};id=${quote(ds)}`);
        return res.status(403).end();
      }
      issueDevice(req, res, { ds, uid: device.user_id });
      res.status(200).end();
    },
  };
}
