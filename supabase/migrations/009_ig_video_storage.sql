-- 인스타 분석 영상을 Supabase Storage에 24시간 보관
-- 분석 시점에 영상 buffer를 insta-videos 버킷에 업로드 → path 저장
-- 24h 후 cron이 자동 삭제

alter table ig_post_analyses
  add column if not exists video_storage_path text,
  add column if not exists video_expires_at timestamptz;

create index if not exists ig_post_analyses_video_expires_idx
  on ig_post_analyses (video_expires_at)
  where video_storage_path is not null;
