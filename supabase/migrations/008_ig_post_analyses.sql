-- 인스타 트래커 영상 Gemini 분석 결과 캐시
-- - shortcode 기준 1:1
-- - 별도 URL 분석(트래커 DB에 없는 영상)도 ad-hoc shortcode로 저장 (URL 그대로일 수도 있음)

create table if not exists ig_post_analyses (
  shortcode text primary key,             -- ig_posts.shortcode 또는 ad-hoc id
  source_url text not null,               -- 원본 인스타 URL
  video_url text,                         -- Gemini에 넣은 비디오 CDN URL (디버깅용)

  title text,                             -- 어그로 후크 제목
  transcript text,                        -- 영상 원본 전사 (들리는 대로)
  video_summary text,                     -- 한 줄 영상 요약
  story_premise text,                     -- 쇼츠 대본 스토리 전제
  script_scenes jsonb,                    -- 4씬 쇼츠 대본 [{index,emotion,text,durationSec}, ...]
  product_keywords jsonb,                 -- [{ keyword, lang: 'ko'|'zh', note }, ...]

  model text,                             -- 사용한 모델 이름
  analyzed_at timestamptz not null default now(),
  error text                              -- 실패 시 메시지
);

create index if not exists ig_post_analyses_analyzed_idx
  on ig_post_analyses (analyzed_at desc);

alter table ig_post_analyses disable row level security;
