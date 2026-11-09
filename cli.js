// SiteOps Checklist — 명령줄(CLI) 진입점
// 웹 앱과 같은 SQLite 저장소(lib/store-sqlite.js)를 그대로 쓴다. 클라우드(Turso)에는 접속하지 않는다.
//   node cli.js list               목록
//   node cli.js add "<내용>"        추가
//   node cli.js done <번호>         완료
//   node cli.js summary            오늘 완료 요약
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteStore } from './lib/store-sqlite.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TITLE_MAX = 100;

const USAGE = `사용법:
  node cli.js list               목록 (미완료 먼저, 마감일 순)
  node cli.js add "<내용>"        추가 (1~${TITLE_MAX}자)
  node cli.js done <번호>         완료 처리
  node cli.js summary            오늘 완료한 항목 요약`;

// 로컬 날짜 YYYY-MM-DD (completed_at은 SQLite의 로컬 시각 'YYYY-MM-DD HH:MM:SS')
function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function formatTodo(todo) {
  const extra = [todo.site_name, todo.category_name].filter(Boolean);
  if (todo.due_date) extra.push(todo.due_status === 'overdue' ? `기한 지남 ${todo.due_date}` : `마감 ${todo.due_date}`);
  return `[${todo.is_done ? 'x' : ' '}] ${todo.id}. ${todo.title}${extra.length ? `  (${extra.join(' · ')})` : ''}`;
}

class CliError extends Error {}

const commands = {
  async list(store) {
    const todos = await store.listTodos({ status: 'all' });
    return todos.length ? todos.map(formatTodo).join('\n') : '할 일이 없습니다.';
  },

  async add(store, args) {
    const title = args.join(' ').trim();
    if (title.length < 1 || title.length > TITLE_MAX) throw new CliError(`내용은 1~${TITLE_MAX}자로 입력해 주세요.`);
    const todo = await store.createTodo({ title });
    return `추가했습니다: ${formatTodo(todo)}`;
  },

  async done(store, [value]) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new CliError('완료할 번호를 입력해 주세요. 예: node cli.js done 3');
    const todo = await store.getTodo(id);
    if (!todo) throw new CliError(`${id}번 항목이 없습니다.`);
    if (todo.is_done) return `이미 완료된 항목입니다: ${formatTodo(todo)}`;
    return `완료했습니다: ${formatTodo(await store.updateTodo(id, { is_done: 1 }))}`;
  },

  async summary(store) {
    const day = today();
    const doneToday = (await store.listTodos({ status: 'done' })).filter((t) => t.completed_at?.startsWith(day));
    const { open, overdue } = await store.summary();
    const lines = [`오늘(${day}) 완료 ${doneToday.length}건`];
    for (const todo of doneToday) lines.push(`- ${todo.title} (${todo.completed_at.slice(11, 16)})`);
    lines.push(`남은 할 일 ${open}건, 그중 기한 지남 ${overdue}건`);
    return lines.join('\n');
  },
};

const [command, ...args] = process.argv.slice(2);
if (!Object.hasOwn(commands, command ?? '')) {
  console.error(command ? `알 수 없는 명령: ${command}\n\n${USAGE}` : USAGE);
  process.exit(1);
}

try {
  const store = createSqliteStore({
    dbPath: process.env.DB_PATH ?? path.join(ROOT, 'db', 'siteops.db'),
    sqlDir: path.join(ROOT, 'db'),
  });
  console.log(await commands[command](store, args));
} catch (err) {
  console.error(`오류: ${err.message}`);
  process.exit(1);
}
