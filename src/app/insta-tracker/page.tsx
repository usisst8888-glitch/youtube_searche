"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnalysisView, type Analysis } from "./AnalysisView";

// ── 타입 ───────────────────────────────────────────────────────────────
type Profile = {
  username: string;
  display_name: string | null;
  follower_count: number | null;
  added_at: string;
  last_checked_at: string | null;
  active: boolean;
};

type Post = {
  shortcode: string;
  username: string;
  url: string;
  posted_at: string;
  post_type: "reel" | "carousel" | "image" | "video" | "unknown";
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  caption: string;
  thumbnail_url: string;
  hashtags: string[];
  first_seen_at: string;
};

type RunInfo = {
  id: string;
  started_at: string;
  finished_at: string | null;
  profile_count: number | null;
  fetched_post_count: number | null;
  saved_post_count: number | null;
  new_post_count: number | null;
  status: "running" | "done" | "failed";
  error: string | null;
  triggered_by: string | null;
};

type FeedsResponse = {
  posts: Post[];
  lastRun: RunInfo | null;
  window: { hours: number; cutoff: string };
};

// ── 헬퍼 ───────────────────────────────────────────────────────────────
function fmtViews(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}만`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}천`;
  return `${n}`;
}

function fmtRelTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const POST_TYPE_BADGE: Record<string, string> = {
  reel: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  carousel:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  image: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  video: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  unknown:
    "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const POST_TYPE_LABEL: Record<string, string> = {
  reel: "🎬 릴스",
  carousel: "🎠 캐러셀",
  image: "🖼 사진",
  video: "📹 영상",
  unknown: "—",
};

// ───────────────────────────────────────────────────────────────────────
export default function InstaTrackerPage() {
  const [tab, setTab] = useState<"feeds" | "profiles" | "my">("feeds");

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-1">📡 인스타 트래커</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            등록한 프로필을 매일 1회 체크해서 <strong>최근 24시간 이내</strong> 새 포스트를 모아드려요. 게시 시각이 24h 지난 건 자동 삭제돼요.
          </p>
        </div>
        <a
          href="/insta-tracker/analyze"
          className="text-xs px-3 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-red-500 text-white font-medium hover:opacity-90 whitespace-nowrap shrink-0"
        >
          🤖 URL로 분석
        </a>
      </div>

      <div className="flex gap-1 mb-5 border-b border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setTab("feeds")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "feeds"
              ? "border-red-500 text-red-600 dark:text-red-400"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          새 피드
        </button>
        <button
          onClick={() => setTab("profiles")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "profiles"
              ? "border-red-500 text-red-600 dark:text-red-400"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          프로필 관리
        </button>
        <button
          onClick={() => setTab("my")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "my"
              ? "border-red-500 text-red-600 dark:text-red-400"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          🤖 내 분석
        </button>
      </div>

      {tab === "feeds" ? (
        <FeedsTab />
      ) : tab === "profiles" ? (
        <ProfilesTab />
      ) : (
        <MyAnalysesTab />
      )}
    </div>
  );
}

// ── 새 피드 탭 ───────────────────────────────────────────────────────────
function FeedsTab() {
  const [data, setData] = useState<FeedsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<"first_seen" | "posted" | "views" | "likes">(
    "first_seen",
  );
  const [type, setType] = useState<"all" | "reel" | "carousel">("all");
  const [refreshKey, setRefreshKey] = useState(0);

  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [pollMsg, setPollMsg] = useState("");

  // 데이터 fetch — sort/type 바뀌거나 refreshKey 증가 시 재실행
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ sort, type, hours: "24" });
        const res = await fetch(`/api/insta-tracker/feeds?${params}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || "조회 실패");
        } else {
          setData(json as FeedsResponse);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "조회 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sort, type, refreshKey]);

  const refresh = useCallback(() => {
    setLoading(true);
    setRefreshKey((k) => k + 1);
  }, []);

  // run polling — activeRunId 있는 동안 5초마다
  useEffect(() => {
    if (!activeRunId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/insta-tracker/poll?runId=${activeRunId}`,
        );
        const json = await res.json();
        if (stopped) return;
        if (json.status === "done") {
          setPollMsg(
            `완료 — 받은 포스트 ${json.fetchedPostCount}개 · 저장 ${json.savedPostCount}개 (24h 이내) · 처음 본 것 ${json.newPostCount}개${json.deletedOldPostCount ? ` · 만료 삭제 ${json.deletedOldPostCount}개` : ""}`,
          );
          setActiveRunId(null);
          setRefreshKey((k) => k + 1);
        } else if (json.status === "failed") {
          setPollMsg(`실패: ${json.error || json.apifyStatus || "unknown"}`);
          setActiveRunId(null);
        } else {
          setPollMsg(
            `Apify 작업중… (${json.apifyStatus || "RUNNING"}) — 100 프로필이면 10~20분 걸려요`,
          );
        }
      } catch (e) {
        if (!stopped)
          setPollMsg(`폴링 오류: ${e instanceof Error ? e.message : ""}`);
      }
    };
    void poll();
    const id = setInterval(() => {
      if (!stopped) void poll();
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [activeRunId]);

  async function triggerNow(mode: "sync" | "async") {
    setTriggering(true);
    setTriggerError("");
    setPollMsg("");
    try {
      const res = await fetch("/api/insta-tracker/check-feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, triggeredBy: "manual" }),
      });
      const json = await res.json();
      if (!res.ok) {
        setTriggerError(json.error || "트리거 실패");
        return;
      }
      if (mode === "sync") {
        setPollMsg(
          `완료 — 저장 ${json.saved}개 · 처음 본 것 ${json.newSeen}개 · 24h 이전이라 스킵 ${json.skippedOld}개${json.deleted ? ` · 만료 삭제 ${json.deleted}개` : ""}`,
        );
        setRefreshKey((k) => k + 1);
      } else {
        setActiveRunId(json.runId);
      }
    } catch (e) {
      setTriggerError(e instanceof Error ? e.message : "트리거 실패");
    } finally {
      setTriggering(false);
    }
  }

  const posts = data?.posts || [];

  return (
    <div className="space-y-4">
      {/* 컨트롤 바 */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">정렬</span>
          <select
            value={sort}
            onChange={(e) =>
              setSort(e.target.value as typeof sort)
            }
            className="text-sm rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2 py-1"
          >
            <option value="first_seen">발견순</option>
            <option value="posted">게시일순</option>
            <option value="views">조회수순</option>
            <option value="likes">좋아요순</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">타입</span>
          <select
            value={type}
            onChange={(e) =>
              setType(e.target.value as typeof type)
            }
            className="text-sm rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2 py-1"
          >
            <option value="all">전체</option>
            <option value="reel">릴스만</option>
            <option value="carousel">캐러셀만</option>
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => triggerNow("async")}
            disabled={triggering || !!activeRunId}
            className="text-sm px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
          >
            {activeRunId
              ? "Apify 작업중…"
              : triggering
                ? "시작 중…"
                : "🔄 지금 체크"}
          </button>
          <button
            onClick={refresh}
            className="text-sm px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 hover:border-red-300 dark:hover:border-red-700"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* 상태 메시지 */}
      {(pollMsg || triggerError || data?.lastRun) && (
        <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-2.5 text-xs">
          {triggerError && (
            <span className="text-rose-600 dark:text-rose-400">
              ⚠️ {triggerError}
            </span>
          )}
          {pollMsg && !triggerError && (
            <span className="text-zinc-700 dark:text-zinc-300">{pollMsg}</span>
          )}
          {!pollMsg && !triggerError && data?.lastRun && (
            <span className="text-zinc-500">
              마지막 체크: {fmtDateTime(data.lastRun.started_at)} (
              {data.lastRun.triggered_by || "—"})
              {data.lastRun.status === "done" && (
                <>
                  {" "}
                  · 받은 {data.lastRun.fetched_post_count || 0}개 → 저장{" "}
                  {data.lastRun.saved_post_count || 0}개 → 처음 본{" "}
                  <strong className="text-red-500">
                    {data.lastRun.new_post_count || 0}개
                  </strong>
                </>
              )}
              {data.lastRun.status === "running" && " · 진행 중"}
              {data.lastRun.status === "failed" && (
                <span className="text-rose-500">
                  {" "}
                  · 실패 ({data.lastRun.error})
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {/* 결과 */}
      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-zinc-400 text-sm">불러오는 중…</div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12 text-zinc-400 text-sm">
          최근 24시간 이내 발견된 포스트가 없어요. 프로필을 등록하고 &ldquo;지금 체크&rdquo;를 눌러보세요.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((p, i) => (
            <PostCard key={p.shortcode} post={p} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({ post, index }: { post: Post; index: number }) {
  // stagger delay — 처음 30개만 적용 (그 이상은 즉시) 너무 길어지면 답답
  const delayMs = index < 30 ? index * 60 : 0;
  const [open, setOpen] = useState(false);

  const isVideoLike = post.post_type === "reel" || post.post_type === "video";

  return (
    <>
      <div
        style={{ animationDelay: `${delayMs}ms` }}
        className="animate-fade-in-up group flex bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden hover:border-red-300 dark:hover:border-red-700 hover:shadow-md transition-all"
      >
        {/* 왼쪽: 정사각 썸네일 */}
        <div className="shrink-0 w-32 h-32 sm:w-40 sm:h-40 bg-zinc-100 dark:bg-zinc-800 relative">
          {post.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/proxy-asset?url=${encodeURIComponent(post.thumbnail_url)}`}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-400 text-xs">
              썸네일 없음
            </div>
          )}
          <span
            className={`absolute bottom-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${
              POST_TYPE_BADGE[post.post_type] || POST_TYPE_BADGE.unknown
            } backdrop-blur-sm`}
          >
            {POST_TYPE_LABEL[post.post_type] || POST_TYPE_LABEL.unknown}
          </span>
        </div>

        {/* 오른쪽: 정보 */}
        <div className="flex-1 min-w-0 p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-zinc-700 dark:text-zinc-200 truncate">
              @{post.username}
            </span>
            <span className="text-zinc-400">·</span>
            <span className="text-zinc-500" title={post.posted_at}>
              {fmtRelTime(post.posted_at)}
            </span>
            <a
              href={post.url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-zinc-400 shrink-0 hover:text-red-500 transition-colors"
            >
              원본 ↗
            </a>
          </div>

          {post.caption && (
            <p className="text-sm text-zinc-700 dark:text-zinc-200 leading-relaxed line-clamp-2">
              {post.caption}
            </p>
          )}

          <div className="mt-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
              {post.view_count !== null && post.view_count !== undefined && (
                <span
                  className="flex items-center gap-1"
                  title={`조회 ${post.view_count.toLocaleString()}`}
                >
                  <span className="opacity-60">👁</span>{" "}
                  <strong className="font-semibold text-zinc-700 dark:text-zinc-200">
                    {fmtViews(post.view_count)}
                  </strong>
                </span>
              )}
              <span
                className="flex items-center gap-1"
                title={`좋아요 ${post.like_count?.toLocaleString() || 0}`}
              >
                <span className="opacity-60">❤️</span>{" "}
                {fmtViews(post.like_count)}
              </span>
              <span
                className="flex items-center gap-1"
                title={`댓글 ${post.comment_count?.toLocaleString() || 0}`}
              >
                <span className="opacity-60">💬</span>{" "}
                {fmtViews(post.comment_count)}
              </span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              {post.hashtags && post.hashtags.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {post.hashtags.slice(0, 2).map((h) => (
                    <span
                      key={h}
                      className="text-[10px] text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded"
                    >
                      #{h}
                    </span>
                  ))}
                  {post.hashtags.length > 2 && (
                    <span className="text-[10px] text-zinc-400">
                      +{post.hashtags.length - 2}
                    </span>
                  )}
                </div>
              )}
              {isVideoLike && (
                <button
                  onClick={() => setOpen(true)}
                  className="text-xs px-2.5 py-1 rounded bg-gradient-to-r from-violet-500 to-red-500 text-white font-medium hover:opacity-90 shrink-0"
                  title="Gemini로 영상 분석 (전사 + 어그로 제목 + 4씬 대본 + 검색 키워드)"
                >
                  🤖 분석
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {open && (
        <AnalyzeModal
          shortcode={post.shortcode}
          sourceUrl={post.url}
          thumbnailUrl={post.thumbnail_url}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ── 분석 모달 ──────────────────────────────────────────────────────────
function AnalyzeModal({
  shortcode,
  sourceUrl,
  thumbnailUrl,
  onClose,
}: {
  shortcode: string;
  sourceUrl: string;
  thumbnailUrl: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");

  // 1) 모달 열리면 캐시부터 조회
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/insta-tracker/analyze?shortcode=${encodeURIComponent(shortcode)}`,
        );
        const json = await res.json();
        if (cancelled) return;
        if (json.analysis) {
          setAnalysis(json.analysis as Analysis);
        }
      } catch {
        /* 캐시 없음 — 무시 */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shortcode]);

  async function runAnalysis(force = false) {
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/insta-tracker/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortcode, force }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "분석 실패");
        return;
      }
      setAnalysis(json.analysis as Analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "분석 실패");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3 p-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          {thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/proxy-asset?url=${encodeURIComponent(thumbnailUrl)}`}
              alt=""
              className="w-10 h-10 rounded object-cover shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold truncate">🤖 영상 Gemini 분석</h2>
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-zinc-500 hover:text-red-500 truncate block"
            >
              {sourceUrl}
            </a>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-xl px-2 shrink-0"
            title="닫기"
          >
            ×
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center py-10 text-zinc-400 text-sm">
              불러오는 중…
            </div>
          ) : !analysis ? (
            <div className="text-center py-10 space-y-4">
              <p className="text-sm text-zinc-500">
                아직 분석 안 된 영상이에요. Gemini로 분석해볼까요?
              </p>
              <p className="text-xs text-zinc-400">
                영상 다운로드 + Gemini 호출 — 보통 30초~2분 걸려요.
              </p>
              <button
                onClick={() => runAnalysis(false)}
                disabled={running}
                className="px-5 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-red-500 text-white font-medium hover:opacity-90 disabled:opacity-50"
              >
                {running ? "분석 중…" : "✨ 분석 시작"}
              </button>
              {error && (
                <p className="text-xs text-rose-500 mt-2">⚠️ {error}</p>
              )}
            </div>
          ) : (
            <>
              <AnalysisView a={analysis} />
              <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end gap-2">
                {error && (
                  <span className="text-xs text-rose-500 mr-auto">
                    ⚠️ {error}
                  </span>
                )}
                <button
                  onClick={() => runAnalysis(true)}
                  disabled={running}
                  className="text-xs px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 hover:border-red-300 dark:hover:border-red-700 disabled:opacity-50"
                >
                  {running ? "재분석 중…" : "🔄 재분석"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 프로필 관리 탭 ──────────────────────────────────────────────────────
function ProfilesTab() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/insta-tracker/profiles");
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || "조회 실패");
        } else {
          setProfiles(json.profiles || []);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "조회 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const reload = useCallback(() => {
    setLoading(true);
    setRefreshKey((k) => k + 1);
  }, []);

  async function handleAdd() {
    if (!bulkInput.trim()) return;
    setSubmitting(true);
    setSubmitMsg("");
    try {
      const res = await fetch("/api/insta-tracker/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: bulkInput }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitMsg(`⚠️ ${json.error || "등록 실패"}`);
        return;
      }
      setSubmitMsg(
        `✅ ${json.added}개 등록${json.skipped > 0 ? ` (${json.skipped}개 형식 오류 스킵)` : ""}`,
      );
      setBulkInput("");
      reload();
    } catch (e) {
      setSubmitMsg(`⚠️ ${e instanceof Error ? e.message : "등록 실패"}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(username: string, active: boolean) {
    await fetch("/api/insta-tracker/profiles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, active }),
    });
    reload();
  }

  async function remove(username: string) {
    if (!confirm(`@${username} 프로필을 삭제할까요? 관련 포스트도 같이 삭제돼요.`))
      return;
    await fetch(
      `/api/insta-tracker/profiles?username=${encodeURIComponent(username)}`,
      { method: "DELETE" },
    );
    reload();
  }

  const activeCount = useMemo(
    () => profiles.filter((p) => p.active).length,
    [profiles],
  );

  return (
    <div className="space-y-5">
      {/* 일괄 등록 */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
        <label className="block text-sm font-medium mb-2">
          프로필 일괄 등록
        </label>
        <p className="text-xs text-zinc-500 mb-3">
          URL, @handle, 또는 username 형식 모두 OK. 줄바꿈/쉼표/공백으로 구분.
          예: <code className="px-1 bg-zinc-100 dark:bg-zinc-800 rounded">https://www.instagram.com/cristiano/</code>{" "}
          또는 <code className="px-1 bg-zinc-100 dark:bg-zinc-800 rounded">@cristiano</code>{" "}
          또는 <code className="px-1 bg-zinc-100 dark:bg-zinc-800 rounded">cristiano</code>
        </p>
        <textarea
          value={bulkInput}
          onChange={(e) => setBulkInput(e.target.value)}
          rows={4}
          placeholder={`@brand1\nhttps://www.instagram.com/brand2/\nbrand3`}
          className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700"
        />
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={handleAdd}
            disabled={submitting || !bulkInput.trim()}
            className="text-sm px-4 py-2 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
          >
            {submitting ? "등록 중…" : "등록"}
          </button>
          {submitMsg && (
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {submitMsg}
            </span>
          )}
        </div>
      </div>

      {/* 목록 */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">
            등록된 프로필{" "}
            <span className="text-zinc-500 font-normal">
              ({activeCount} 활성 / {profiles.length} 전체)
            </span>
          </h3>
          <button
            onClick={reload}
            className="text-xs text-zinc-400 hover:text-red-500"
          >
            새로고침
          </button>
        </div>

        {error && (
          <div className="text-sm text-rose-600 dark:text-rose-400 mb-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-zinc-400 text-sm">
            불러오는 중…
          </div>
        ) : profiles.length === 0 ? (
          <div className="text-center py-8 text-zinc-400 text-sm">
            아직 등록된 프로필이 없어요. 위에서 등록해보세요.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {profiles.map((p) => (
              <div
                key={p.username}
                className="py-2.5 flex items-center gap-3"
              >
                <input
                  type="checkbox"
                  checked={p.active}
                  onChange={(e) => toggleActive(p.username, e.target.checked)}
                  className="accent-red-500"
                  title="체크 해제 시 매일 체크에서 제외"
                />
                <a
                  href={`https://www.instagram.com/${p.username}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:text-red-500 truncate"
                >
                  @{p.username}
                </a>
                <span className="text-xs text-zinc-400 ml-auto shrink-0">
                  {p.last_checked_at
                    ? `마지막: ${fmtRelTime(p.last_checked_at)}`
                    : "아직 체크 안 함"}
                </span>
                <button
                  onClick={() => remove(p.username)}
                  className="text-xs text-zinc-400 hover:text-rose-500 shrink-0"
                  title="삭제"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 내 분석 탭 ─────────────────────────────────────────────────────────
type AnalysisListItem = {
  shortcode: string;
  source_url: string;
  video_storage_path: string | null;
  video_expires_at: string | null;
  title: string | null;
  video_summary: string | null;
  product_keywords:
    | { keyword: string; translation?: string; note?: string }[]
    | null;
  model: string | null;
  analyzed_at: string;
};

function MyAnalysesTab() {
  const [items, setItems] = useState<AnalysisListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [openShortcode, setOpenShortcode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: "100" });
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/insta-tracker/analyses?${params}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || "조회 실패");
        } else {
          setItems(json.analyses || []);
          setTotal(json.total || 0);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "조회 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q ? 300 : 0); // 검색어 있을 때만 debounce
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, refreshKey]);

  async function handleDelete(shortcode: string) {
    if (!confirm("이 분석을 삭제할까요? 저장된 영상도 같이 삭제돼요.")) return;
    await fetch(
      `/api/insta-tracker/analyses?shortcode=${encodeURIComponent(shortcode)}`,
      { method: "DELETE" },
    );
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-4">
      {/* 검색 바 */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="제목/요약/URL 검색"
          className="flex-1 min-w-[200px] text-sm rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700"
        />
        <span className="text-xs text-zinc-500 shrink-0">
          {total > 0 ? `총 ${total}개` : ""}
        </span>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="text-sm px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 hover:border-red-300 dark:hover:border-red-700"
        >
          새로고침
        </button>
      </div>

      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-zinc-400 text-sm">
          불러오는 중…
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-zinc-400 text-sm">
          {q
            ? `"${q}" 와 일치하는 분석이 없어요.`
            : "아직 저장된 분석이 없어요. 새 피드 탭에서 영상을 분석해보세요."}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((a) => (
            <AnalysisListCard
              key={a.shortcode}
              a={a}
              onOpen={() => setOpenShortcode(a.shortcode)}
              onDelete={() => handleDelete(a.shortcode)}
            />
          ))}
        </div>
      )}

      {openShortcode && (
        <AnalysisDetailModal
          shortcode={openShortcode}
          onClose={() => setOpenShortcode(null)}
        />
      )}
    </div>
  );
}

function AnalysisListCard({
  a,
  onOpen,
  onDelete,
}: {
  a: AnalysisListItem;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const keywords = (a.product_keywords || []).slice(0, 4);
  const expired =
    a.video_expires_at && new Date(a.video_expires_at).getTime() <= Date.now();

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 hover:border-red-300 dark:hover:border-red-700 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <button
            onClick={onOpen}
            className="text-left w-full block"
          >
            {a.title && (
              <h3 className="text-base font-bold text-zinc-800 dark:text-zinc-100 line-clamp-1 hover:text-red-500">
                {a.title}
              </h3>
            )}
            {a.video_summary && (
              <p className="text-xs text-zinc-500 mt-1 line-clamp-2">
                {a.video_summary}
              </p>
            )}
          </button>

          {/* 키워드 미리보기 */}
          {keywords.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {keywords.map((k, i) => (
                <a
                  key={i}
                  href={`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(k.keyword)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 border border-rose-200 dark:border-rose-900"
                  title={k.translation ? `${k.translation}${k.note ? ` — ${k.note}` : ""}` : k.note}
                >
                  {k.keyword}
                  {k.translation && (
                    <span className="opacity-60"> ({k.translation})</span>
                  )}
                </a>
              ))}
              {(a.product_keywords?.length || 0) > 4 && (
                <span className="text-[11px] text-zinc-400">
                  +{(a.product_keywords?.length || 0) - 4}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 text-[11px] text-zinc-400 mt-2">
            <span>{fmtRelTime(a.analyzed_at)}</span>
            {a.model && <span>· {a.model}</span>}
            {a.video_storage_path ? (
              <span className="text-emerald-500">
                · 영상 저장됨{a.video_expires_at ? ` (만료 ${fmtRelTime(a.video_expires_at)})` : ""}
              </span>
            ) : expired ? (
              <span className="text-zinc-400">· 영상 만료됨</span>
            ) : null}
            <a
              href={a.source_url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto hover:text-red-500"
            >
              원본 ↗
            </a>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={onOpen}
            className="text-xs px-2.5 py-1 rounded bg-gradient-to-r from-violet-500 to-red-500 text-white font-medium hover:opacity-90"
          >
            펼치기
          </button>
          <button
            onClick={onDelete}
            className="text-[11px] text-zinc-400 hover:text-rose-500"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}

function AnalysisDetailModal({
  shortcode,
  onClose,
}: {
  shortcode: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/insta-tracker/analyze?shortcode=${encodeURIComponent(shortcode)}`,
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || "조회 실패");
        } else if (json.analysis) {
          setAnalysis(json.analysis as Analysis);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "조회 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shortcode]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h2 className="text-sm font-bold">🤖 분석 상세</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-xl px-2"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-center py-10 text-zinc-400 text-sm">
              불러오는 중…
            </div>
          ) : error ? (
            <div className="text-sm text-rose-500">⚠️ {error}</div>
          ) : analysis ? (
            <AnalysisView a={analysis} />
          ) : (
            <div className="text-center py-10 text-zinc-400 text-sm">
              분석 데이터가 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
