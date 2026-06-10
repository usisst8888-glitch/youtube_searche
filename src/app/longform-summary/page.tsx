"use client";

import { useMemo, useRef, useState } from "react";

type Chapter = {
  startSec: number;
  endSec: number;
  title: string;
  summary: string;
  keyPoints: string[];
};

type KeyQuote = { quote: string; atSec: number; why: string };

type Summary = {
  oneLineSummary: string;
  coreMessage: string;
  topicTags: string[];
  keyTakeaways: string[];
  chapters: Chapter[];
  keyQuotes: KeyQuote[];
  targetAudience: string;
  actionItems: string[];
  studyOutline: string;
};

type VideoMeta = {
  videoId: string;
  title: string;
  channel: string;
  channelId: string;
  thumbnail: string;
  durationSec: number;
  publishedAt: string;
  views: number;
  description: string;
};

type Result = {
  videoMeta: VideoMeta;
  transcriptStats: { segments: number; chars: number; truncated: boolean };
  summary: Summary;
};

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function fmtViews(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억 회`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}만 회`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}천 회`;
  return `${n}회`;
}

export default function LongformSummaryPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<"idle" | "fetch" | "summarize">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const youtubeWatchUrl = useMemo(
    () =>
      result
        ? `https://www.youtube.com/watch?v=${result.videoMeta.videoId}`
        : "",
    [result],
  );

  async function handleSubmit() {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("유튜브 URL을 넣어주세요.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    setStage("fetch");
    try {
      // 짧게 두 단계 표시 — 실제 추적은 안 하지만 UX상 단계감 줌
      const fetchTimer = setTimeout(() => setStage("summarize"), 1500);
      const res = await fetch("/api/summarize-longform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      clearTimeout(fetchTimer);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "요약에 실패했어요.");
        return;
      }
      setResult(data as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 중 오류가 발생했어요.");
    } finally {
      setLoading(false);
      setStage("idle");
    }
  }

  function jumpTo(sec: number) {
    if (!result) return;
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      // YouTube iframe API postMessage — enablejsapi=1 일 때 동작
      iframe.contentWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: "seekTo",
          args: [sec, true],
        }),
        "*",
      );
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: "playVideo", args: [] }),
        "*",
      );
      iframe.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function copyText(key: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  }

  function downloadMd() {
    if (!result) return;
    const blob = new Blob([result.summary.studyOutline], {
      type: "text/markdown;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const safeTitle = result.videoMeta.title
      .replace(/[\\/:*?"<>|]/g, "_")
      .slice(0, 60);
    a.download = `${safeTitle || "summary"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">📚 롱폼 요약</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          유튜브 롱폼 URL을 넣으면 자막을 가져와서 챕터별로 정리해드려요.
          시간 클릭하면 그 지점으로 점프해요.
        </p>
      </div>

      {/* 입력 카드 */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 mb-6">
        <label className="block text-sm font-medium mb-2">유튜브 URL</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) handleSubmit();
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700"
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !url.trim()}
            className="shrink-0 px-5 py-2.5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? stage === "fetch"
                ? "자막 가져오는 중…"
                : "AI 요약 중…"
              : "요약 시작"}
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          자막이 있는 영상만 가능해요 (자동/수동 자막 모두 OK). 자막이 없는
          영상은 ⛔
        </p>
        {error && (
          <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="space-y-6">
          {/* 비디오 + 메타 */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
            <div className="aspect-video bg-black">
              <iframe
                ref={iframeRef}
                src={`https://www.youtube.com/embed/${result.videoMeta.videoId}?enablejsapi=1&rel=0`}
                title={result.videoMeta.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
            <div className="p-5">
              <h2 className="text-lg font-bold leading-snug mb-2">
                {result.videoMeta.title}
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {result.videoMeta.channel}
                </span>
                <span>·</span>
                <span>{fmtTime(result.videoMeta.durationSec)}</span>
                <span>·</span>
                <span>조회수 {fmtViews(result.videoMeta.views)}</span>
                <span>·</span>
                <span>{fmtDate(result.videoMeta.publishedAt)}</span>
                <a
                  href={youtubeWatchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-red-500 hover:underline"
                >
                  유튜브에서 열기 ↗
                </a>
              </div>
            </div>
          </div>

          {/* 한 줄 + 핵심 + 태그 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <div className="text-xs text-zinc-500 mb-1">한 줄 요약</div>
              <p className="text-base font-semibold leading-snug mb-4">
                {result.summary.oneLineSummary}
              </p>
              <div className="text-xs text-zinc-500 mb-1">핵심 메시지</div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                {result.summary.coreMessage}
              </p>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <div className="text-xs text-zinc-500 mb-2">토픽</div>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {result.summary.topicTags.map((t) => (
                  <span
                    key={t}
                    className="text-xs px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <div className="text-xs text-zinc-500 mb-1">시청 추천 대상</div>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                {result.summary.targetAudience}
              </p>
            </div>
          </div>

          {/* 핵심 인사이트 */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">💡 핵심 인사이트</h3>
              <button
                onClick={() =>
                  copyText(
                    "takeaways",
                    result.summary.keyTakeaways.map((t) => `- ${t}`).join("\n"),
                  )
                }
                className="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 hover:border-red-300 dark:hover:border-red-700"
              >
                {copiedKey === "takeaways" ? "복사됨!" : "복사"}
              </button>
            </div>
            <ul className="space-y-2">
              {result.summary.keyTakeaways.map((t, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-emerald-500 shrink-0">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
                    {t}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* 챕터 */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">📖 챕터별 정리</h3>
              <span className="text-xs text-zinc-500">
                {result.summary.chapters.length}개 챕터 · 시간 클릭 시 점프
              </span>
            </div>
            <div className="space-y-3">
              {result.summary.chapters.map((c, i) => (
                <div
                  key={i}
                  className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 hover:border-red-300 dark:hover:border-red-700 transition-colors"
                >
                  <div className="flex items-start gap-3 mb-2">
                    <button
                      onClick={() => jumpTo(c.startSec)}
                      className="shrink-0 text-xs font-mono px-2 py-0.5 rounded bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50"
                      title="이 시점으로 점프"
                    >
                      {fmtTime(c.startSec)}
                    </button>
                    <h4 className="text-sm font-semibold leading-tight">
                      {i + 1}. {c.title}
                    </h4>
                    <span className="ml-auto text-xs text-zinc-400 shrink-0">
                      {fmtTime(c.endSec - c.startSec)}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed mb-2 whitespace-pre-wrap">
                    {c.summary}
                  </p>
                  {c.keyPoints.length > 0 && (
                    <ul className="space-y-1 mt-2">
                      {c.keyPoints.map((p, j) => (
                        <li
                          key={j}
                          className="text-xs text-zinc-600 dark:text-zinc-400 flex gap-1.5"
                        >
                          <span className="text-zinc-400 shrink-0">•</span>
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 인용 */}
          {result.summary.keyQuotes.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-3">💬 인상 깊은 인용</h3>
              <div className="space-y-3">
                {result.summary.keyQuotes.map((q, i) => (
                  <div
                    key={i}
                    className="border-l-2 border-red-300 dark:border-red-700 pl-3"
                  >
                    <p className="text-sm italic text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      &ldquo;{q.quote}&rdquo;
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      <button
                        onClick={() => jumpTo(q.atSec)}
                        className="font-mono text-red-500 hover:underline"
                      >
                        {fmtTime(q.atSec)}
                      </button>
                      <span className="text-zinc-500">— {q.why}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 액션 아이템 */}
          {result.summary.actionItems.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-3">⚡ 액션 아이템</h3>
              <ul className="space-y-2">
                {result.summary.actionItems.map((a, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="text-amber-500 shrink-0">▸</span>
                    <span className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      {a}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* outline 다운로드 */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">📝 공부 노트 (마크다운)</h3>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    copyText("outline", result.summary.studyOutline)
                  }
                  className="text-xs px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 hover:border-red-300 dark:hover:border-red-700"
                >
                  {copiedKey === "outline" ? "복사됨!" : "복사"}
                </button>
                <button
                  onClick={downloadMd}
                  className="text-xs px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600"
                >
                  .md 다운로드
                </button>
              </div>
            </div>
            <pre className="text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded p-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
              {result.summary.studyOutline}
            </pre>
          </div>

          <p className="text-xs text-zinc-400">
            자막 {result.transcriptStats.segments}개 segment ·{" "}
            {result.transcriptStats.chars.toLocaleString()}자
            {result.transcriptStats.truncated && " (긴 영상이라 일부 잘라서 분석)"}
          </p>
        </section>
      )}
    </div>
  );
}
