"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useProject } from "../context";

type Subcategory = {
  keyword: string;
  description: string;
};

type ShoppingProduct = {
  title: string;
  thumbnailUrl: string;
  price: string;
  merchantName: string;
  buyUrl: string;
  accessibilityText: string;
};

type VideoResult = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  thumbnail: string;
  views: number;
  publishedAt: string;
  descriptionPreview: string;
  topComments: string[];
  shoppingUrls: string[];
  shoppingProducts: ShoppingProduct[];
  channelMedian: number | null;
  viewRatio: number | null;
};

type ApiResponse = {
  topic: string;
  searchKeyword: string;
  videos: VideoResult[];
  coupangEnabled: boolean;
  filter?: {
    searched: number;
    titleReviewMatches?: number;
    inspected: number;
    noShoppingSkipped?: number;
    returned: number;
  };
  error?: string;
};

export default function CreateResearchPage() {
  const router = useRouter();
  const { setProductName, setStoryTopic } = useProject();

  // Section ⓪: 대주제 → 소주제
  const [bigTopic, setBigTopic] = useState("");
  const [subFetching, setSubFetching] = useState(false);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  // Section ①: 주제로 제품 찾기
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);

  const [error, setError] = useState("");

  const handleSuggestSubcategories = async () => {
    setError("");
    if (!bigTopic.trim()) {
      setError("대주제를 입력하세요.");
      return;
    }
    setSubFetching(true);
    try {
      const res = await fetch("/api/suggest-subcategories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bigTopic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "소주제 생성 실패");
      setSubcategories(data.subcategories || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setSubFetching(false);
    }
  };

  const handleResearch = async () => {
    setError("");
    if (!topic.trim()) {
      setError("주제/키워드를 입력하세요.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/research-topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          searchKeyword: topic,
          maxVideos: 15,
        }),
      });
      const data: ApiResponse = await res.json();
      if (!res.ok) throw new Error(data.error || "요청 실패");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  };

  const useSubcategory = (keyword: string) => {
    setTopic(keyword);
  };

  const useThisProduct = (productName: string) => {
    setProductName(productName);
    setStoryTopic(topic);
    router.push("/create/analyze");
  };

  return (
    <div className="space-y-6">
      {/* Section ⓪: 대주제 → 소주제 */}
      <section className="bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/40 rounded-xl p-6">
        <h2 className="font-semibold mb-1">⓪ 대주제 → 소주제 (선택)</h2>
        <p className="text-xs text-zinc-500 mb-4">
          큰 카테고리를 입력하면 쇼츠 검색에 쓸 만한 세부 키워드 12개가 나옵니다.
          키워드 클릭 시 아래 ① 섹션의 주제 필드에 자동 입력.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={bigTopic}
            onChange={(e) => setBigTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !subFetching)
                handleSuggestSubcategories();
            }}
            placeholder="예: 골프 / 자취 / 뷰티 / 홈트 / 캠핑"
            className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handleSuggestSubcategories}
            disabled={subFetching}
            className="bg-sky-600 hover:bg-sky-700 disabled:bg-zinc-400 text-white text-sm font-medium px-4 py-2 rounded-lg whitespace-nowrap"
          >
            {subFetching ? "생성 중..." : "소주제 찾기"}
          </button>
        </div>
        {subcategories.length > 0 && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
            {subcategories.map((s) => (
              <button
                key={s.keyword}
                type="button"
                onClick={() => useSubcategory(s.keyword)}
                className={`text-left border rounded-lg p-2 transition-colors ${
                  topic === s.keyword
                    ? "border-red-500 bg-red-50 dark:bg-red-950/30"
                    : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-sky-400"
                }`}
              >
                <div className="text-sm font-medium">{s.keyword}</div>
                <div className="text-xs text-zinc-500 line-clamp-1">
                  {s.description}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Section ①: 주제로 제품 찾기 */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-1">① 주제로 영상·제품 찾기</h2>
        <p className="text-xs text-zinc-500 mb-4">
          YouTube에서 주제 관련 쇼츠를 찾고,{" "}
          <b>&ldquo;제품 보기&rdquo; (YouTube Shopping) 태그가 있는 영상만</b>{" "}
          골라서 그 영상의 공식 태그 제품을 가져옵니다.
        </p>
        <label className="block text-sm font-medium mb-2">주제 / 키워드</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) handleResearch();
            }}
            placeholder="예: 골프 연습도구 / 자취 꿀템 / 뷰티 필수템"
            className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
          />
          <button
            onClick={handleResearch}
            disabled={loading}
            className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white font-semibold px-5 py-2 rounded-lg whitespace-nowrap"
          >
            {loading ? "분석 중..." : "🔍 영상 찾기"}
          </button>
        </div>
        {loading && (
          <p className="mt-2 text-xs text-zinc-500">
            쇼츠 검색 → 각 영상 쇼핑 태그 확인 → 채널 평균 계산, 약 30초~1분.
          </p>
        )}
        {error && (
          <div className="mt-3 text-sm text-red-600 dark:text-red-400">
            ⚠️ {error}
          </div>
        )}
      </section>

      {result && (
        <>
          <section className="flex items-start justify-between gap-4 flex-wrap">
            <div className="text-sm text-zinc-600 dark:text-zinc-400 space-y-1">
              <div>
                <b>{result.videos.length}</b>개 영상에서 YouTube Shopping
                제품 태그를 찾았습니다
              </div>
              {result.filter && (
                <div className="text-xs text-zinc-500">
                  🔎 검색한 쇼츠 {result.filter.searched}개 중 쇼핑 태그 있는
                  영상 <b>{result.filter.returned}</b>개 (쇼핑 태그 없어서 스킵{" "}
                  {result.filter.noShoppingSkipped ?? 0}개)
                </div>
              )}
            </div>
          </section>

          <section className="space-y-4">
            {result.videos.map((v) => (
              <div
                key={v.videoId}
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4"
              >
                <div className="flex gap-3 mb-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={v.thumbnail}
                    alt={v.title}
                    className="w-24 aspect-[9/16] object-cover rounded bg-zinc-100 dark:bg-zinc-800 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <a
                      href={`https://www.youtube.com/watch?v=${v.videoId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-semibold hover:underline line-clamp-2"
                    >
                      {v.title}
                    </a>
                    <div className="text-xs text-zinc-500 mt-1">
                      <span className="font-medium text-zinc-600 dark:text-zinc-400">
                        {v.channelTitle}
                      </span>
                      {" · "}
                      {v.views.toLocaleString()} 조회 · {v.publishedAt}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="inline-block bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs px-2 py-0.5 rounded">
                        🛍️ 태그 {v.shoppingProducts.length}개
                      </span>
                      {v.viewRatio !== null && (
                        <span
                          className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${
                            v.viewRatio >= 3
                              ? "bg-red-500 text-white"
                              : v.viewRatio >= 1.5
                                ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"
                                : v.viewRatio >= 1
                                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                                  : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                          }`}
                          title={`채널 쇼츠 중앙값 ${v.channelMedian?.toLocaleString()} 대비`}
                        >
                          {v.viewRatio >= 3
                            ? "🔥 "
                            : v.viewRatio >= 1.5
                              ? "📈 "
                              : v.viewRatio < 1
                                ? "📉 "
                                : ""}
                          채널 평균 대비 {v.viewRatio.toFixed(1)}x
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {v.shoppingProducts.map((p, i) => (
                    <div
                      key={`${v.videoId}-${i}`}
                      className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-1.5 flex gap-2"
                    >
                      {p.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.thumbnailUrl}
                          alt={p.title}
                          className="w-14 h-14 object-cover rounded bg-zinc-50 dark:bg-zinc-800 shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 bg-zinc-100 dark:bg-zinc-800 rounded flex items-center justify-center text-zinc-400 text-[10px] shrink-0">
                          이미지
                        </div>
                      )}
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <div className="text-[11px] leading-tight line-clamp-2">
                            {p.title}
                          </div>
                          {p.merchantName && (
                            <div className="text-[10px] text-zinc-500 line-clamp-1 mt-0.5">
                              {p.merchantName}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-1 mt-1">
                          {p.price ? (
                            <div className="text-xs font-bold truncate">
                              {p.price}
                            </div>
                          ) : (
                            <div />
                          )}
                          <div className="flex gap-0.5 shrink-0">
                            {p.buyUrl && (
                              <a
                                href={p.buyUrl}
                                target="_blank"
                                rel="noreferrer sponsored"
                                className="text-[10px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded"
                              >
                                구매
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => useThisProduct(p.title)}
                              className="text-[10px] px-1.5 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded"
                            >
                              선택
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {(v.shoppingUrls.length > 0 ||
                  v.descriptionPreview ||
                  v.topComments.length > 0) && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-zinc-500">
                      📝 영상 설명 · 고정 댓글 · 링크 보기
                    </summary>
                    <div className="mt-2 space-y-2 border-l-2 border-zinc-200 dark:border-zinc-800 pl-3">
                      {v.descriptionPreview && (
                        <div>
                          <div className="font-medium text-zinc-500">설명</div>
                          <div className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
                            {v.descriptionPreview}
                          </div>
                        </div>
                      )}
                      {v.topComments.length > 0 && (
                        <div>
                          <div className="font-medium text-zinc-500">
                            상단 댓글
                          </div>
                          <ul className="space-y-1 text-zinc-600 dark:text-zinc-400">
                            {v.topComments.map((c, i) => (
                              <li key={i} className="whitespace-pre-wrap">
                                {c}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {v.shoppingUrls.length > 0 && (
                        <div>
                          <div className="font-medium text-zinc-500">
                            발견된 쇼핑 링크
                          </div>
                          <ul className="space-y-0.5">
                            {v.shoppingUrls.map((u) => (
                              <li key={u}>
                                <a
                                  href={u}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-500 hover:underline break-all"
                                >
                                  {u}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </section>
        </>
      )}

      <div className="flex justify-between">
        <span />
        <Link
          href="/create/analyze"
          className="text-sm font-medium text-red-500 hover:underline"
        >
          건너뛰기 / 다음: 상품 & 대본 →
        </Link>
      </div>
    </div>
  );
}
