-- SiteOps Checklist — Supabase(Postgres) 스키마 + 예시 데이터
-- 실행: Supabase 대시보드 → SQL Editor → 이 파일 내용을 붙여넣고 Run
-- 여러 번 실행해도 안전합니다 (이미 있는 테이블·데이터는 건너뜀).
-- db/schema.sql(SQLite)과 같은 구조를 Postgres 문법으로 옮긴 것입니다.

-- ---------- 테이블 ----------

-- 관리 대상 사이트
create table if not exists public.sites (
  id         bigint generated always as identity primary key,
  name       text        not null unique check (length(trim(name)) > 0),
  url        text,
  created_at timestamptz not null default now()
);

-- 점검 분류 (추가 기능 1)
create table if not exists public.categories (
  id         bigint generated always as identity primary key,
  name       text        not null unique check (length(trim(name)) > 0),
  color      text        not null default '#6b7280',  -- 배지 색상 (hex)
  sort_order integer     not null default 0,
  created_at timestamptz not null default now()
);

-- 점검 항목 (Todo)
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
-- security_invoker: 뷰를 조회하는 사람의 권한(RLS)을 그대로 따른다
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
-- 정책(policy)을 만들지 않았으므로 공개 키(anon/publishable)로는 읽기·쓰기 모두 차단된다.
-- 서버는 secret 키로 접속하므로 RLS를 우회해 정상 동작한다.
-- 사용자별 접근 허용(Auth + RLS 정책)은 v2에서 추가한다.
alter table public.sites      enable row level security;
alter table public.categories enable row level security;
alter table public.todos      enable row level security;

-- ---------- 예시 데이터 ----------

insert into public.sites (name) values
  ('Takako World'),
  ('King''s St.')
on conflict (name) do nothing;

insert into public.categories (name, color, sort_order) values
  ('보안',   '#dc2626', 1),
  ('배포',   '#2563eb', 2),
  ('백업',   '#16a34a', 3),
  ('DNS',    '#9333ea', 4),
  ('콘텐츠', '#d97706', 5)
on conflict (name) do nothing;

-- 점검 항목이 하나도 없을 때만 예시 항목을 넣는다
insert into public.todos (title, site_id, category_id, due_date, is_done)
select v.title,
       (select id from public.sites      where name = v.site),
       (select id from public.categories where name = v.category),
       (now() at time zone 'Asia/Seoul')::date + v.due_offset,
       v.is_done
from (values
  ('관리자 로그인 권한 점검',        'Takako World', '보안', -1,              false),
  ('SFX 번역 컨트롤 배포 확인',      'Takako World', '배포',  0,              false),
  ('게임 데이터 백업 방식 검토',     'King''s St.',  '백업',  7,              false),
  ('GitHub 저장소 비공개 설정 확인', 'Takako World', '보안',  null::integer, true)
) as v(title, site, category, due_offset, is_done)
where not exists (select 1 from public.todos);
