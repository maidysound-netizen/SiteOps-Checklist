-- SiteOps Checklist — Supabase(Postgres) 스키마 v2 (Google 로그인 + 사용자별 데이터)
-- 실행: Supabase 대시보드 → SQL Editor → 이 파일 내용을 붙여넣고 Run
-- 여러 번 실행해도 안전합니다. 새 프로젝트에도, v1(로그인 없음) DB에도 그대로 실행하면 됩니다.
-- db/schema.sql(SQLite)과 같은 구조를 Postgres 문법으로 옮기고, 사용자 구분을 더한 것입니다.

-- ---------- 테이블 ----------

-- 관리 대상 사이트 (사용자별)
create table if not exists public.sites (
  id         bigint generated always as identity primary key,
  name       text        not null check (length(trim(name)) > 0),
  url        text,
  created_at timestamptz not null default now()
);

-- 점검 분류 (추가 기능 1) — 모든 사용자 공통
create table if not exists public.categories (
  id         bigint generated always as identity primary key,
  name       text        not null unique check (length(trim(name)) > 0),
  color      text        not null default '#6b7280',  -- 배지 색상 (hex)
  sort_order integer     not null default 0,
  created_at timestamptz not null default now()
);

-- 점검 항목 (Todo, 사용자별)
create table if not exists public.todos (
  id           bigint generated always as identity primary key,
  title        text        not null check (length(trim(title)) between 1 and 100),
  memo         text,
  site_id      bigint      references public.sites(id)      on delete set null,
  category_id  bigint      references public.categories(id) on delete set null,
  due_date     date,                                       -- 추가 기능 2
  is_done      boolean     not null default false,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- 사용자 구분 (v2) ----------
-- 행을 만든 로그인 사용자. 값을 보내지 않아도 auth.uid()가 자동으로 들어간다.
-- 탈퇴(auth.users 삭제) 시 그 사람의 데이터도 함께 삭제된다.
alter table public.sites add column if not exists user_id uuid
  default auth.uid() references auth.users(id) on delete cascade;
alter table public.todos add column if not exists user_id uuid
  default auth.uid() references auth.users(id) on delete cascade;

-- 사이트 이름은 사용자마다 따로 중복 금지 (v1의 전체 unique 제거)
alter table public.sites drop constraint if exists sites_name_key;
create unique index if not exists sites_user_name_key on public.sites (user_id, name);

create index if not exists idx_todos_user       on public.todos (user_id);
create index if not exists idx_todos_status_due on public.todos (is_done, due_date);
create index if not exists idx_todos_category   on public.todos (category_id);
create index if not exists idx_todos_site       on public.todos (site_id);

-- ---------- 트리거: updated_at / completed_at 자동 관리 ----------

create or replace function public.todos_set_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.completed_at := case when new.is_done then now() end;
  else
    new.updated_at := now();
    if new.is_done is distinct from old.is_done then
      new.completed_at := case when new.is_done then now() end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_todos_set_timestamps on public.todos;
create trigger trg_todos_set_timestamps
before insert or update on public.todos
for each row execute function public.todos_set_timestamps();

-- ---------- 목록 화면용 뷰 ----------
-- security_invoker: 뷰를 조회하는 사람의 권한(RLS)을 그대로 따른다 → 내 항목만 보인다
create or replace view public.todo_list
with (security_invoker = true) as
select
  t.id, t.title, t.memo, t.due_date, t.is_done, t.completed_at,
  t.created_at, t.updated_at,
  t.site_id,     s.name  as site_name,
  t.category_id, c.name  as category_name, c.color as category_color,
  case
    when t.is_done or t.due_date is null                        then null
    when t.due_date <  (now() at time zone 'Asia/Seoul')::date then 'overdue'
    when t.due_date =  (now() at time zone 'Asia/Seoul')::date then 'today'
    else 'upcoming'
  end as due_status
from public.todos t
left join public.sites      s on s.id = t.site_id
left join public.categories c on c.id = t.category_id;

-- ---------- 보안: RLS ----------
-- 로그인한 사용자(authenticated)는 자기 행만 읽고 쓸 수 있다.
-- 로그인하지 않은 공개 키(anon)에는 정책도 권한도 없으므로 모두 차단된다.
alter table public.sites      enable row level security;
alter table public.categories enable row level security;
alter table public.todos      enable row level security;

drop policy if exists "own sites" on public.sites;
create policy "own sites" on public.sites
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 항목에 연결하는 사이트도 내 사이트여야 한다 (남의 사이트 id를 붙이는 것 방지)
drop policy if exists "own todos" on public.todos;
create policy "own todos" on public.todos
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (site_id is null or exists (select 1 from public.sites s where s.id = site_id))
  );

drop policy if exists "read categories" on public.categories;
create policy "read categories" on public.categories
  for select to authenticated
  using (true);

-- 테이블 권한. 최근 Supabase 프로젝트는 SQL로 만든 테이블에 권한을 자동으로 주지 않는다.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.sites, public.todos to authenticated;
grant select on public.categories, public.todo_list to authenticated;
grant select, insert, update, delete on public.sites, public.categories, public.todos to service_role;
grant select on public.todo_list to service_role;

-- ---------- 예시 데이터 ----------
-- 카테고리만 넣는다. 사이트와 점검 항목은 로그인한 사용자가 직접 만든다.

insert into public.categories (name, color, sort_order) values
  ('보안',   '#dc2626', 1),
  ('배포',   '#2563eb', 2),
  ('백업',   '#16a34a', 3),
  ('DNS',    '#9333ea', 4),
  ('콘텐츠', '#d97706', 5)
on conflict (name) do nothing;
