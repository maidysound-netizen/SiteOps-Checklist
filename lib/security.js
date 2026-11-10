// 보안 헤더와 요청 횟수 제한 (추가 패키지 없이)
import { HttpError } from './errors.js';

// 화면은 우리 서버의 파일만 쓴다 (외부 스크립트·글꼴 없음, 인라인 스크립트 없음)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'", // 다른 사이트가 이 앱을 화면 안에 띄우지 못하게 (클릭재킹 방지)
].join('; ');

export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// IP마다 정해진 시간 동안 max번까지만 허용, 넘으면 429.
// 서버 메모리에 세므로 Vercel처럼 서버가 여러 개 뜨면 서버마다 따로 센다 (완벽한 차단이 아니라 남용을 늦추는 용도)
// onLimit: 429 JSON 대신 다르게 응답할 때 (예: 로그인 화면으로 돌려보내기)
export function rateLimit({ windowMs, max, message = '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', onLimit, now = Date.now }) {
  const hits = new Map(); // ip → { count, reset }

  return (req, res, next) => {
    const time = now();
    if (hits.size > 10_000) {
      for (const [ip, entry] of hits) if (entry.reset <= time) hits.delete(ip);
    }
    const ip = req.ip ?? 'unknown';
    let entry = hits.get(ip);
    if (!entry || entry.reset <= time) {
      entry = { count: 0, reset: time + windowMs };
      hits.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - time) / 1000)));
      if (onLimit) return onLimit(req, res, message);
      throw new HttpError(429, message);
    }
    next();
  };
}
