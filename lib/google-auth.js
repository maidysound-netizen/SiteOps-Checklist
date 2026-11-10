// Google 로그인 — 서버가 직접 처리한다 (OAuth 2.0 + PKCE, 별도 로그인 서비스 없음)
// 브라우저는 Client Secret·DB 주소·토큰을 모른다. 로그인 상태는 서명한 HttpOnly 쿠키에만 있다.
//   /auth/google   → Google 로그인 화면으로 보냄 (state·PKCE verifier는 HttpOnly 쿠키에)
//   /auth/callback → code를 Google 토큰으로 바꾸고, 사용자를 DB에 저장한 뒤 세션 쿠키 발급
import crypto from 'node:crypto';
import { unauthorized } from './errors.js';
import { createDbsc, DEVICE_COOKIE } from './dbsc.js';

const GOOGLE = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
};
const COOKIE = { session: 'sid', login: 'g_login' };
const DAY = 24 * 60 * 60 * 1000;
const SESSION_AGE = 7 * DAY; // 7일. 쓰는 동안에는 하루에 한 번 자동 연장 (renew)
const LOGIN_AGE = 10 * 60 * 1000; // Google 로그인 화면을 다녀오는 10분 동안만

function readCookies(req) {
  const cookies = {};
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return cookies;
}

const cookieOptions = (req, maxAge) => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge });
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const unb64 = (text) => JSON.parse(Buffer.from(text, 'base64url').toString());

// tokenUrl: 테스트에서 가짜 Google 토큰 서버를 쓰기 위한 값
export function createGoogleAuth({ clientId, clientSecret, sessionSecret, users, tokenUrl = GOOGLE.token }) {
  if (!sessionSecret || sessionSecret.length < 32) throw new Error('SESSION_SECRET은 32자 이상이어야 합니다.');

  const sign = (data) => crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');

  function verify(value) {
    const [data, mac] = (value ?? '').split('.');
    if (!data || !mac) return null;
    const expected = Buffer.from(sign(data));
    const actual = Buffer.from(mac);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    try {
      return unb64(data);
    } catch {
      return null;
    }
  }

  const sealed = (value) => {
    const data = b64(value);
    return `${data}.${sign(data)}`;
  };

  const redirectUri = (req) => `${req.protocol}://${req.get('host')}/auth/callback`;

  const loginFailed = (res, message) => {
    console.warn(`Google 로그인 실패: ${message}`);
    res.redirect(`/?login_error=${encodeURIComponent(message)}`);
  };

  // Google 토큰 서버에서 TLS로 직접 받은 id_token이라 서명 대신 발급자·대상·만료를 확인한다 (OIDC Core 3.1.3.7)
  function readIdToken(idToken) {
    const claims = unb64(idToken.split('.')[1] ?? '');
    if (!GOOGLE.issuers.includes(claims.iss)) throw new Error('발급자가 Google이 아닙니다.');
    if (claims.aud !== clientId) throw new Error('다른 앱의 토큰입니다.');
    if ((claims.exp ?? 0) * 1000 < Date.now()) throw new Error('만료된 토큰입니다.');
    if (!claims.sub) throw new Error('사용자 ID가 없습니다.');
    return claims;
  }

  // 세션 쿠키 발급 (uid: 사용자 id, v: 쿠키 세대, ds: 기기에 묶였으면 그 기기 세션 id)
  const issue = (req, res, { uid, v, ds }) =>
    res.cookie(COOKIE.session, sealed({ uid, v, ds, exp: Date.now() + SESSION_AGE }), cookieOptions(req, SESSION_AGE));

  const dbsc = createDbsc({ seal: sealed, unseal: verify, users, cookieOptions, issueSession: issue, readCookies });

  return {
    // GET /auth/google
    start(req, res) {
      const state = crypto.randomBytes(24).toString('base64url');
      const verifier = crypto.randomBytes(48).toString('base64url');
      res.cookie(COOKIE.login, sealed({ state, verifier }), cookieOptions(req, LOGIN_AGE));
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri(req),
        response_type: 'code',
        scope: 'openid email profile',
        state,
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      res.redirect(`${GOOGLE.authorize}?${params}`);
    },

    // GET /auth/callback?code=...&state=...
    async callback(req, res) {
      const login = verify(readCookies(req)[COOKIE.login]);
      res.clearCookie(COOKIE.login, { path: '/' });
      const { code, state, error } = req.query;
      if (error) return loginFailed(res, '로그인을 취소했습니다.');
      if (!login || typeof code !== 'string' || state !== login.state) {
        return loginFailed(res, '로그인을 다시 시도해 주세요.');
      }
      try {
        const tokenRes = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            code_verifier: login.verifier,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri(req),
          }),
        });
        const token = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !token.id_token) throw new Error(token.error_description || token.error || `HTTP ${tokenRes.status}`);
        const claims = readIdToken(token.id_token);
        const userId = await users.upsertUser({ sub: claims.sub, email: claims.email, name: claims.name });
        const version = (await users.getUser?.(userId))?.session_version ?? 0;
        issue(req, res, { uid: userId, v: version });
        res.redirect('/');
      } catch (err) {
        loginFailed(res, `로그인에 실패했습니다: ${err.message}`);
      }
    },

    // POST /auth/logout — 기기에 묶인 로그인이면 그 기기 세션도 지운다
    async logout(req, res) {
      const ds = verify(readCookies(req)[COOKIE.session])?.ds;
      if (ds) await users.deleteDeviceSession?.(ds);
      res.clearCookie(COOKIE.session, { path: '/' });
      res.clearCookie(DEVICE_COOKIE, { path: '/' });
      res.status(204).end();
    },

    // 로그인 쿠키 내용 { uid, v, exp }. 쿠키가 없거나 위조·만료면 401
    // (v가 DB의 세대와 같은지는 server.js가 확인한다. v가 없는 예전 쿠키는 0세대로 본다)
    // 기기에 묶인 로그인(ds)이면 10분짜리 기기 쿠키도 있어야 한다 (복사해 간 쿠키만으로는 401)
    session(req) {
      const session = verify(readCookies(req)[COOKIE.session]);
      if (!Number.isInteger(session?.uid) || !(session.exp > Date.now())) throw unauthorized();
      const result = { uid: session.uid, v: session.v ?? 0, exp: session.exp, ds: session.ds };
      if (!dbsc.deviceOk(req, result)) throw unauthorized();
      return result;
    },

    dbsc,

    userId(req) {
      return this.session(req).uid;
    },

    // 쓰는 동안 자동 연장: 발급한 지 하루가 지났으면 7일짜리로 다시 발급
    renew(req, res, session) {
      if (session.exp - Date.now() < SESSION_AGE - DAY) issue(req, res, session);
    },
  };
}
