-- 인스타 트래커: 등록된 프로필을 매일 1회 체크해서 새 포스트(최근 3일) 수집

-- ── 프로필 ────────────────────────────────────────────────────────────────
create table if not exists ig_profiles (
  username text primary key,
  display_name text,
  follower_count int,
  added_at timestamptz not null default now(),
  last_checked_at timestamptz,
  active boolean not null default true,
  note text
);
create index if not exists ig_profiles_active_idx on ig_profiles (active);

-- ── 포스트 (cap 5로 fetch한 것 중 3일 이내만 저장) ──────────────────────
create table if not exists ig_posts (
  shortcode text primary key,            -- 인스타 포스트 식별자
  username text not null references ig_profiles(username) on delete cascade,
  url text not null,
  posted_at timestamptz not null,        -- 인스타가 알려준 게시 시각
  post_type text,                        -- 'reel' | 'carousel' | 'image' | 'video'
  view_count int,                        -- reel/video는 재생수, 그 외는 null
  like_count int,
  comment_count int,
  caption text,
  thumbnail_url text,
  media_urls jsonb,                      -- carousel은 여러 개
  hashtags text[],
  mentions text[],
  first_seen_at timestamptz not null default now(),  -- 우리가 처음 발견한 시각
  last_metric_at timestamptz             -- 마지막으로 조회수/좋아요 갱신한 시각
);
create index if not exists ig_posts_username_posted_idx on ig_posts (username, posted_at desc);
create index if not exists ig_posts_posted_idx on ig_posts (posted_at desc);
create index if not exists ig_posts_first_seen_idx on ig_posts (first_seen_at desc);

-- ── 체크 런 (실행 이력) ──────────────────────────────────────────────────
create table if not exists ig_check_runs (
  id uuid primary key default gen_random_uuid(),
  apify_run_id text,                     -- Apify의 run ID (디버깅용)
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  profile_count int,
  fetched_post_count int,                -- Apify에서 받은 총 갯수
  saved_post_count int,                  -- 그 중 3일 이내라서 저장한 갯수
  new_post_count int,                    -- 그 중에서도 처음 발견한 갯수 (dedup 후)
  status text not null default 'running',  -- 'running' | 'done' | 'failed'
  error text,
  triggered_by text                      -- 'cron' | 'manual'
);
create index if not exists ig_check_runs_started_idx on ig_check_runs (started_at desc);

-- ── RLS는 끔 (server-side service key로만 접근) ──────────────────────────
alter table ig_profiles disable row level security;
alter table ig_posts disable row level security;
alter table ig_check_runs disable row level security;
