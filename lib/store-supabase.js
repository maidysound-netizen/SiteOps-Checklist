// Supabase(Postgres) 저장소 — DB_DRIVER=supabase 일 때 사용
// 테이블 구조는 supabase/setup.sql 참고
// 요청마다 로그인한 사용자의 토큰으로 접속하므로, 읽고 쓰는 범위는 DB의 RLS 정책(자기 데이터만)이 정한다.
import { createClient } from '@supabase/supabase-js';
import { HttpError, badInput, badReference, duplicateSite, unauthorized } from './errors.js';

// Postgres / PostgREST 오류 코드 → HTTP 오류
function toError(error) {
  if (error.code?.startsWith('PGRST3')) return unauthorized(); // JWT 없음·만료·위조
  if (error.code === '23503') return badReference(); // foreign_key_violation
  if (error.code === '23505') return duplicateSite(); // unique_violation (사이트 이름)
  if (['23514', '22007', '22008', '22P02'].includes(error.code)) return badInput(); // check / 날짜·형식 오류
  if (error.code === '42501') {
    if (/row-level security/.test(error.message)) return new HttpError(403, '내 사이트·항목만 사용할 수 있습니다.');
    return new Error('Supabase 테이블 권한이 없습니다. SQL Editor에서 supabase/setup.sql을 다시 실행해 주세요.');
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

// 한 사용자의 권한으로 동작하는 저장소
function userStore(supabase) {
  async function getTodo(id) {
    return toApiRow(unwrap(await supabase.from('todo_list').select('*').eq('id', id).maybeSingle()));
  }

  return {
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

    // user_id는 DB 기본값 auth.uid()가 채운다
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
      return unwrap(await supabase.from('sites').select('id, name, url, created_at').order('name'));
    },

    async createSite({ name, url }) {
      return unwrap(await supabase.from('sites').insert({ name, url }).select('id, name, url, created_at').single());
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

// key: 공개용 publishable 키 (브라우저에 노출돼도 되는 키). secret 키는 쓰지 않는다.
export function createSupabaseStore({ url, key }) {
  return {
    label: `Supabase (${new URL(url).host}) + Google 로그인`,
    auth: true,
    // 브라우저가 로그인에 쓸 값
    publicConfig: { supabaseUrl: url, supabaseKey: key },

    // 서버 시작 시 주소·키 확인, Google 로그인이 켜져 있는지 확인
    async check() {
      const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
      if (!res.ok) throw new Error(`Supabase 주소나 publishable 키가 올바르지 않습니다. (HTTP ${res.status})`);
      const settings = await res.json();
      if (!settings.external?.google) {
        console.warn('경고: Supabase에서 Google 로그인이 꺼져 있습니다. (Authentication → Sign In / Providers → Google)');
      }
    },

    forUser(token) {
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      return userStore(supabase);
    },
  };
}
