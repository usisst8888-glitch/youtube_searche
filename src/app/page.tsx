"use client";

import { useState, useEffect } from "react";
import { VIDEO_CATEGORIES_KR } from "@/lib/youtube";

const DEFAULT_EXCLUDE = [
  "뉴스",
  "news",
  "방송",
  "공식",
  "official",
  "KBS",
  "MBC",
  "SBS",
  "JTBC",
  "YTN",
  "MBN",
  "TV조선",
  "채널A",
  "연합",
  "일보",
  "신문",
  "CNN",
  "BBC",
  "NHK",
];

type Result = {
  channelId: string;
  channelName: string;
  title: string;
  views: number;
  channelMedian: number;
  outlierScore: number;
  durationSec: number;
  likes: number;
  comments: number;
  publishedAt: string;
  url: string;
  thumbnail: string;
  subscriberCount: number;
  subscriberHidden: boolean;
  tags?: string[];
};

type CacheStats = {
  hits: number;
  misses: number;
  totalChannelsCached: number;
};

type ApiResponse = {
  total: number;
  outlierCount: number;
  threshold: number;
  results: Result[];
  message?: string;
  error?: string;
  cacheStats?: CacheStats;
};

const DEFAULT_REGION = process.env.NEXT_PUBLIC_DEFAULT_REGION || "KR";
const DEFAULT_LANGUAGE = process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "ko";

export default function Home() {
  const [keyword, setKeyword] = useState("");
  const [searchMax, setSearchMax] = useState(100);
  const [threshold, setThreshold] = useState(3);
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [publishedWithinDays, setPublishedWithinDays] = useState(7);
  const [videoCategoryId, setVideoCategoryId] = useState("");
  const [maxSubscribers, setMaxSubscribers] = useState(0);
  const [excludeKeywordsText, setExcludeKeywordsText] = useState(
    DEFAULT_EXCLUDE.join(", "),
  );
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [summary, setSummary] = useState<{
    total: number;
    outlierCount: number;
    cacheStats?: CacheStats;
  } | null>(null);
  const [error, setError] = useState("");
  const [onlyOutliers, setOnlyOutliers] = useState(false);
  const [sortBy, setSortBy] = useState<"outlier" | "views" | "recent">(
    "outlier",
  );
  // 영상 선택 + AI 분석
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analysis, setAnalysis] = useState<{
    analyzedCount: number;
    skippedCount: number;
    videos: {
      url: string;
      title?: string;
      transcript: string | null;
      transcriptError?: string;
    }[];
    analysis: {
      overall: {
        commonHookPattern: string;
        avgStructure: string;
        viralFormula: string;
        toneStyle: string;
        hookKeywords: string[];
      };
      perVideo: {
        url: string;
        openingHook: string;
        structure: string;
        retentionTactics: string[];
        ending: string;
        whyItHit: string;
      }[];
    };
  } | null>(null);
  const [analyzeError, setAnalyzeError] = useState("");

  // 연관 키워드 추출
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [relatedKeywords, setRelatedKeywords] = useState<string[]>([]);
  const [topTags, setTopTags] = useState<{ tag: string; count: number }[]>(
    [],
  );
  const [keywordsError, setKeywordsError] = useState("");

  // 키워드 메이커
  const [kmOpen, setKmOpen] = useState(false);
  const [kmLoading, setKmLoading] = useState(false);
  const [kmError, setKmError] = useState("");
  const [kmData, setKmData] = useState<{
    keyword: string;
    topTitleKeywords: string[];
    topTags: { tag: string; count: number }[];
    relatedKeywords: string[];
    searchedCount: number;
  } | null>(null);

  // 채널 즐겨찾기 그룹
  type FavGroup = {
    id: string;
    name: string;
    channels: { id: string; name: string }[];
  };
  const [groups, setGroups] = useState<FavGroup[]>([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [openStarFor, setOpenStarFor] = useState<string | null>(null); // channelId
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [favFilterGroupId, setFavFilterGroupId] = useState<string>("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("yt_fav_groups");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setGroups(parsed);
      }
    } catch {}
    setGroupsLoaded(true);
  }, []);

  useEffect(() => {
    if (!groupsLoaded) return;
    try {
      localStorage.setItem("yt_fav_groups", JSON.stringify(groups));
    } catch {}
  }, [groups, groupsLoaded]);

  useEffect(() => {
    if (!openStarFor) return;
    const onClick = () => setOpenStarFor(null);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [openStarFor]);

  const createGroup = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (groups.some((g) => g.name === trimmed)) return;
    setGroups((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: trimmed,
        channels: [],
      },
    ]);
  };

  const renameGroup = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, name: trimmed } : g)),
    );
  };

  const deleteGroup = (id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
    if (favFilterGroupId === id) setFavFilterGroupId("");
  };

  const toggleChannelInGroup = (
    groupId: string,
    channel: { id: string; name: string },
  ) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const has = g.channels.some((c) => c.id === channel.id);
        return {
          ...g,
          channels: has
            ? g.channels.filter((c) => c.id !== channel.id)
            : [...g.channels, channel],
        };
      }),
    );
  };

  const removeChannelFromGroup = (groupId: string, channelId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, channels: g.channels.filter((c) => c.id !== channelId) }
          : g,
      ),
    );
  };

  const isChannelFavorited = (channelId: string): boolean =>
    groups.some((g) => g.channels.some((c) => c.id === channelId));

  const groupsForChannel = (channelId: string): FavGroup[] =>
    groups.filter((g) => g.channels.some((c) => c.id === channelId));

  const runKeywordMaker = async () => {
    const kw = keyword.trim();
    if (!kw) {
      setKmError("키워드를 먼저 입력하세요.");
      setKmOpen(true);
      return;
    }
    setKmError("");
    setKmOpen(true);
    setKmLoading(true);
    setKmData(null);
    try {
      const res = await fetch("/api/keyword-maker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: kw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "키워드 메이커 실패");
      setKmData(data);
    } catch (e) {
      setKmError(e instanceof Error ? e.message : "오류");
    } finally {
      setKmLoading(false);
    }
  };

  const extractKeywords = async () => {
    if (results.length === 0) return;
    setKeywordsError("");
    setKeywordsLoading(true);
    try {
      const res = await fetch("/api/extract-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseKeyword: keyword,
          titles: results.map((r) => r.title),
          tags: results.map((r) => r.tags || []),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "키워드 추출 실패");
      setRelatedKeywords(data.relatedKeywords || []);
      setTopTags(data.topTags || []);
    } catch (e) {
      setKeywordsError(e instanceof Error ? e.message : "오류");
    } finally {
      setKeywordsLoading(false);
    }
  };

  const searchWithKeyword = (kw: string) => {
    setKeyword(kw);
    handleSearch(kw);
  };

  const toggleSelected = (url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const handleAnalyzeShorts = async () => {
    if (selectedUrls.size === 0) {
      setAnalyzeError("영상을 1개 이상 선택해주세요.");
      return;
    }
    if (selectedUrls.size > 15) {
      setAnalyzeError("한 번에 최대 15개까지 분석 가능합니다.");
      return;
    }
    setAnalyzeError("");
    setAnalyzeLoading(true);
    setAnalysis(null);
    try {
      const selectedVideos = results
        .filter((r) => selectedUrls.has(r.url))
        .map((r) => ({
          url: r.url,
          title: r.title,
          views: r.views,
          channel: r.channelName,
          outlierScore: r.outlierScore,
        }));
      const res = await fetch("/api/analyze-shorts-pattern", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videos: selectedVideos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "분석 실패");
      if (!data.analysis) {
        setAnalyzeError(data.error || "분석할 자막이 없습니다.");
        setAnalysis({ ...data, analysis: null } as never);
        return;
      }
      setAnalysis(data);
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : "오류");
    } finally {
      setAnalyzeLoading(false);
    }
  };

  useEffect(() => {
    const savedKeyword = localStorage.getItem("yt_last_keyword");
    if (savedKeyword) setKeyword(savedKeyword);
    const savedExcludes = localStorage.getItem("yt_exclude_keywords");
    if (savedExcludes) setExcludeKeywordsText(savedExcludes);
  }, []);

  const handleSearch = async (overrideKeyword?: string) => {
    setError("");
    setResults([]);
    setSummary(null);
    setRelatedKeywords([]);
    setTopTags([]);

    const kwToUse =
      typeof overrideKeyword === "string" ? overrideKeyword : keyword;

    if (!kwToUse.trim() && !videoCategoryId) {
      setError("키워드 또는 카테고리 중 하나는 선택하세요.");
      return;
    }
    localStorage.setItem("yt_last_keyword", kwToUse);
    localStorage.setItem("yt_exclude_keywords", excludeKeywordsText);

    const excludeKeywords = excludeKeywordsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword,
          searchMax,
          outlierThreshold: threshold,
          region,
          language,
          publishedWithinDays,
          excludeKeywords,
          videoCategoryId,
          maxSubscribers,
        }),
      });
      const data: ApiResponse = await res.json();
      if (!res.ok) throw new Error(data.error || `오류 (${res.status})`);
      setResults(data.results);
      setSummary({
        total: data.total,
        outlierCount: data.outlierCount,
        cacheStats: data.cacheStats,
      });
      if (data.results.length === 0 && data.message) {
        setError(data.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 실패");
    } finally {
      setLoading(false);
    }
  };

  const visibleResults = (() => {
    let filtered = onlyOutliers
      ? results.filter((r) => r.outlierScore >= threshold && r.views >= 10000)
      : results;
    if (onlyFavorites) {
      const allowedIds = favFilterGroupId
        ? new Set(
            (groups.find((g) => g.id === favFilterGroupId)?.channels || []).map(
              (c) => c.id,
            ),
          )
        : new Set(groups.flatMap((g) => g.channels.map((c) => c.id)));
      filtered = filtered.filter((r) => allowedIds.has(r.channelId));
    }
    const sorted = [...filtered];
    if (sortBy === "views") {
      sorted.sort((a, b) => b.views - a.views);
    } else if (sortBy === "recent") {
      sorted.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    } else {
      // outlier (default)
      sorted.sort((a, b) => b.outlierScore - a.outlierScore);
    }
    return sorted;
  })();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <span>🔥</span>
            YouTube 쇼츠 아웃라이어 탐색기
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            채널의 평균 쇼츠 조회수 대비 몇 배 떴는지로 떡상 쇼츠를 찾아냅니다.
          </p>
        </header>

        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">
                검색 키워드
                <span className="ml-2 text-xs text-zinc-500">
                  (카테고리만 선택해도 검색 가능)
                </span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !loading) handleSearch();
                  }}
                  className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="예: 로지텍 마우스 (생략 가능)"
                />
                <button
                  type="button"
                  onClick={runKeywordMaker}
                  disabled={kmLoading}
                  className="shrink-0 bg-amber-500 hover:bg-amber-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white font-semibold px-4 py-2 rounded-lg whitespace-nowrap"
                  title="이 키워드의 제목 핵심어 / 영상 태그 / 연관 키워드를 한 번에 분석"
                >
                  {kmLoading ? "🔑 분석 중..." : "🔑 키워드 메이커"}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">카테고리</label>
              <select
                value={videoCategoryId}
                onChange={(e) => setVideoCategoryId(e.target.value)}
                className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
              >
                {VIDEO_CATEGORIES_KR.map((c) => (
                  <option key={c.id || "all"} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                구독자 상한
                <span className="ml-2 text-xs text-zinc-500">
                  (0 = 제한 없음)
                </span>
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={maxSubscribers}
                  onChange={(e) =>
                    setMaxSubscribers(parseInt(e.target.value, 10) || 0)
                  }
                  className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
                  placeholder="예: 10000"
                />
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {[0, 1000, 10000, 100000, 1000000].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMaxSubscribers(n)}
                    className={`text-xs px-2 py-0.5 rounded ${
                      maxSubscribers === n
                        ? "bg-red-500 text-white"
                        : "bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                    }`}
                  >
                    {n === 0 ? "무제한" : `${n.toLocaleString()} 이하`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                검색 결과 수:{" "}
                <span className="font-bold text-red-500">{searchMax}</span>
              </label>
              <input
                type="range"
                min={10}
                max={100}
                step={10}
                value={searchMax}
                onChange={(e) => setSearchMax(parseInt(e.target.value, 10))}
                className="w-full accent-red-500"
              />
              <div className="mt-1 flex flex-wrap gap-1">
                {[25, 50, 75, 100].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setSearchMax(n)}
                    className={`text-xs px-2 py-0.5 rounded ${
                      searchMax === n
                        ? "bg-red-500 text-white"
                        : "bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                아웃라이어 임계값:{" "}
                <span className="font-bold text-red-500">{threshold}배</span>
              </label>
              <input
                type="range"
                min={1}
                max={20}
                step={0.5}
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                className="w-full accent-red-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">
                제외할 채널 키워드
                <span className="ml-2 text-xs text-zinc-500">
                  (쉼표로 구분, 채널명에 포함되면 제외)
                </span>
              </label>
              <textarea
                value={excludeKeywordsText}
                onChange={(e) => setExcludeKeywordsText(e.target.value)}
                rows={2}
                className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="뉴스, news, 방송, 공식, ..."
              />
              <button
                type="button"
                onClick={() =>
                  setExcludeKeywordsText(DEFAULT_EXCLUDE.join(", "))
                }
                className="mt-1 text-xs text-blue-500 hover:underline"
              >
                기본값으로 되돌리기
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">업로드 기간</label>
              <select
                value={publishedWithinDays}
                onChange={(e) =>
                  setPublishedWithinDays(parseInt(e.target.value, 10))
                }
                className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
              >
                <option value={7}>최근 1주일</option>
                <option value={30}>최근 1개월</option>
                <option value={90}>최근 3개월</option>
                <option value={180}>최근 6개월</option>
                <option value={365}>최근 1년</option>
                <option value={0}>전체 기간</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">지역</label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
              >
                <option value="KR">🇰🇷 한국</option>
                <option value="US">🇺🇸 미국</option>
                <option value="JP">🇯🇵 일본</option>
                <option value="VN">🇻🇳 베트남</option>
                <option value="TH">🇹🇭 태국</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">언어</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
              >
                <option value="ko">한국어</option>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="vi">Tiếng Việt</option>
                <option value="th">ภาษาไทย</option>
              </select>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => handleSearch()}
              disabled={loading}
              className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors flex items-center gap-2"
            >
              {loading ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  분석 중...
                </>
              ) : (
                <>🔍 떡상 쇼츠 찾기</>
              )}
            </button>
            {loading && (
              <span className="text-sm text-zinc-500">
                YouTube API 호출 중, 10~30초 소요
              </span>
            )}
          </div>

          <p className="mt-3 text-xs text-zinc-500">
            API 키는 서버 환경변수(<code className="font-mono">YOUTUBE_API_KEY</code>)에서 읽어옵니다. 키 발급:{" "}
            <a
              href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
              target="_blank"
              rel="noreferrer"
              className="text-blue-500 hover:underline"
            >
              Google Cloud Console
            </a>
          </p>
        </section>

        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200 px-4 py-3 rounded-lg mb-6">
            ⚠️ {error}
          </div>
        )}

        {summary && (
          <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <div className="text-lg">
                  총{" "}
                  <span className="font-bold text-2xl">{summary.total}</span>개 쇼츠 중{" "}
                  <span className="font-bold text-2xl text-red-500">
                    🔥 {summary.outlierCount}
                  </span>
                  개 떡상 ({threshold}배 이상 · 조회수 1만+)
                </div>
                {summary.cacheStats && (
                  <div className="text-xs text-zinc-500 mt-1">
                    캐시 히트 {summary.cacheStats.hits} / 미스 {summary.cacheStats.misses}
                    {summary.cacheStats.hits + summary.cacheStats.misses > 0 && (
                      <>
                        {" "}
                        ({Math.round(
                          (summary.cacheStats.hits /
                            (summary.cacheStats.hits +
                              summary.cacheStats.misses)) *
                            100,
                        )}
                        % 히트)
                      </>
                    )}
                    · 전체 캐시 {summary.cacheStats.totalChannelsCached}개 채널
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm">
                  <span className="text-zinc-500">정렬:</span>
                  <select
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(
                        e.target.value as "outlier" | "views" | "recent",
                      )
                    }
                    className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded px-2 py-1 text-sm"
                  >
                    <option value="outlier">🔥 떡상순 (배율)</option>
                    <option value="views">👁 조회수순</option>
                    <option value="recent">🕐 최신순</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyOutliers}
                    onChange={(e) => setOnlyOutliers(e.target.checked)}
                    className="accent-red-500"
                  />
                  떡상만 보기
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyFavorites}
                    onChange={(e) => setOnlyFavorites(e.target.checked)}
                    className="accent-amber-500"
                  />
                  ⭐ 즐겨찾기만
                </label>
                {onlyFavorites && groups.length > 0 && (
                  <select
                    value={favFilterGroupId}
                    onChange={(e) => setFavFilterGroupId(e.target.value)}
                    className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded px-2 py-1 text-sm"
                  >
                    <option value="">전체 그룹</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.channels.length})
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => setGroupModalOpen(true)}
                  className="text-sm bg-amber-500 hover:bg-amber-600 text-white font-semibold px-3 py-1 rounded"
                  title="채널 그룹 관리"
                >
                  📁 그룹 관리
                </button>
              </div>
            </div>

            {/* 연관 키워드 + 태그 추출 */}
            {results.length > 0 && (
              <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-lg">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <div className="text-sm">
                    <span className="font-semibold text-amber-700 dark:text-amber-300">
                      🔑 연관 키워드 + 태그
                    </span>
                    <span className="ml-2 text-xs text-zinc-600 dark:text-zinc-400">
                      현재 검색 결과의 제목/태그를 분석해서 추가 검색해볼만한
                      키워드를 뽑습니다
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={extractKeywords}
                    disabled={keywordsLoading}
                    className="bg-amber-600 hover:bg-amber-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg"
                  >
                    {keywordsLoading
                      ? "🔑 추출 중..."
                      : relatedKeywords.length > 0
                        ? "🔄 다시 추출"
                        : "🔑 키워드 추출"}
                  </button>
                </div>
                {keywordsError && (
                  <p className="text-xs text-red-600 dark:text-red-400 mb-2">
                    ⚠️ {keywordsError}
                  </p>
                )}
                {relatedKeywords.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 mb-1">
                      💡 AI 추천 연관 키워드 ({relatedKeywords.length}개) — 클릭하면
                      바로 검색
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {relatedKeywords.map((kw) => (
                        <button
                          key={kw}
                          type="button"
                          onClick={() => searchWithKeyword(kw)}
                          className="text-xs bg-white dark:bg-zinc-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-300 dark:border-amber-800 px-2 py-1 rounded-full"
                        >
                          {kw}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {topTags.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 mb-1">
                      🏷 영상 태그 빈도순 ({topTags.length}개) — 실제 떡상 영상이
                      쓴 태그
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {topTags.map((t) => (
                        <button
                          key={t.tag}
                          type="button"
                          onClick={() => searchWithKeyword(t.tag)}
                          className="text-xs bg-white dark:bg-zinc-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-zinc-300 dark:border-zinc-700 px-2 py-1 rounded-full inline-flex items-center gap-1"
                        >
                          <span>#{t.tag}</span>
                          <span className="text-[9px] text-zinc-400">
                            ×{t.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* AI 분석 액션 바 */}
            {visibleResults.length > 0 && (
              <div className="mb-3 flex items-center justify-between gap-2 flex-wrap p-3 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 rounded-lg">
                <div className="text-sm">
                  <span className="font-semibold text-purple-700 dark:text-purple-300">
                    🧠 떡상 패턴 분석
                  </span>
                  <span className="ml-2 text-xs text-zinc-600 dark:text-zinc-400">
                    영상을 선택하고 분석하면 AI가 자막을 뽑아서 공통 후크 / 구조
                    / 떡상 공식을 추출합니다 (선택 {selectedUrls.size}개, 최대
                    15개)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {selectedUrls.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedUrls(new Set())}
                      className="text-xs text-zinc-500 hover:underline"
                    >
                      선택 해제
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleAnalyzeShorts}
                    disabled={analyzeLoading || selectedUrls.size === 0}
                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white text-sm font-semibold px-4 py-2 rounded-lg"
                  >
                    {analyzeLoading
                      ? "🧠 분석 중... (30~90초)"
                      : `🧠 선택한 ${selectedUrls.size}개 영상 분석`}
                  </button>
                </div>
              </div>
            )}
            {analyzeError && (
              <div className="mb-3 p-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded">
                ⚠️ {analyzeError}
              </div>
            )}

            {/* AI 분석 결과 */}
            {analysis && analysis.analysis && (
              <div className="mb-4 p-4 bg-white dark:bg-zinc-900 border border-purple-300 dark:border-purple-900/50 rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-purple-700 dark:text-purple-300">
                    🧠 떡상 패턴 분석 결과 (자막 {analysis.analyzedCount}개
                    분석{analysis.skippedCount > 0
                      ? `, ${analysis.skippedCount}개 자막 없어 제외`
                      : ""})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setAnalysis(null)}
                    className="text-xs text-zinc-500 hover:underline"
                  >
                    닫기
                  </button>
                </div>

                {/* Overall */}
                <div className="space-y-2 text-sm mb-4 bg-purple-50 dark:bg-purple-950/20 rounded-lg p-3">
                  <div>
                    <span className="font-semibold text-purple-700 dark:text-purple-300">
                      🎯 떡상 공식:
                    </span>{" "}
                    {analysis.analysis.overall.viralFormula}
                  </div>
                  <div>
                    <span className="font-semibold text-purple-700 dark:text-purple-300">
                      🪝 공통 후크 패턴:
                    </span>{" "}
                    {analysis.analysis.overall.commonHookPattern}
                  </div>
                  <div>
                    <span className="font-semibold text-purple-700 dark:text-purple-300">
                      🏗 평균 구조:
                    </span>{" "}
                    {analysis.analysis.overall.avgStructure}
                  </div>
                  <div>
                    <span className="font-semibold text-purple-700 dark:text-purple-300">
                      🗣 톤/말투:
                    </span>{" "}
                    {analysis.analysis.overall.toneStyle}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-semibold text-purple-700 dark:text-purple-300">
                      🔥 후크 키워드:
                    </span>
                    {analysis.analysis.overall.hookKeywords.map((k, i) => (
                      <code
                        key={i}
                        className="px-1.5 py-0.5 bg-white dark:bg-zinc-800 rounded text-xs"
                      >
                        {k}
                      </code>
                    ))}
                  </div>
                </div>

                {/* Per video */}
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                    📋 영상별 상세 분석 ({analysis.analysis.perVideo.length}개)
                  </summary>
                  <div className="space-y-3 mt-2">
                    {analysis.analysis.perVideo.map((pv, i) => (
                      <div
                        key={i}
                        className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3"
                      >
                        <a
                          href={pv.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-500 hover:underline text-xs break-all"
                        >
                          {pv.url}
                        </a>
                        <div className="mt-1 space-y-1">
                          <div>
                            <b>오프닝 후크:</b> {pv.openingHook}
                          </div>
                          <div>
                            <b>구조:</b> {pv.structure}
                          </div>
                          <div>
                            <b>리텐션 전술:</b>{" "}
                            {pv.retentionTactics.join(" · ")}
                          </div>
                          <div>
                            <b>마무리:</b> {pv.ending}
                          </div>
                          <div>
                            <b>왜 떡상?</b> {pv.whyItHit}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}

            {visibleResults.length === 0 ? (
              <p className="text-zinc-500 py-8 text-center">
                표시할 결과가 없습니다.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">
                      <th className="text-center p-3 font-medium w-8">
                        <input
                          type="checkbox"
                          title="전체 선택/해제"
                          checked={
                            visibleResults.length > 0 &&
                            visibleResults.every((r) =>
                              selectedUrls.has(r.url),
                            )
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedUrls(
                                new Set(visibleResults.map((r) => r.url)),
                              );
                            } else {
                              setSelectedUrls(new Set());
                            }
                          }}
                          className="accent-red-500"
                        />
                      </th>
                      <th className="text-left p-3 font-medium">#</th>
                      <th className="text-left p-3 font-medium">스코어</th>
                      <th className="text-left p-3 font-medium">쇼츠</th>
                      <th className="text-left p-3 font-medium">채널</th>
                      <th className="text-right p-3 font-medium">구독자</th>
                      <th className="text-right p-3 font-medium">조회수</th>
                      <th className="text-right p-3 font-medium">채널 중앙값</th>
                      <th className="text-right p-3 font-medium">길이</th>
                      <th className="text-right p-3 font-medium">업로드</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResults.map((r, i) => {
                      const isOut =
                        r.outlierScore >= threshold && r.views >= 10000;
                      return (
                        <tr
                          key={`${r.url}-${i}`}
                          className={`border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
                            isOut ? "bg-red-50/60 dark:bg-red-950/20" : ""
                          }`}
                        >
                          <td className="p-3 text-center">
                            <input
                              type="checkbox"
                              checked={selectedUrls.has(r.url)}
                              onChange={() => toggleSelected(r.url)}
                              className="accent-red-500"
                            />
                          </td>
                          <td className="p-3 text-zinc-500">{i + 1}</td>
                          <td className="p-3">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full font-bold ${
                                isOut
                                  ? "bg-red-500 text-white"
                                  : "bg-zinc-200 dark:bg-zinc-700"
                              }`}
                            >
                              {r.outlierScore.toFixed(1)}x
                            </span>
                          </td>
                          <td className="p-3 max-w-md">
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-start gap-3 hover:underline"
                            >
                              {r.thumbnail && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={r.thumbnail}
                                  alt=""
                                  className="w-20 h-12 object-cover rounded shrink-0"
                                />
                              )}
                              <span className="line-clamp-2">{r.title}</span>
                            </a>
                          </td>
                          <td className="p-3 text-zinc-600 dark:text-zinc-400">
                            <div className="relative inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenStarFor((cur) =>
                                    cur === r.channelId ? null : r.channelId,
                                  )
                                }
                                className="text-base leading-none hover:scale-110 transition-transform"
                                title={
                                  isChannelFavorited(r.channelId)
                                    ? `즐겨찾기됨 (${groupsForChannel(
                                        r.channelId,
                                      )
                                        .map((g) => g.name)
                                        .join(", ")})`
                                    : "그룹에 추가"
                                }
                              >
                                {isChannelFavorited(r.channelId) ? "⭐" : "☆"}
                              </button>
                              <a
                                href={`https://www.youtube.com/channel/${r.channelId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:underline"
                              >
                                {r.channelName}
                              </a>
                              {openStarFor === r.channelId && (
                                <div
                                  className="absolute z-30 left-0 top-7 w-64 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl p-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                      그룹 선택
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setOpenStarFor(null)}
                                      className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-sm"
                                    >
                                      ×
                                    </button>
                                  </div>
                                  {groups.length === 0 ? (
                                    <p className="text-[11px] text-zinc-500 mb-2">
                                      그룹이 없습니다. 아래에서 만드세요.
                                    </p>
                                  ) : (
                                    <div className="max-h-40 overflow-y-auto mb-2">
                                      {groups.map((g) => {
                                        const checked = g.channels.some(
                                          (c) => c.id === r.channelId,
                                        );
                                        return (
                                          <label
                                            key={g.id}
                                            className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer text-xs"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() =>
                                                toggleChannelInGroup(g.id, {
                                                  id: r.channelId,
                                                  name: r.channelName,
                                                })
                                              }
                                              className="accent-amber-500"
                                            />
                                            <span className="flex-1 truncate">
                                              {g.name}
                                            </span>
                                            <span className="text-[10px] text-zinc-400">
                                              {g.channels.length}
                                            </span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  )}
                                  <form
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      const fd = new FormData(
                                        e.currentTarget,
                                      );
                                      const name = String(fd.get("name") || "");
                                      if (!name.trim()) return;
                                      const trimmed = name.trim();
                                      if (
                                        !groups.some((g) => g.name === trimmed)
                                      ) {
                                        const newGroup: FavGroup = {
                                          id: `${Date.now()}-${Math.random()
                                            .toString(36)
                                            .slice(2, 7)}`,
                                          name: trimmed,
                                          channels: [
                                            {
                                              id: r.channelId,
                                              name: r.channelName,
                                            },
                                          ],
                                        };
                                        setGroups((prev) => [...prev, newGroup]);
                                      }
                                      e.currentTarget.reset();
                                    }}
                                    className="flex gap-1"
                                  >
                                    <input
                                      name="name"
                                      type="text"
                                      placeholder="새 그룹 이름"
                                      className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded px-2 py-1 text-xs"
                                    />
                                    <button
                                      type="submit"
                                      className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-2 rounded"
                                    >
                                      +
                                    </button>
                                  </form>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-right text-zinc-500 whitespace-nowrap">
                            {r.subscriberHidden
                              ? "비공개"
                              : r.subscriberCount.toLocaleString()}
                          </td>
                          <td className="p-3 text-right font-medium">
                            {r.views.toLocaleString()}
                          </td>
                          <td className="p-3 text-right text-zinc-500">
                            {r.channelMedian.toLocaleString()}
                          </td>
                          <td className="p-3 text-right text-zinc-500 whitespace-nowrap tabular-nums">
                            {Math.floor(r.durationSec / 60)}:
                            {String(r.durationSec % 60).padStart(2, "0")}
                          </td>
                          <td className="p-3 text-right text-zinc-500 whitespace-nowrap">
                            {r.publishedAt}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <footer className="mt-8 text-center text-xs text-zinc-500">
          <p>
            채널별 최근 쇼츠들의 조회수 중앙값을 기준으로 떡상 여부를 판정합니다.
            베이스라인 최소 쇼츠 5개, 쇼츠 최대 길이 180초.
          </p>
        </footer>
      </div>

      {groupModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setGroupModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-2xl my-8 p-6"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-bold text-amber-600 dark:text-amber-400">
                  📁 채널 그룹 관리
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  자주 보는 채널을 그룹으로 묶어서 즐겨찾기하세요. 결과 목록의
                  ⭐로 추가/제거할 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGroupModalOpen(false)}
                className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 text-2xl leading-none"
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newGroupName.trim()) return;
                createGroup(newGroupName);
                setNewGroupName("");
              }}
              className="flex gap-2 mb-4"
            >
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="새 그룹 이름 (예: 즐겨보는 IT 채널)"
                className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={!newGroupName.trim()}
                className="bg-amber-500 hover:bg-amber-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white text-sm font-semibold px-4 rounded-lg"
              >
                + 그룹 추가
              </button>
            </form>

            {groups.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">
                아직 그룹이 없습니다. 위에서 만들어보세요.
              </p>
            ) : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <div
                    key={g.id}
                    className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <input
                        type="text"
                        defaultValue={g.name}
                        onBlur={(e) => {
                          if (e.target.value.trim() !== g.name) {
                            renameGroup(g.id, e.target.value);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        className="flex-1 font-semibold text-sm bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-700 focus:border-amber-500 focus:outline-none px-1"
                      />
                      <span className="text-xs text-zinc-500">
                        {g.channels.length}개 채널
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            confirm(
                              `"${g.name}" 그룹을 삭제할까요? (포함된 채널 정보도 함께 삭제됩니다)`,
                            )
                          ) {
                            deleteGroup(g.id);
                          }
                        }}
                        className="text-xs text-red-500 hover:underline"
                      >
                        삭제
                      </button>
                    </div>
                    {g.channels.length === 0 ? (
                      <p className="text-xs text-zinc-500 px-1">
                        아직 채널이 없습니다.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {g.channels.map((c) => (
                          <span
                            key={c.id}
                            className="inline-flex items-center gap-1 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-full pl-2 pr-1 py-0.5"
                          >
                            <a
                              href={`https://www.youtube.com/channel/${c.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline"
                            >
                              {c.name}
                            </a>
                            <button
                              type="button"
                              onClick={() =>
                                removeChannelFromGroup(g.id, c.id)
                              }
                              className="text-zinc-400 hover:text-red-500 text-sm leading-none px-0.5"
                              title="이 그룹에서 제거"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {kmOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setKmOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-3xl my-8 p-6"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-bold text-amber-600 dark:text-amber-400 flex items-center gap-2">
                  🔑 키워드 메이커
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  {kmData
                    ? `"${kmData.keyword}" 기준 — 최근 30일 쇼츠 ${kmData.searchedCount}개 분석`
                    : keyword
                      ? `"${keyword}" 기준`
                      : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setKmOpen(false)}
                className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 text-2xl leading-none"
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            {kmError && (
              <div className="mb-3 p-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded">
                ⚠️ {kmError}
              </div>
            )}

            {kmLoading && (
              <div className="py-12 text-center text-sm text-zinc-500">
                <span className="inline-block w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
                YouTube 검색 + AI 분석 중... (10~30초)
              </div>
            )}

            {kmData && !kmLoading && (
              <div className="space-y-5">
                {/* 1) 제목 핵심 키워드 TOP 10 */}
                <div>
                  <h3 className="text-sm font-bold text-amber-700 dark:text-amber-300 mb-2">
                    📌 제목 핵심 키워드 TOP 10
                  </h3>
                  {kmData.topTitleKeywords.length === 0 ? (
                    <p className="text-xs text-zinc-500">결과 없음</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {kmData.topTitleKeywords.map((kw, i) => (
                        <button
                          key={kw}
                          type="button"
                          onClick={() => {
                            setKmOpen(false);
                            searchWithKeyword(kw);
                          }}
                          className="text-sm bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-300 dark:border-amber-800 px-2.5 py-1 rounded-full inline-flex items-center gap-1.5"
                        >
                          <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                            {i + 1}
                          </span>
                          <span>{kw}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2) 영상 내 태그 순위 */}
                <div>
                  <h3 className="text-sm font-bold text-amber-700 dark:text-amber-300 mb-2">
                    🏷 영상 내 태그 순위 ({kmData.topTags.length}개)
                  </h3>
                  {kmData.topTags.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      태그가 등록된 영상이 없습니다.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {kmData.topTags.map((t, i) => (
                        <button
                          key={t.tag}
                          type="button"
                          onClick={() => {
                            setKmOpen(false);
                            searchWithKeyword(t.tag);
                          }}
                          className="text-xs bg-white dark:bg-zinc-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-zinc-300 dark:border-zinc-700 px-2 py-1 rounded-full inline-flex items-center gap-1"
                        >
                          <span className="text-[9px] font-bold text-zinc-400">
                            {i + 1}
                          </span>
                          <span>#{t.tag}</span>
                          <span className="text-[9px] text-zinc-400">
                            ×{t.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3) 연관 태그 */}
                <div>
                  <h3 className="text-sm font-bold text-amber-700 dark:text-amber-300 mb-2">
                    💡 연관 태그 ({kmData.relatedKeywords.length}개)
                  </h3>
                  {kmData.relatedKeywords.length === 0 ? (
                    <p className="text-xs text-zinc-500">결과 없음</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {kmData.relatedKeywords.map((kw) => (
                        <button
                          key={kw}
                          type="button"
                          onClick={() => {
                            setKmOpen(false);
                            searchWithKeyword(kw);
                          }}
                          className="text-xs bg-white dark:bg-zinc-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-300 dark:border-amber-800 px-2 py-1 rounded-full"
                        >
                          {kw}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <p className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                  키워드/태그를 클릭하면 해당 키워드로 바로 검색합니다.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
