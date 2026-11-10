// 비밀 값 감지 — 할 일에 API 키·비밀번호를 적으려 할 때 저장 전에 경고한다
// 화면(app.js)과 테스트가 같이 쓴다. 막지는 않고 알려만 준다 (판단은 사용자가).
const SECRET_PATTERNS = [
  ['OpenAI·Anthropic API 키', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/],
  ['GitHub 토큰', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['AWS 액세스 키', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Google API 키', /\bAIza[0-9A-Za-z_-]{35}/],
  ['Google OAuth Client Secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
  ['Slack 토큰', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Stripe 키', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/],
  ['Supabase 비밀 키', /\bsb_secret_[A-Za-z0-9_-]{16,}/],
  ['개인 키', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT 토큰', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['주소에 들어 있는 비밀번호', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]{3,}@/i],
  ['비밀번호', /(?:비번|비밀번호|패스워드|암호|password|passwd|pwd|pw)\s*[:=：]\s*\S{4,}/i],
  ['키·토큰', /(?:api[_ -]?key|secret|token|토큰|시크릿)\s*[:=：]\s*\S{8,}/i],
];

// 찾은 종류 이름 목록 (없으면 빈 배열). 찾은 값 자체는 돌려주지 않는다.
globalThis.findSecrets = (...texts) => {
  const text = texts.filter(Boolean).join('\n');
  return SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
};
