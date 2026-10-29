// Supabase(Postgres) 저장소 — DB_DRIVER=supabase 일 때 사용
// 테이블 구조는 supabase/setup.sql 참고
import { createClient } from '@supabase/supabase-js';
import { badInput, badReference } from './errors.js';

// Postgres 오류 코드 → 400 오류
function toError(error) {
  if (error.code === '23503') return badReference(); // foreign_key_violation
  if (['23514', '22007', '22008', '22P02'].includes(error.code)) return badInput(); // check / 날짜·형식 오류
  if (error.code === '42501') {
    return new Error('Supabase 테이블 권한이 없습니다. supabase/setup.sql을 다시 실행하고, .env에 secret 키를 넣었는지 확인해 주세요.');
  }
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return new Error('Supabase에 테이블이 없습니다. SQL Editor에서 supabase/setup.sql을 실행해 주세요.');
  }
  return new Error(`Supabase 오류: ${error.message || error.code || '알 수 없는 오류'}`);
}

function unwrap({ data, error }) {
  if (error) throw toError(error);
  return data;
}

// SQLite 저장소와 응답 모양을 맞춘다 (is_done: 0/1)
const toApiRow = (row) => row && { ...row, is_done: row.is_done ? 1 : 0 };

const toDbRow = (input) =>
  'is_done' in input ? { ...input, is_done: Boolean(input.is_done) } : input;

export function createSupabaseStore({ url, key }) {
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function getTodo(id) {
    return toApiRow(unwrap(await supabase.from('todo_list').select('*').eq('id', id).maybeSingle()));
  }

  return {
    label: `Supabase (${new URL(url).host})`,

    // 서버 시작 시 연결·테이블 확인
    async check() {
      unwrap(await supabase.from('todo_list').select('id').limit(1));
    },

    async listTodos({ site, category, status }) {
      let query = supabase.from('todo_list').select('*');
      if (site) query = query.eq('site_id', site);
      if (category) query = query.eq('category_id', category);
      if (status === 'open') query = query.eq('is_done', false);
      else if (status === 'done') query = query.eq('is_done', true);
      else if (status === 'overdue') query = query.eq('due_status', 'overdue');

      // 미완료 먼저 → 마감일 빠른 순(없으면 뒤) → 최근 등록 순
      const rows = unwrap(
        await query
          .order('is_done')
          .order('due_date', { ascending: true, nullsFirst: false })
          .order('id', { ascending: false }),
      );
      return rows.map(toApiRow);
    },

    getTodo,

    async createTodo(input) {
      const { id } = unwrap(await supabase.from('todos').insert(toDbRow(input)).select('id').single());
      return getTodo(id);
    },

    async updateTodo(id, input) {
      const rows = unwrap(await supabase.from('todos').update(toDbRow(input)).eq('id', id).select('id'));
      return rows.length === 0 ? null : getTodo(id);
    },

    async deleteTodo(id) {
      const rows = unwrap(await supabase.from('todos').delete().eq('id', id).select('id'));
      return rows.length > 0;
    },

    async listCategories() {
      return unwrap(await supabase.from('categories').select('*').order('sort_order').order('name'));
    },

    async listSites() {
      return unwrap(await supabase.from('sites').select('*').order('name'));
    },

    async summary() {
      const rows = unwrap(await supabase.from('todo_list').select('is_done, due_status'));
      return {
        total: rows.length,
        open: rows.filter((r) => !r.is_done).length,
        done: rows.filter((r) => r.is_done).length,
        overdue: rows.filter((r) => r.due_status === 'overdue').length,
      };
    },
  };
}
