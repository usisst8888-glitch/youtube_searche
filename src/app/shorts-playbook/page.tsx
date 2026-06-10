"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ShortableMoment = {
  startSec: number;
  endSec: number;
  title: string;
  hookLine: string;
  payoff: string;
  why: string;
};

type PerVideoOk = {
  index: number;
  ok: true;
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationSec: number;
  views: number;
  brief: string;
  mainTopic: string;
  shortableMomentsCount: number;
  shortableMoments: ShortableMoment[];
};
type PerVideoFail = {
  index: number;
  ok: false;
  videoId: string | null;
  title: string;
  channel: string;
  thumbnail: string;
  url: string;
  reason: string;
};
type PerVideo = PerVideoOk | PerVideoFail;

type StructureBeat = { stage: string; beat: string; durationSec: number };

type Idea = {
  rank: number;
  title: string;
  hook: string;
  structure: StructureBeat[];
  retentionTactics: string[];
  estimatedDurationSec: number;
  sourceVideoIndex: number;
  sourceStartSec: number;
  whyItHits: string;
  difficulty: string;
};

type Playbook = {
  overview: string;
  commonPatterns: {
    sharedThemes: string[];
    hookFormula: string;
    structureTemplate: string;
    toneStyle: string;
    pacing: string;
  };
  ideaBank: Idea[];
  productionPlaybook: {
    step: number;
    title: string;
    detail: string;
    tools: string[];
    timeEstimate: string;
  }[];
  hookTemplates: { template: string; example: string; whenToUse: string }[];
  contentAngles: string[];
  actionChecklist: string[];
  warnings: string[];
};

type Result = {
  perVideo: PerVideo[];
  successVideoIds: string[];
  successVideoTitles: string[];
  stats: { total: number; analyzed: number; failed: number };
  playbook: Playbook;
};

const MAX_URLS = 6;
const DEFAULT_URLS = ["", "", "", "", ""];

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

function fmtViews(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}만`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}천`;
  return `${n}`;
}

const DIFFICULTY_COLOR: Record<string, string> = {
  쉬움: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  보통: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  어려움: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
};

const STAGE_COLOR: Record<string, string> = {
  배경: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  디테일:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  문제: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  반전: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
};

type ChatMsg = { role: "user" | "assistant"; content: string };

const SUGGESTED_QUESTIONS = [
  "아이디어 #1을 내 톤(차분한 정보형)으로 바꿔줘",
  "후크 템플릿 5개 더 만들어줘",
  "초보가 시작하기 제일 쉬운 아이디어 3개를 골라줘",
  "영상 [1]에서 짤만한 다른 모먼트 더 찾아줘",
  "이 패턴으로 한 주에 3편 올린다면 어떤 순서로?",
];

export default function ShortsPlaybookPage() {
  const [urls, setUrls] = useState<string[]>(DEFAULT_URLS);
  const [niche, setNiche] = useState("");
  const [audience, setAudience] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 후속 질문 챗
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // 새 메시지마다 스크롤
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat, chatLoading]);

  const validUrlCount = useMemo(
    () => urls.filter((u) => u.trim().length > 0).length,
    [urls],
  );

  function setUrl(i: number, val: string) {
    setUrls((prev) => {
      const next = [...prev];
      next[i] = val;
      return next;
    });
  }

  function addUrl() {
    if (urls.length >= MAX_URLS) return;
    setUrls((prev) => [...prev, ""]);
  }

  function removeUrl(i: number) {
    setUrls((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  }

  function handlePasteBulk(text: string, startIdx: number) {
    // 줄바꿈으로 여러 URL이 한꺼번에 paste되면 자동 분배
    const tokens = text
      .split(/[\n,\s]+/)
      .map((t) => t.trim())
      .filter((t) => /^https?:\/\//.test(t));
    if (tokens.length <= 1) return false;
    setUrls((prev) => {
      const next = [...prev];
      for (let k = 0; k < tokens.length && startIdx + k < MAX_URLS; k++) {
        if (next[startIdx + k] === undefined) next.push("");
        next[startIdx + k] = tokens[k];
      }
      return next.slice(0, MAX_URLS);
    });
    return true;
  }

  async function handleSubmit() {
    const list = urls.map((u) => u.trim()).filter(Boolean);
    if (list.length === 0) {
      setError("최소 1개 이상의 URL을 넣어주세요.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    // 새 분석 시작될 때 이전 챗 비우기 (useEffect 대신 setState 호출 시점에서 직접)
    setChat([]);
    setChatError("");
    try {
      const res = await fetch("/api/shorts-playbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls: list,
          niche: niche.trim() || undefined,
          audience: audience.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "분석에 실패했어요.");
        return;
      }
      setResult(data as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 중 오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  }

  function copyText(key: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  }

  async function sendChat(text?: string) {
    if (!result) return;
    const message = (text ?? chatInput).trim();
    if (!message) return;
    if (chatLoading) return;

    const next: ChatMsg[] = [...chat, { role: "user", content: message }];
    setChat(next);
    setChatInput("");
    setChatLoading(true);
    setChatError("");

    try {
      // API에 보낼 perVideo 최소 필드만 발췌
      const perVideoCtx = result.perVideo
        .filter((v): v is Extract<PerVideo, { ok: true }> => v.ok)
        .map((v) => ({
          index: v.index,
          title: v.title,
          channel: v.channel,
          mainTopic: v.mainTopic,
          brief: v.brief,
        }));

      const res = await fetch("/api/shorts-playbook/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          perVideo: perVideoCtx,
          playbook: result.playbook,
          messages: next,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatError(data.error || "답변 생성에 실패했어요.");
        // 마지막 user 메시지는 남겨두고 사용자가 다시 시도할 수 있게
        return;
      }
      setChat((prev) => [...prev, { role: "assistant", content: data.answer }]);
    } catch (e) {
      setChatError(
        e instanceof Error ? e.message : "요청 중 오류가 발생했어요.",
      );
    } finally {
      setChatLoading(false);
    }
  }

  function resetChat() {
    setChat([]);
    setChatError("");
  }

  function downloadPlaybook() {
    if (!result) return;
    const p = result.playbook;
    const md = [
      `# 쇼츠 제작 플레이북`,
      `> 레퍼런스 ${result.stats.analyzed}/${result.stats.total}개 영상 분석`,
      ``,
      `## 개요`,
      p.overview,
      ``,
      `## 공통 패턴`,
      `- 공유 테마: ${p.commonPatterns.sharedThemes.join(", ")}`,
      `- 후크 공식: ${p.commonPatterns.hookFormula}`,
      `- 구조 템플릿: ${p.commonPatterns.structureTemplate}`,
      `- 톤: ${p.commonPatterns.toneStyle}`,
      `- 페이싱: ${p.commonPatterns.pacing}`,
      ``,
      `## 쇼츠 아이디어 뱅크`,
      ...p.ideaBank.map((i) => {
        const srcTitle = result.successVideoTitles[i.sourceVideoIndex] || "";
        const srcId = result.successVideoIds[i.sourceVideoIndex] || "";
        const url = srcId
          ? `https://youtu.be/${srcId}?t=${i.sourceStartSec}`
          : "";
        return [
          `### ${i.rank}. ${i.title} (${i.difficulty})`,
          `- 후크: "${i.hook}"`,
          `- 구조:`,
          ...i.structure.map(
            (s) => `  - [${s.stage}] ${s.beat} (${s.durationSec}s)`,
          ),
          `- 이탈 방지: ${i.retentionTactics.join(", ")}`,
          `- 예상 길이: ${i.estimatedDurationSec}s`,
          `- 떡상 이유: ${i.whyItHits}`,
          `- 출처: ${srcTitle} → ${url}`,
          ``,
        ].join("\n");
      }),
      `## 제작 단계`,
      ...p.productionPlaybook.map((s) =>
        [
          `### Step ${s.step}. ${s.title} (${s.timeEstimate})`,
          s.detail,
          `도구: ${s.tools.join(", ")}`,
          ``,
        ].join("\n"),
      ),
      `## 후크 템플릿`,
      ...p.hookTemplates.map((h) =>
        [
          `- ${h.template}`,
          `  - 예시: ${h.example}`,
          `  - 언제: ${h.whenToUse}`,
        ].join("\n"),
      ),
      ``,
      `## 콘텐츠 앵글`,
      ...p.contentAngles.map((a) => `- ${a}`),
      ``,
      `## 오늘 할 일 체크리스트`,
      ...p.actionChecklist.map((a) => `- [ ] ${a}`),
      ``,
      `## 주의할 점`,
      ...p.warnings.map((w) => `- ⚠️ ${w}`),
    ].join("\n");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shorts-playbook-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">🚀 쇼츠 플레이북</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          롱폼 레퍼런스 영상을 최대 {MAX_URLS}개 넣으면, 공통 패턴을 뽑아서{" "}
          <strong>당장 만들 수 있는 쇼츠 아이디어 + 제작 단계</strong>를 정리해드려요.
        </p>
      </div>

      {/* 입력 */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium">
            레퍼런스 유튜브 URL{" "}
            <span className="text-xs text-zinc-500">
              ({validUrlCount}/{MAX_URLS}) · 자막 있는 롱폼 권장
            </span>
          </label>
          {urls.length < MAX_URLS && (
            <button
              onClick={addUrl}
              className="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 hover:border-red-300 dark:hover:border-red-700"
            >
              + 입력 칸 추가
            </button>
          )}
        </div>

        <div className="space-y-2">
          {urls.map((u, i) => (
            <div key={i} className="flex gap-2 items-center">
              <span className="shrink-0 text-xs font-mono text-zinc-400 w-6 text-right">
                {i + 1}.
              </span>
              <input
                type="url"
                value={u}
                onChange={(e) => setUrl(i, e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  if (handlePasteBulk(text, i)) e.preventDefault();
                }}
                placeholder="https://www.youtube.com/watch?v=... (여러 줄 paste도 OK)"
                className="flex-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700"
              />
              {urls.length > 1 && (
                <button
                  onClick={() => removeUrl(i)}
                  className="shrink-0 text-xs text-zinc-400 hover:text-rose-500 w-6"
                  title="삭제"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">
              내 채널 니치 (선택)
            </label>
            <input
              type="text"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="예: 재테크 / 운동 / 자기계발"
              className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">
              타겟 시청자 (선택)
            </label>
            <input
              type="text"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="예: 20대 사회 초년생 / 40대 워킹맘"
              className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700"
            />
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading || validUrlCount === 0}
          className="mt-5 w-full py-2.5 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading
            ? `분석 중… (영상별 추출 → 플레이북 생성, 보통 1~2분)`
            : `쇼츠 플레이북 만들기 (${validUrlCount}개 영상 분석)`}
        </button>

        {error && (
          <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="space-y-6">
          {/* 영상별 분석 (요약 그리드) */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                🎬 분석한 레퍼런스 영상 ({result.stats.analyzed}/{result.stats.total})
              </h3>
              {result.stats.failed > 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {result.stats.failed}개 실패 (자막 없음 등)
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {result.perVideo.map((v) => (
                <div
                  key={v.index}
                  className={`border rounded-lg p-3 flex gap-3 ${
                    v.ok
                      ? "border-zinc-200 dark:border-zinc-800"
                      : "border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/10"
                  }`}
                >
                  {v.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.thumbnail}
                      alt=""
                      className="w-28 h-16 object-cover rounded shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-zinc-500 mb-0.5">
                      [{v.index + 1}] {v.channel || "—"}
                      {v.ok && (
                        <>
                          {" · "}
                          <span className="font-mono">
                            👁️ {fmtViews(v.views)}
                          </span>
                          {" · "}
                          <span className="font-mono">
                            {fmtTime(v.durationSec)}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-sm font-medium leading-tight line-clamp-2 mb-1">
                      {v.title || "(제목 없음)"}
                    </div>
                    {v.ok ? (
                      <div className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          ✓ 골든 모먼트 {v.shortableMomentsCount}개
                        </span>
                        {" · "}
                        {v.mainTopic}
                      </div>
                    ) : (
                      <div className="text-xs text-rose-600 dark:text-rose-400">
                        ✕ {v.reason}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 개요 */}
          <div className="bg-gradient-to-br from-red-50 to-amber-50 dark:from-red-950/30 dark:to-amber-950/30 border border-red-200 dark:border-red-900/40 rounded-xl p-5">
            <div className="text-xs text-red-600 dark:text-red-400 font-semibold mb-2">
              📌 발견한 떡상 공식
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {result.playbook.overview}
            </p>
          </div>

          {/* 공통 패턴 */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3">🔍 공통 패턴</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <PatternRow
                label="공유 테마"
                value={result.playbook.commonPatterns.sharedThemes.join(" · ")}
              />
              <PatternRow
                label="후크 공식"
                value={result.playbook.commonPatterns.hookFormula}
              />
              <PatternRow
                label="구조 템플릿"
                value={result.playbook.commonPatterns.structureTemplate}
              />
              <PatternRow
                label="톤 스타일"
                value={result.playbook.commonPatterns.toneStyle}
              />
              <PatternRow
                label="페이싱"
                value={result.playbook.commonPatterns.pacing}
              />
            </div>
          </div>

          {/* 쇼츠 아이디어 뱅크 */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">
                💎 쇼츠 아이디어 뱅크 ({result.playbook.ideaBank.length}개)
              </h3>
              <span className="text-xs text-zinc-500">
                rank 1이 최고 우선 · 출처 클릭 시 원본 영상 그 시점으로 점프
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {result.playbook.ideaBank.map((idea) => {
                const srcTitle =
                  result.successVideoTitles[idea.sourceVideoIndex] || "";
                const srcId =
                  result.successVideoIds[idea.sourceVideoIndex] || "";
                return (
                  <div
                    key={`${idea.rank}-${idea.title}`}
                    className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4"
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <span className="shrink-0 text-xs font-bold w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center">
                        {idea.rank}
                      </span>
                      <h4 className="flex-1 text-sm font-bold leading-tight">
                        {idea.title}
                      </h4>
                      <span
                        className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${
                          DIFFICULTY_COLOR[idea.difficulty] ||
                          "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {idea.difficulty}
                      </span>
                    </div>

                    <div className="text-xs text-zinc-500 mb-1">후크</div>
                    <div className="mb-3 p-2 rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-sm font-medium italic">
                      &ldquo;{idea.hook}&rdquo;
                    </div>

                    <div className="text-xs text-zinc-500 mb-1">
                      구조 · 총 {idea.estimatedDurationSec}s
                    </div>
                    <div className="space-y-1 mb-3">
                      {idea.structure.map((s, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-xs"
                        >
                          <span
                            className={`shrink-0 px-1.5 py-0.5 rounded-full font-medium ${
                              STAGE_COLOR[s.stage?.trim()] ||
                              "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {s.stage}
                          </span>
                          <span className="flex-1 text-zinc-700 dark:text-zinc-300 leading-tight">
                            {s.beat}
                          </span>
                          <span className="shrink-0 text-zinc-400 font-mono">
                            {s.durationSec}s
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="text-xs text-zinc-500 mb-1">이탈 방지</div>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {idea.retentionTactics.map((t, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300"
                        >
                          {t}
                        </span>
                      ))}
                    </div>

                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3 leading-relaxed">
                      💥 {idea.whyItHits}
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                      <a
                        href={
                          srcId
                            ? `https://youtu.be/${srcId}?t=${idea.sourceStartSec}`
                            : "#"
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-zinc-500 hover:text-red-500 truncate"
                        title={srcTitle}
                      >
                        출처: [{idea.sourceVideoIndex + 1}]{" "}
                        <span className="font-mono text-red-500">
                          @{fmtTime(idea.sourceStartSec)}
                        </span>{" "}
                        {srcTitle}
                      </a>
                      <button
                        onClick={() =>
                          copyText(
                            `idea-${idea.rank}`,
                            `${idea.title}\n\n후크: "${idea.hook}"\n\n${idea.structure
                              .map(
                                (s) =>
                                  `[${s.stage}] ${s.beat} (${s.durationSec}s)`,
                              )
                              .join("\n")}`,
                          )
                        }
                        className="shrink-0 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                      >
                        {copiedKey === `idea-${idea.rank}` ? "복사됨" : "복사"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 제작 단계 */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3">
              🛠️ 제작 단계 ({result.playbook.productionPlaybook.length} step)
            </h3>
            <ol className="space-y-3">
              {result.playbook.productionPlaybook.map((s) => (
                <li
                  key={s.step}
                  className="flex gap-3 border-l-2 border-red-300 dark:border-red-700 pl-3"
                >
                  <div className="shrink-0 text-xs font-bold w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center">
                    {s.step}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-semibold">{s.title}</h4>
                      <span className="text-xs text-zinc-400">
                        {s.timeEstimate}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed mb-1.5 whitespace-pre-wrap">
                      {s.detail}
                    </p>
                    {s.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.tools.map((t, i) => (
                          <span
                            key={i}
                            className="text-xs px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* 후크 템플릿 */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-3">🎣 재사용 후크 템플릿</h3>
            <div className="space-y-3">
              {result.playbook.hookTemplates.map((h, i) => (
                <div
                  key={i}
                  className="border border-zinc-200 dark:border-zinc-800 rounded p-3"
                >
                  <div className="text-sm font-medium font-mono mb-1">
                    {h.template}
                  </div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                    예시: <span className="italic">&ldquo;{h.example}&rdquo;</span>
                  </div>
                  <div className="text-xs text-zinc-500">언제: {h.whenToUse}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 콘텐츠 앵글 + 체크리스트 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-3">🎯 콘텐츠 앵글</h3>
              <ul className="space-y-2">
                {result.playbook.contentAngles.map((a, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="text-violet-500 shrink-0">→</span>
                    <span className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      {a}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-3">
                ✅ 오늘 할 일 체크리스트
              </h3>
              <ul className="space-y-2">
                {result.playbook.actionChecklist.map((a, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 accent-red-500"
                    />
                    <span className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
                      {a}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 주의사항 */}
          {result.playbook.warnings.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-2 text-amber-700 dark:text-amber-300">
                ⚠️ 주의할 점
              </h3>
              <ul className="space-y-1.5">
                {result.playbook.warnings.map((w, i) => (
                  <li
                    key={i}
                    className="text-sm text-amber-700 dark:text-amber-200 leading-relaxed"
                  >
                    • {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 다운로드 */}
          <div className="flex justify-end gap-2">
            <button
              onClick={() =>
                copyText("full", JSON.stringify(result.playbook, null, 2))
              }
              className="text-xs px-3 py-2 rounded border border-zinc-200 dark:border-zinc-800 hover:border-red-300 dark:hover:border-red-700"
            >
              {copiedKey === "full" ? "JSON 복사됨!" : "JSON 복사"}
            </button>
            <button
              onClick={downloadPlaybook}
              className="text-xs px-3 py-2 rounded bg-red-500 text-white hover:bg-red-600"
            >
              📥 .md로 플레이북 다운로드
            </button>
          </div>

          {/* 후속 질문 챗 */}
          <div
            id="chat"
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5"
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold">💬 후속 질문</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  위 분석 결과를 기억해요. 아이디어 변형 / 추가 모먼트 / 톤
                  맞춤 / 일정 짜기 — 뭐든 물어보세요.
                </p>
              </div>
              {chat.length > 0 && (
                <button
                  onClick={resetChat}
                  className="text-xs text-zinc-400 hover:text-rose-500"
                  title="대화 초기화"
                >
                  대화 초기화
                </button>
              )}
            </div>

            {/* 메시지 영역 */}
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1 mb-3">
              {chat.length === 0 && !chatLoading && (
                <div className="text-center py-6 text-xs text-zinc-400">
                  💡 아래 추천 질문을 누르거나 직접 입력해보세요
                </div>
              )}

              {chat.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${
                    m.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-red-500 text-white rounded-br-sm"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 rounded-bl-sm"
                    }`}
                  >
                    {m.content}
                    {m.role === "assistant" && (
                      <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 flex justify-end">
                        <button
                          onClick={() => copyText(`chat-${i}`, m.content)}
                          className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                        >
                          {copiedKey === `chat-${i}` ? "복사됨" : "복사"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-100 dark:bg-zinc-800 rounded-2xl rounded-bl-sm px-4 py-2.5">
                    <div className="flex gap-1 items-center text-zinc-500 text-sm">
                      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" />
                      <span className="ml-2 text-xs">생각하는 중…</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {chatError && (
              <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">
                {chatError}
              </p>
            )}

            {/* 추천 질문 칩 */}
            {chat.length === 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendChat(q)}
                    disabled={chatLoading}
                    className="text-xs px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 hover:border-red-300 dark:hover:border-red-700 text-zinc-700 dark:text-zinc-300 disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* 입력 */}
            <div className="flex gap-2">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChat();
                  }
                }}
                rows={2}
                placeholder="질문 입력 (Enter로 전송, Shift+Enter로 줄바꿈)"
                className="flex-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700"
              />
              <button
                onClick={() => sendChat()}
                disabled={chatLoading || !chatInput.trim()}
                className="shrink-0 self-stretch px-5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                전송
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function PatternRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-0.5">{label}</div>
      <div className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
        {value}
      </div>
    </div>
  );
}
