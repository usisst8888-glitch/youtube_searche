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
  const [searchMax, setSearchMax] = useState(50);
  const [threshold, setThreshold] = useState(3);
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [publishedWithinDays, setPublishedWithinDays] = useState(90);
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

  useEffect(() => {
    const savedKeyword = localStorage.getItem("yt_last_keyword");
    if (savedKeyword) setKeyword(savedKeyword);
    const savedExcludes = localStorage.getItem("yt_exclude_keywords");
    if (savedExcludes) setExcludeKeywordsText(savedExcludes);
  }, []);

  const handleSearch = async () => {
    setError("");
    setResults([]);
    setSummary(null);

    if (!keyword.trim() && !videoCategoryId) {
      setError("키워드 또는 카테고리 중 하나는 선택하세요.");
      return;
    }
    localStorage.setItem("yt_last_keyword", keyword);
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

  const visibleResults = onlyOutliers
    ? results.filter((r) => r.outlierScore >= threshold)
    : results;

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
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !loading) handleSearch();
                }}
                className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="예: 로지텍 마우스 (생략 가능)"
              />
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
              onClick={handleSearch}
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
                  개 떡상 ({threshold}배 이상)
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
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyOutliers}
                  onChange={(e) => setOnlyOutliers(e.target.checked)}
                  className="accent-red-500"
                />
                떡상만 보기
              </label>
            </div>

            {visibleResults.length === 0 ? (
              <p className="text-zinc-500 py-8 text-center">
                표시할 결과가 없습니다.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400">
                      <th className="text-left p-3 font-medium">#</th>
                      <th className="text-left p-3 font-medium">스코어</th>
                      <th className="text-left p-3 font-medium">쇼츠</th>
                      <th className="text-left p-3 font-medium">채널</th>
                      <th className="text-right p-3 font-medium">구독자</th>
                      <th className="text-right p-3 font-medium">조회수</th>
                      <th className="text-right p-3 font-medium">채널 중앙값</th>
                      <th className="text-right p-3 font-medium">업로드</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResults.map((r, i) => {
                      const isOut = r.outlierScore >= threshold;
                      return (
                        <tr
                          key={r.url}
                          className={`border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
                            isOut ? "bg-red-50/60 dark:bg-red-950/20" : ""
                          }`}
                        >
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
                            {r.channelName}
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
    </div>
  );
}
