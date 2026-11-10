// 비밀 값 감지 패턴 테스트 (화면 경고용)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/secret-check.js';

const { findSecrets } = globalThis;

test('흔한 키·토큰·비밀번호 표기를 찾는다', () => {
  const samples = [
    'sk-proj-abcdefghijklmnopqrstuvwx',
    'sk-ant-api03-abcdefghijklmnopqrstu',
    `ghp_${'a'.repeat(36)}`,
    `github_pat_${'A1_'.repeat(12)}`,
    'AKIAABCDEFGHIJKLMNOP',
    `AIza${'x'.repeat(35)}`,
    'GOCSPX-abcdefghijklmnopqrstuv',
    'xoxb-1234567890-abcdef',
    'sk_live_abcdefghijklmnop1234',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
    'postgres://admin:hunter22@db.example.com/app',
    '관리자 비번: qwer1234!',
    '비밀번호 = mypass99',
    'password: correct-horse',
    'api_key=abcd1234efgh5678',
  ];
  for (const sample of samples) assert.ok(findSecrets(sample).length > 0, sample);
  assert.ok(findSecrets('제목', '메모에 sk-proj-abcdefghijklmnopqrstuvwx').length > 0, '메모도 검사');
});

test('평범한 점검 항목은 경고하지 않는다', () => {
  const normal = [
    '관리자 비밀번호 변경·2단계 인증 확인',
    'SSL 인증서 만료일 확인',
    '데이터베이스 백업 복원 테스트',
    'API 키 교체 일정 잡기',
    'https://example.com 배포 후 확인',
    'task-runner 설정 점검',
    '비밀번호 정책 문서 검토',
  ];
  for (const text of normal) assert.deepEqual(findSecrets(text), [], text);
});
