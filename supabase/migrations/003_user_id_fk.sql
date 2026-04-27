-- team_users 에 UUID id 추가 + PK 교체
alter table team_users
  add column if not exists id uuid default gen_random_uuid() not null;

-- 기존 PK 해제 후 id로 PK 재설정 (name은 unique 제약으로 보존)
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'team_users_pkey'
  ) then
    alter table team_users drop constraint team_users_pkey;
  end if;
end$$;

alter table team_users add primary key (id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_users_name_key'
  ) then
    alter table team_users add constraint team_users_name_key unique (name);
  end if;
end$$;

-- story_angles 에 user_id (FK) 추가
alter table story_angles
  add column if not exists user_id uuid;

create index if not exists story_angles_user_id_idx on story_angles(user_id);

-- 기존 user_code(text) 데이터를 user_id(uuid)로 마이그레이션
update story_angles sa
set user_id = tu.id
from team_users tu
where sa.user_id is null
  and sa.user_code is not null
  and sa.user_code = tu.name;

-- FK 제약 (사용자 삭제 시 앵글의 user_id는 NULL로)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'story_angles_user_id_fkey'
  ) then
    alter table story_angles
      add constraint story_angles_user_id_fkey
      foreign key (user_id) references team_users(id)
      on delete set null;
  end if;
end$$;

-- match_story_angles 함수 user_id_filter (uuid) 로 갈아엎기
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
