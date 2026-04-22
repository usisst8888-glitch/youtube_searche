"use client";

import { useState, useEffect } from "react";

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
};

type ApiResponse = {
  total: number;
  outlierCount: number;
  threshold: number;
  results: Result[];
  message?: string;
  error?: string;
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
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [summary, setSummary] = useState<{
    total: number;
    outlierCount: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [onlyOutliers, setOnlyOutliers] = useState(false);

  useEffect(() => {
    const savedKeyword = localStorage.getItem("yt_last_keyword");
    if (savedKeyword) setKeyword(savedKeyword);
  }, []);

  const handleSearch = async () => {
    setError("");
    setResults([]);
    setSummary(null);

    if (!keyword.trim()) {
      setError("키워드를 입력하세요.");
      return;
    }
    localStorage.setItem("yt_last_keyword", keyword);

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
        }),
      });
      const data: ApiResponse = await res.json();
      if (!res.ok) throw new Error(data.error || `오류 (${res.status})`);
      setResults(data.results);
      setSummary({ total: data.total, outlierCount: data.outlierCount });
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
              <label className="block text-sm font-medium mb-1">검색 키워드</label>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !loading) handleSearch();
                }}
                className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                placeholder="예: 로지텍 마우스"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                검색 결과 수:{" "}
                <span className="font-bold text-red-500">{searchMax}</span>
              </label>
              <input
                type="range"
                min={10}
                max={50}
                step={5}
                value={searchMax}
                onChange={(e) => setSearchMax(parseInt(e.target.value, 10))}
                className="w-full accent-red-500"
              />
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
                YouTube API 호출 중, 30초~1분 소요됩니다
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
              <div className="text-lg">
                총{" "}
                <span className="font-bold text-2xl">{summary.total}</span>개 쇼츠 중{" "}
                <span className="font-bold text-2xl text-red-500">
                  🔥 {summary.outlierCount}
                </span>
                개 떡상 ({threshold}배 이상)
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
