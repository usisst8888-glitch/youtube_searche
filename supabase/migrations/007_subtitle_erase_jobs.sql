-- 자막 제거 작업 히스토리
-- 결과 영상 파일 자체는 로컬 디스크(./data/erase-subtitle/{id}.mp4)에 저장.
-- 여기서는 메타데이터(상태, 감지결과, 파일 경로 등)만 추적.

create table if not exists subtitle_erase_jobs (
  id uuid primary key default gen_random_uuid(),
  prediction_id text unique,              -- Replicate prediction ID
  original_filename text,
  original_size_bytes bigint,

  -- 진행 상태
  status text not null default 'starting',
    -- 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  error text,

  -- 분석 결과
  detection jsonb,                        -- { found, confidence, fallback, bbox01k, pixelBox, note }
  video_meta jsonb,                       -- { width, height, durationSec }
  first_frame_base64 text,                -- 미리보기용 작은 JPEG (640px)

  -- Replicate 정보
  replicate_output_url text,              -- 만료될 임시 URL (다운로드 받기 전까지만 유효)
  predict_time_sec numeric,

  -- 로컬 파일 (영구 저장)
  local_file_path text,                   -- 디스크 절대 경로 (예: /Users/.../data/erase-subtitle/{id}.mp4)
  local_file_size_bytes bigint,
  output_extension text,                  -- "mp4" 등

  -- 타임스탬프
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  saved_at timestamptz
);

create index if not exists subtitle_erase_jobs_created_idx
  on subtitle_erase_jobs (created_at desc);
create index if not exists subtitle_erase_jobs_status_idx
  on subtitle_erase_jobs (status);

alter table subtitle_erase_jobs disable row level security;
