-- Supabase SQL Editor에서 한 번만 실행하세요.
-- Project: shorts-studio

-- 1. pgvector 확장 활성화
create extension if not exists vector;

-- 2. 썰 앵글 테이블
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
  user_code text,                       -- 팀원 분리용
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. 유사도 검색 인덱스 (cosine)
create index if not exists story_angles_embedding_idx
  on story_angles using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 4. 흔히 거는 필터용 인덱스
create index if not exists story_angles_category_idx
  on story_angles (product_category);
create index if not exists story_angles_status_idx
  on story_angles (status);
create index if not exists story_angles_created_idx
  on story_angles (created_at desc);
create index if not exists story_angles_user_code_idx
  on story_angles (user_code);

-- 5. updated_at 자동 갱신 트리거
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

-- 6. 유사도 검색 RPC 함수 (API에서 호출)
create or replace function match_story_angles(
  query_embedding vector(768),
  match_threshold float default 0.85,
  match_count int default 5,
  user_code_filter text default null
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
    and (user_code_filter is null or user_code = user_code_filter)
  order by embedding <=> query_embedding
  limit match_count;
$$;
