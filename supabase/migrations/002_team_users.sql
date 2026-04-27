-- 팀원 인증용 테이블
create table if not exists team_users (
  name text primary key,           -- 본인 이름 (인증 키)
  display_name text,               -- 표시용 (예: "대표", "디자이너")
  created_at timestamptz not null default now()
);

-- 초기 시드 (관리자가 Supabase Studio에서 직접 추가/수정 가능)
insert into team_users (name, display_name) values
  ('배철웅', '대표')
on conflict (name) do nothing;
