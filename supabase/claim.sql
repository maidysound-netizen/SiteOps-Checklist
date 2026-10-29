-- v1(로그인 기능 전)에 만든 사이트·점검 항목을 내 계정으로 옮기기
-- 실행 순서: setup.sql 실행 → 앱에서 Google로 처음 로그인 → 이 파일 실행 (한 번만)
-- 주인이 없는(user_id가 비어 있는) 행을 가장 먼저 가입한 계정에 붙인다.

update public.sites
set user_id = (select id from auth.users order by created_at limit 1)
where user_id is null;

update public.todos
set user_id = (select id from auth.users order by created_at limit 1)
where user_id is null;

-- 확인: 주인 없는 행이 0이면 완료
select (select count(*) from public.sites where user_id is null) as unowned_sites,
       (select count(*) from public.todos where user_id is null) as unowned_todos;
