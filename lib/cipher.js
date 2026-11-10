// 저장 시 암호화 — 할 일 제목·메모를 AES-256-GCM으로 암호화해 DB에 넣는다
// DB가 통째로 유출돼도 키(DATA_ENCRYPTION_KEY, 서버 환경 변수에만 있음)가 없으면 읽을 수 없다.
// AAD(추가 인증 데이터)에 사용자 id와 칸 이름을 넣어, 암호문을 다른 사람·다른 칸으로 옮겨 붙이면 복호화에 실패한다.
import crypto from 'node:crypto';

const PREFIX = 'v1.';

export function parseKey(text) {
  const key = Buffer.from(String(text ?? '').trim(), 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY는 32바이트를 base64로 적은 값이어야 합니다. (.env.example 참고)');
  return key;
}

export function createCipherBox(keyText) {
  const key = parseKey(keyText);

  return {
    encrypt(plain, aad) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(aad));
      const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
    },

    decrypt(blob, aad) {
      if (!String(blob).startsWith(PREFIX)) throw new Error('암호문 형식이 아닙니다.');
      const raw = Buffer.from(blob.slice(PREFIX.length), 'base64url');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}
