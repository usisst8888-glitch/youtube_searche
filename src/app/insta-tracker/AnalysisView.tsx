"use client";

// 인스타 영상 분석 결과 표시 컴포넌트 (모달 안 / 별도 페이지 둘 다에서 재사용)

export type Analysis = {
  shortcode: string;
  source_url: string;
  video_url: string | null;
  title: string | null;
  transcript: string | null;
  video_summary: string | null;
  story_premise: string | null;
  script_scenes:
    | { index: number; text: string; emotion: string; durationSec: number }[]
    | null;
  product_keywords:
    | { keyword: string; lang: "ko" | "zh"; note?: string }[]
    | null;
  model: string | null;
  analyzed_at: string;
};

function xhsSearchUrl(keyword: string): string {
  return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(
    keyword,
  )}&source=web_explore_feed`;
}

function douyinSearchUrl(keyword: string): string {
  return `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`;
}

export function AnalysisView({ a }: { a: Analysis }) {
  const scenes = a.script_scenes || [];
  const keywords = a.product_keywords || [];

  return (
    <div className="space-y-5">
      {/* 어그로 제목 */}
      {a.title && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-500 mb-1.5">
            🔥 어그로 제목
          </h3>
          <p className="text-lg font-bold text-zinc-800 dark:text-zinc-100 leading-snug">
            {a.title}
          </p>
        </section>
      )}

      {/* 한 줄 요약 */}
      {a.video_summary && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-500 mb-1.5">
            📝 한 줄 요약
          </h3>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">
            {a.video_summary}
          </p>
        </section>
      )}

      {/* 샤오홍슈/도우인 검색 키워드 — 가장 위에 두 번째로 노출 */}
      {keywords.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-500 mb-2">
            🔍 샤오홍슈/도우인 검색 키워드 — 클릭하면 새 탭에서 바로 검색
          </h3>
          <div className="space-y-1.5">
            {keywords.map((k, i) => (
              <div
                key={`${k.keyword}-${i}`}
                className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2"
              >
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                    k.lang === "zh"
                      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                      : "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                  }`}
                >
                  {k.lang === "zh" ? "中文" : "한국어"}
                </span>
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100 truncate flex-1">
                  {k.keyword}
                </span>
                {k.note && (
                  <span
                    className="text-[11px] text-zinc-400 truncate max-w-[40%]"
                    title={k.note}
                  >
                    {k.note}
                  </span>
                )}
                <a
                  href={xhsSearchUrl(k.keyword)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 shrink-0"
                >
                  📕 샤오홍슈
                </a>
                <a
                  href={douyinSearchUrl(k.keyword)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] px-2 py-1 rounded bg-zinc-800 text-white hover:bg-black dark:bg-zinc-700 dark:hover:bg-zinc-600 shrink-0"
                >
                  🎵 도우인
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 원본 전사 */}
      {a.transcript && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-500 mb-1.5">
            🎙 원본 전사 (영상에서 들리는 말 그대로)
          </h3>
          <p className="text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
            {a.transcript}
          </p>
        </section>
      )}

      {/* 재창작 쇼츠 대본 */}
      {scenes.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-500 mb-1.5">
            ✂️ 재창작 쇼츠 대본 (4씬, 32초)
          </h3>
          {a.story_premise && (
            <p className="text-xs text-zinc-500 italic mb-2">
              💡 {a.story_premise}
            </p>
          )}
          <div className="space-y-2">
            {scenes.map((sc) => (
              <div
                key={sc.index}
                className="flex gap-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3"
              >
                <div className="flex flex-col items-center gap-0.5 shrink-0 pt-0.5">
                  <span className="text-xs font-bold text-zinc-400">
                    {sc.index + 1}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                    {sc.emotion}
                  </span>
                </div>
                <p className="text-sm text-zinc-700 dark:text-zinc-200 leading-relaxed">
                  {sc.text}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 메타 */}
      <div className="text-[10px] text-zinc-400 pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
        <span>
          분석: {new Date(a.analyzed_at).toLocaleString("ko-KR")}
          {a.model && ` · ${a.model}`}
        </span>
        <a
          href={a.source_url}
          target="_blank"
          rel="noreferrer"
          className="hover:text-red-500"
        >
          원본 ↗
        </a>
      </div>
    </div>
  );
}
