-- Supabase 새 프로젝트에 한 번만 실행하면 전체 스키마가 셋업됩니다.
-- 운영 중 변경은 supabase/migrations/ 폴더의 개별 파일을 적용하세요.
-- Project: shorts-studio

-- 1. pgvector 확장 활성화
create extension if not exists vector;

-- 2. 팀 사용자 테이블 (이름 기반 인증)
create table if not exists team_users (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

-- 3. 썰 앵글 테이블
create table if not exists story_angles (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  product_category text,
  angle text not null,
  hook text,
  fact text,
  sources jsonb default '[]'::jsonb,
  embedding vector(768),
  status text not null default 'idea',
    -- idea / producing / done / skipped
  user_id uuid references team_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. 유사도 검색 인덱스 (cosine)
create index if not exists story_angles_embedding_idx
  on story_angles using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 5. 흔히 거는 필터용 인덱스
create index if not exists story_angles_category_idx
  on story_angles (product_category);
create index if not exists story_angles_status_idx
  on story_angles (status);
create index if not exists story_angles_created_idx
  on story_angles (created_at desc);
create index if not exists story_angles_user_id_idx
  on story_angles (user_id);

-- 6. updated_at 자동 갱신 트리거
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists story_angles_updated_at on story_angles;
create trigger story_angles_updated_at
  before update on story_angles
  for each row execute function set_updated_at();

-- 7. 유사도 검색 RPC (사용자별 필터링)
create or replace function match_story_angles(
  query_embedding vector(768),
  match_threshold float default 0.85,
  match_count int default 5,
  user_id_filter uuid default null
)
returns table (
  id uuid,
  product_name text,
  angle text,
  similarity float
) language sql stable as $$
  select
    id,
    product_name,
    angle,
    1 - (embedding <=> query_embedding) as similarity
  from story_angles
  where 1 - (embedding <=> query_embedding) > match_threshold
    and (user_id_filter is null or user_id = user_id_filter)
  order by embedding <=> query_embedding
  limit match_count;
$$;
