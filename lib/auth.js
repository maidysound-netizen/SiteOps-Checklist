// Google 로그인 — 서버에서 처리한다 (Supabase Auth, PKCE)
// 브라우저는 Supabase 주소·키를 모르고, 로그인 토큰은 JS가 읽을 수 없는 HttpOnly 쿠키에만 있다.
//   /auth/google   → Supabase(Google) 로그인 화면으로 보냄
//   /auth/callback → 받은 code를 토큰으로 바꿔 쿠키에 저장
import crypto from 'node:crypto';
import { unauthorized } from './errors.js';

const COOKIE = { access: 'sb_access', refresh: 'sb_refresh', verifier: 'sb_pkce' };
const SESSION_AGE = 30 * 24 * 60 * 60 * 1000; // 30일 (access token 자체는 1시간, 쿠키는 갱신용으로 오래 둔다)
const VERIFIER_AGE = 10 * 60 * 1000; // 로그인 화면을 다녀오는 10분 동안만

function readCookies(req) {
  const cookies = {};
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return cookies;
}

const cookieOptions = (req, maxAge) => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge });

// JWT 본문(서명 검증은 Supabase가 한다. 여기서는 만료 시각·이메일 표시용으로만 읽음)
function jwtClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  } catch {
    return {};
  }
}

export function createAuth({ url, key }) {
  async function authRequest(path, body, token) {
    const res = await fetch(`${url}/auth/v1${path}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || data.error_description || data.message || `HTTP ${res.status}`);
    return data;
  }

  function saveSession(req, res, session) {
    res.cookie(COOKIE.access, session.access_token, cookieOptions(req, SESSION_AGE));
    res.cookie(COOKIE.refresh, session.refresh_token, cookieOptions(req, SESSION_AGE));
  }

  function clearSession(res) {
    res.clearCookie(COOKIE.access, { path: '/' });
    res.clearCookie(COOKIE.refresh, { path: '/' });
  }

  const loginFailed = (res, message) => {
    console.warn(`Google 로그인 실패: ${message}`);
    res.redirect(`/?login_error=${encodeURIComponent(message)}`);
  };

  return {
    // GET /auth/google
    start(req, res) {
      const verifier = crypto.randomBytes(48).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      res.cookie(COOKIE.verifier, verifier, cookieOptions(req, VERIFIER_AGE));
      const params = new URLSearchParams({
        provider: 'google',
        redirect_to: `${req.protocol}://${req.get('host')}/auth/callback`,
        code_challenge: challenge,
        code_challenge_method: 's256',
      });
      res.redirect(`${url}/auth/v1/authorize?${params}`);
    },

    // GET /auth/callback?code=...
    async callback(req, res) {
      const verifier = readCookies(req)[COOKIE.verifier];
      res.clearCookie(COOKIE.verifier, { path: '/' });
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!code || !verifier) return loginFailed(res, req.query.error_description || '로그인을 다시 시도해 주세요.');
      try {
        saveSession(req, res, await authRequest('/token?grant_type=pkce', { auth_code: code, code_verifier: verifier }));
        res.redirect('/');
      } catch (err) {
        loginFailed(res, `로그인에 실패했습니다: ${err.message}`);
      }
    },

    // POST /auth/logout
    async logout(req, res) {
      const token = readCookies(req)[COOKIE.access];
      clearSession(res);
      if (token) await authRequest('/logout', {}, token).catch(() => {}); // 이미 만료돼도 쿠키 삭제로 로그아웃 완료
      res.status(204).end();
    },

    // 로그인한 사용자의 access token. 만료 1분 전이면 refresh token으로 갱신, 없으면 401
    async token(req, res) {
      const { [COOKIE.access]: access, [COOKIE.refresh]: refresh } = readCookies(req);
      if (access && (jwtClaims(access).exp ?? 0) * 1000 - 60_000 > Date.now()) return access;
      if (!refresh) throw unauthorized();
      try {
        const session = await authRequest('/token?grant_type=refresh_token', { refresh_token: refresh });
        saveSession(req, res, session);
        return session.access_token;
      } catch {
        clearSession(res);
        throw unauthorized();
      }
    },

    email: (token) => jwtClaims(token).email ?? null,
  };
}
