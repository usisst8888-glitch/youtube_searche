-- 카테고리 관리 테이블 (팀 공통)
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists categories_order_idx
  on categories (display_order, name);

-- 기존 하드코딩 카테고리 시드
insert into categories (name, display_order) values
  ('식품', 1),
  ('뷰티', 2),
  ('가전', 3),
  ('생활', 4),
  ('패션', 5),
  ('IT', 6),
  ('문구', 7),
  ('주방', 8),
  ('반려', 9),
  ('스포츠', 10),
  ('기타', 99)
on conflict (name) do nothing;
