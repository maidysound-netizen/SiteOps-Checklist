// CLI(cli.js) 테스트 — 임시 SQLite 파일로 실제 명령을 실행한다 (db/siteops.db는 건드리지 않음)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.js');
const dir = mkdtempSync(path.join(tmpdir(), 'siteops-cli-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function cli(...args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      env: { ...process.env, DB_PATH: path.join(dir, 'todo.db') },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status, out: err.stdout + err.stderr };
  }
}

test('list: 예시 데이터 4건, 완료는 [x]', () => {
  const { code, out } = cli('list');
  assert.equal(code, 0);
  assert.equal(out.trim().split('\n').length, 4);
  assert.match(out, /^\[x\] 4\. GitHub 저장소 비공개 설정 확인/m);
});

test('add → done → summary: 오늘 완료에 나타난다', () => {
  assert.match(cli('add', '  우유 사기 ').out, /추가했습니다: \[ \] 5\. 우유 사기/);
  assert.match(cli('done', '5').out, /완료했습니다: \[x\] 5\. 우유 사기/);
  assert.match(cli('done', '5').out, /이미 완료된 항목/);
  const { out } = cli('summary');
  assert.match(out, /^오늘\(\d{4}-\d{2}-\d{2}\) 완료 \d+건/);
  assert.match(out, /^- 우유 사기 \(\d{2}:\d{2}\)$/m);
});

test('잘못된 입력은 오류 메시지와 종료 코드 1', () => {
  assert.equal(cli('add', '').code, 1);
  assert.equal(cli('add', 'a'.repeat(101)).code, 1);
  assert.match(cli('done', '999').out, /999번 항목이 없습니다/);
  assert.equal(cli('done', 'abc').code, 1);
  assert.match(cli('nope').out, /알 수 없는 명령/);
  assert.match(cli().out, /사용법/);
});
