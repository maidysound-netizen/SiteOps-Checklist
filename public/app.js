// SiteOps Checklist — 화면 로직
const state = {
  sites: [],
  categories: [],
  filter: { category: '', site: '', status: 'all' },
  editingId: null,
};

const $ = (selector) => document.querySelector(selector);

// 이 화면은 우리 서버(/api, /auth)만 호출한다. DB 주소·토큰·Client Secret은 브라우저에 없다.
// 로그인 토큰은 서버가 HttpOnly 쿠키로 관리하고, fetch가 자동으로 함께 보낸다.
async function api(path, options = {}) {
  const res = await fetch(path, {
    // X-Requested-With: 서버가 다른 사이트의 몰래 요청(CSRF)과 구분하는 표시
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) showLogin();
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
  renderSiteList();
}

// 사이트 관리 목록 (각 사이트 옆에 빼기 버튼)
function renderSiteList() {
  $('#site-list').replaceChildren(
    ...state.sites.map((site) =>
      el('li', {}, [
        el('span', { textContent: site.name }),
        el('button', {
          type: 'button',
          className: 'link-button',
          textContent: '빼기',
          ariaLabel: `${site.name} 사이트 빼기`,
          onclick: () => removeSite(site),
        }),
      ]),
    ),
  );
}

async function removeSite(site) {
  if (!confirm(`'${site.name}' 사이트를 뺄까요?\n\n이 사이트의 점검 항목은 지워지지 않고 '사이트 없음'으로 남습니다.`)) return;
  $('#site-error').textContent = '';
  try {
    await api(`/api/sites/${site.id}`, { method: 'DELETE' });
    state.sites = await api('/api/sites');
    if (state.filter.site === String(site.id)) state.filter.site = '';
    fillSelects();
    $('#filter-site').value = state.filter.site;
    await refresh();
  } catch (err) {
    $('#site-error').textContent = err.message;
  }
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

// 저장 전에 비밀 값(API 키·비밀번호)이 보이면 경고 (secret-check.js). 취소하면 저장하지 않는다.
function okToSave(data) {
  const found = findSecrets(data.title, data.memo);
  if (!found.length) return true;
  return confirm(
    `⚠️ 비밀 값처럼 보이는 내용이 있습니다: ${found.join(', ')}\n\n` +
      '할 일 목록에는 키·비밀번호를 적지 말고 비밀번호 관리자에 넣어 주세요.\n' +
      '(확인: 그래도 저장 / 취소: 돌아가서 고치기)',
  );
}

$('#add-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget.elements;
  $('#add-error').textContent = '';
  const data = formData(event.currentTarget);
  if (!okToSave(data)) return;
  try {
    await api('/api/todos', { method: 'POST', body: data });
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
  const data = formData(event.currentTarget);
  if (!okToSave(data)) return;
  try {
    await api(`/api/todos/${state.editingId}`, { method: 'PATCH', body: data });
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
  } catch (err) {
    $('#site-error').textContent = err.message;
  }
});

$('#login-google').addEventListener('click', () => {
  location.href = '/auth/google';
});

// 서비스 탈퇴: 계정과 모든 데이터 삭제 (되돌릴 수 없으므로 두 번 확인)
$('#delete-account').addEventListener('click', async () => {
  if (!confirm('서비스를 탈퇴할까요?\n\n내 사이트와 점검 항목이 모두 삭제되며 되돌릴 수 없습니다.')) return;
  if (!confirm('정말 탈퇴하시겠습니까? 삭제된 데이터는 복구할 수 없습니다.')) return;
  try {
    await api('/api/me', { method: 'DELETE' });
    alert('탈퇴가 완료되었습니다. 그동안 이용해 주셔서 감사합니다.');
    location.reload();
  } catch (err) {
    alert(`탈퇴하지 못했습니다: ${err.message}`);
  }
});

// ---------- 앱 설치 (PWA) ----------
// 크롬·엣지·삼성 인터넷은 설치 창을 바로 띄우고, 그 밖(아이폰 사파리 등)은 설치 방법 페이지로 안내한다
let installPrompt = null;
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if (isInstalled()) $('#install-app').hidden = true;

addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});
addEventListener('appinstalled', () => {
  $('#install-app').hidden = true;
});

$('#install-app').addEventListener('click', async () => {
  if (!installPrompt) {
    location.href = 'install.html';
    return;
  }
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  if (outcome === 'accepted') $('#install-app').hidden = true;
});

// 화면 파일을 저장해 두는 서비스 워커 (인터넷이 끊겨도 첫 화면이 뜨게, 일부 브라우저의 설치 조건)
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

$('#logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

// 모든 기기에서 로그아웃: 폰을 잃어버렸거나 다른 곳에 로그인이 남은 것 같을 때
$('#logout-all').addEventListener('click', async () => {
  if (!confirm('모든 기기에서 로그아웃할까요?\n\n이 기기를 포함해 이 계정으로 로그인한 모든 곳의 로그인이 끊깁니다. 데이터는 그대로입니다.')) return;
  try {
    await api('/api/logout-all', { method: 'POST' });
    location.reload();
  } catch (err) {
    alert(`로그아웃하지 못했습니다: ${err.message}`);
  }
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
// 로그인 상태 확인. 로그인 안 했으면 /api/me가 401 → 로그인 화면 (SQLite 모드는 로그인 없음)
async function initAuth() {
  const loginError = new URLSearchParams(location.search).get('login_error');
  if (loginError) history.replaceState(null, '', location.pathname);

  let me;
  try {
    me = await api('/api/me');
  } catch (err) {
    if ($('#login-view').hidden) throw err;
    $('#login-error').textContent = loginError ?? '';
    return false;
  }
  if (!me.auth) return true;
  $('#user-email').textContent = me.email ?? '';
  $('#user-box').hidden = false;
  $('#delete-account-box').hidden = false;
  if (me.cleanupDays) {
    $('#cleanup-note').textContent = `🧹 완료한 지 ${me.cleanupDays}일이 지난 항목은 자동으로 정리됩니다.`;
    $('#cleanup-note').hidden = false;
  }
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
