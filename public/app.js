// SiteOps Checklist — 화면 로직
const state = {
  sites: [],
  categories: [],
  filter: { category: '', site: '', status: 'all' },
  editingId: null,
};

const $ = (selector) => document.querySelector(selector);

// Supabase 로그인 클라이언트 (DB_DRIVER=supabase 일 때만 사용, SQLite 모드에서는 null)
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
let auth = null;

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    // getSession은 만료가 가까우면 토큰을 새로 받아 준다
    const { data } = await auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  const res = await fetch(path, {
    headers,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401 && auth) showLogin();
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? '요청에 실패했습니다.');
  return data;
}

function showLogin() {
  $('#app-view').hidden = true;
  $('#user-box').hidden = true;
  $('#login-view').hidden = false;
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of [].concat(children)) {
    if (child != null) node.append(child);
  }
  return node;
}

// 로컬 날짜 기준 YYYY-MM-DD
function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function dueBadge(todo) {
  if (!todo.due_date) return null;
  if (todo.is_done) return el('span', { className: 'due', textContent: todo.due_date });
  if (todo.due_status === 'overdue') {
    return el('span', { className: 'due overdue', textContent: `기한 지남 · ${todo.due_date}` });
  }
  if (todo.due_status === 'today') return el('span', { className: 'due today', textContent: '오늘 마감' });
  const days = Math.round((new Date(todo.due_date) - new Date(today())) / 86_400_000);
  return el('span', { className: 'due', textContent: `D-${days} · ${todo.due_date}` });
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form));
  data.title = data.title.trim();
  return data;
}

// ---------- 렌더링 ----------
function fillSelects() {
  const optionSets = {
    sites: [['', '사이트 없음'], ...state.sites.map((s) => [s.id, s.name])],
    categories: [['', '분류 없음'], ...state.categories.map((c) => [c.id, c.name])],
  };
  for (const select of document.querySelectorAll('select[data-options]')) {
    select.replaceChildren(
      ...optionSets[select.dataset.options].map(([value, text]) => el('option', { value, textContent: text })),
    );
  }
  $('#filter-site').replaceChildren(
    el('option', { value: '', textContent: '모든 사이트' }),
    ...state.sites.map((s) => el('option', { value: s.id, textContent: s.name })),
  );
}

function renderTabs() {
  const tabs = [{ id: '', name: '전체' }, ...state.categories];
  $('#category-tabs').replaceChildren(
    ...tabs.map((c) => {
      const active = String(c.id) === state.filter.category;
      const tab = el('button', {
        type: 'button',
        className: `tab${active ? ' active' : ''}`,
        textContent: c.name,
        onclick: () => {
          state.filter.category = String(c.id);
          renderTabs();
          loadTodos();
        },
      });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(active));
      return tab;
    }),
  );
}

function renderTodo(todo) {
  const checkbox = el('input', {
    type: 'checkbox',
    checked: Boolean(todo.is_done),
    onchange: () => toggleTodo(todo, checkbox),
  });
  checkbox.setAttribute('aria-label', `${todo.title} 완료`);

  const meta = [todo.site_name, todo.category_name].filter(Boolean).join(' · ');
  const badge = todo.category_name
    ? el('span', { className: 'badge', textContent: todo.category_name })
    : null;
  badge?.style.setProperty('--badge', todo.category_color);

  return el('li', { className: `todo${todo.is_done ? ' done' : ''}` }, [
    checkbox,
    el('div', { className: 'todo-body' }, [
      el('div', { className: 'todo-title', textContent: todo.title }),
      el('div', { className: 'todo-meta' }, [
        badge,
        todo.site_name ? el('span', { textContent: todo.site_name }) : null,
        !meta ? el('span', { textContent: '분류 없음' }) : null,
        dueBadge(todo),
      ]),
      todo.memo ? el('p', { className: 'todo-memo', textContent: todo.memo }) : null,
    ]),
    el('div', { className: 'todo-actions' }, [
      el('button', { type: 'button', className: 'btn small', textContent: '수정', onclick: () => openEdit(todo) }),
      el('button', {
        type: 'button',
        className: 'btn small danger',
        textContent: '삭제',
        onclick: () => deleteTodo(todo),
      }),
    ]),
  ]);
}

async function loadSummary() {
  const sum = await api('/api/summary');
  for (const key of ['total', 'open', 'done', 'overdue']) $(`#sum-${key}`).textContent = sum[key];
}

async function loadTodos() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state.filter)) {
    if (value && value !== 'all') params.set(key, value);
  }
  const todos = await api(`/api/todos?${params}`);
  $('#todo-list').replaceChildren(...todos.map(renderTodo));
  $('#empty').hidden = todos.length > 0;
}

function refresh() {
  return Promise.all([loadTodos(), loadSummary()]);
}

// ---------- 동작 ----------
async function toggleTodo(todo, checkbox) {
  try {
    await api(`/api/todos/${todo.id}`, { method: 'PATCH', body: { is_done: checkbox.checked } });
    await refresh();
  } catch (err) {
    checkbox.checked = !checkbox.checked;
    alert(err.message);
  }
}

async function deleteTodo(todo) {
  if (!confirm(`'${todo.title}' 항목을 삭제할까요?`)) return;
  try {
    await api(`/api/todos/${todo.id}`, { method: 'DELETE' });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

function openEdit(todo) {
  const form = $('#edit-form').elements;
  state.editingId = todo.id;
  form.title.value = todo.title;
  form.site_id.value = todo.site_id ?? '';
  form.category_id.value = todo.category_id ?? '';
  form.due_date.value = todo.due_date ?? '';
  form.memo.value = todo.memo ?? '';
  $('#edit-error').textContent = '';
  $('#edit-dialog').showModal();
}

$('#add-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget.elements;
  $('#add-error').textContent = '';
  try {
    await api('/api/todos', { method: 'POST', body: formData(event.currentTarget) });
    form.title.value = '';
    form.memo.value = '';
    form.due_date.value = '';
    form.title.focus();
    await refresh();
  } catch (err) {
    $('#add-error').textContent = err.message;
  }
});

$('#edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api(`/api/todos/${state.editingId}`, { method: 'PATCH', body: formData(event.currentTarget) });
    $('#edit-dialog').close();
    await refresh();
  } catch (err) {
    $('#edit-error').textContent = err.message;
  }
});

$('#site-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  $('#site-error').textContent = '';
  try {
    const site = await api('/api/sites', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    state.sites = await api('/api/sites');
    fillSelects();
    $('#add-form').elements.site_id.value = site.id;
    form.reset();
    form.closest('details').open = false;
  } catch (err) {
    $('#site-error').textContent = err.message;
  }
});

$('#login-google').addEventListener('click', async () => {
  const { error } = await auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) $('#login-error').textContent = error.message;
});

$('#logout').addEventListener('click', async () => {
  await auth.signOut();
  location.reload();
});

$('#edit-cancel').addEventListener('click', () => $('#edit-dialog').close());

$('#filter-site').addEventListener('change', (event) => {
  state.filter.site = event.target.value;
  loadTodos();
});

$('#filter-status').addEventListener('change', (event) => {
  state.filter.status = event.target.value;
  loadTodos();
});

// ---------- 시작 ----------
// 로그인 모드면 세션을 확인한다. Google에서 돌아온 직후(?code=...)에는 여기서 세션으로 교환된다.
async function initAuth() {
  const config = await api('/api/config');
  if (!config.auth) return true;

  const { createClient } = await import(SUPABASE_JS);
  auth = createClient(config.supabaseUrl, config.supabaseKey, { auth: { flowType: 'pkce' } }).auth;
  const { data } = await auth.getSession();
  if (location.search.includes('code=')) history.replaceState(null, '', location.pathname);
  if (!data.session) {
    showLogin();
    return false;
  }
  $('#user-email').textContent = data.session.user.email;
  $('#user-box').hidden = false;
  auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') showLogin();
  });
  return true;
}

(async () => {
  if (!(await initAuth())) return;
  $('#app-view').hidden = false;
  [state.sites, state.categories] = await Promise.all([api('/api/sites'), api('/api/categories')]);
  fillSelects();
  renderTabs();
  await refresh();
})().catch((err) => {
  if (!$('#login-view').hidden) return; // 로그인 만료(401) → 로그인 화면이 이미 떠 있음
  $('#app-view').hidden = false;
  $('#todo-list').replaceChildren(el('li', { className: 'error', textContent: `불러오기 실패: ${err.message}` }));
});
