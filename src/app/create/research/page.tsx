"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useProject } from "../context";

type Subcategory = {
  keyword: string;
  description: string;
};

type SuggestedTopic = {
  title: string;
  format: string;
  hook: string;
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
  title: string;
  thumbnail: string;
  views: number;
  publishedAt: string;
  descriptionPreview: string;
  topComments: string[];
  shoppingUrls: string[];
  shoppingProducts: ShoppingProduct[];
};

type ApiResponse = {
  topic: string;
  searchKeyword: string;
  videos: VideoResult[];
  coupangEnabled: boolean;
  filter?: {
    searched: number;
    titleFiltered: number;
    inspected: number;
    noShoppingSkipped?: number;
    returned: number;
  };
  error?: string;
};

export default function CreateResearchPage() {
  const router = useRouter();
  const { setProductName, setStoryTopic } = useProject();

  const [bigTopic, setBigTopic] = useState("");
  const [subFetching, setSubFetching] = useState(false);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  const [topicKeyword, setTopicKeyword] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedTopics, setSuggestedTopics] = useState<SuggestedTopic[]>([]);
  const [referenceTitles, setReferenceTitles] = useState<string[]>([]);

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

  const handleSuggestTopics = async () => {
    setError("");
    if (!topicKeyword.trim()) {
      setError("키워드를 입력하세요.");
      return;
    }
    setSuggesting(true);
    try {
      const res = await fetch("/api/suggest-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: topicKeyword, productName: "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "주제 생성 실패");
      setSuggestedTopics(data.topics || []);
      setReferenceTitles(data.referenceTitles || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setSuggesting(false);
    }
  };

  const handleResearch = async () => {
    setError("");
    if (!topic.trim()) {
      setError("주제를 입력하세요.");
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
          searchKeyword: topicKeyword.trim() || topic,
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
    setTopicKeyword(keyword);
    setSuggestedTopics([]);
    setReferenceTitles([]);
  };

  const useThisProduct = (productName: string) => {
    setProductName(productName);
    setStoryTopic(topic);
    router.push("/create/analyze");
  };

  return (
    <div className="space-y-6">
      {/* Section 0: 대주제 → 소주제 */}
      <section className="bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/40 rounded-xl p-6">
        <h2 className="font-semibold mb-1">⓪ 대주제 → 소주제 (선택)</h2>
        <p className="text-xs text-zinc-500 mb-4">
          큰 카테고리를 입력하면 쇼츠에 쓸 만한 세부 키워드 12개가 나옵니다.
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
                  topicKeyword === s.keyword
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

      {/* Section 1: 주제 추천받기 */}
      <section className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl p-6">
        <h2 className="font-semibold mb-1">① 주제 아이디어 찾기 (선택)</h2>
        <p className="text-xs text-zinc-500 mb-4">
          키워드로 YouTube 트렌드 분석 → 주제 10개 추천.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={topicKeyword}
            onChange={(e) => setTopicKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !suggesting) handleSuggestTopics();
            }}
            placeholder="예: 꿀템 / 필수템 / 캠핑"
            className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handleSuggestTopics}
            disabled={suggesting}
            className="bg-amber-600 hover:bg-amber-700 disabled:bg-zinc-400 text-white text-sm font-medium px-4 py-2 rounded-lg whitespace-nowrap"
          >
            {suggesting ? "분석 중..." : "주제 추천받기"}
          </button>
        </div>
        {suggestedTopics.length > 0 && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {suggestedTopics.map((t, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setTopic(t.title)}
                className={`text-left border rounded-lg p-2.5 transition-colors ${
                  topic === t.title
                    ? "border-red-500 bg-red-50 dark:bg-red-950/30"
                    : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-400"
                }`}
              >
                <div className="text-sm font-medium">{t.title}</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded mr-1">
                    {t.format}
                  </span>
                  {t.hook}
                </div>
              </button>
            ))}
          </div>
        )}
        {referenceTitles.length > 0 && (
          <details className="mt-2 text-xs text-zinc-500">
            <summary className="cursor-pointer">
              🔎 참고한 트렌딩 쇼츠 제목 {referenceTitles.length}개
            </summary>
            <ul className="mt-1 ml-4 list-disc space-y-0.5">
              {referenceTitles.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Section 2: 주제로 제품 찾기 */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-1">② 주제로 제품 찾기</h2>
        <p className="text-xs text-zinc-500 mb-4">
          YouTube에서 주제 관련 쇼츠를 찾고,{" "}
          <b>&ldquo;제품 보기&rdquo; (YouTube Shopping) 태그가 있는 영상만</b>{" "}
          골라서 그 영상의 공식 태그 제품을 가져옵니다.
        </p>
        <label className="block text-sm font-medium mb-2">주제 / 장면</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) handleResearch();
            }}
            placeholder="예: 자취 1년차 vs 5년차 꿀템"
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
        {topicKeyword.trim() && (
          <p className="mt-1 text-xs text-zinc-500">
            YouTube 검색은{" "}
            <code className="px-1 bg-zinc-100 dark:bg-zinc-800 rounded">
              {topicKeyword}
            </code>
            로 진행됩니다.
          </p>
        )}
        {loading && (
          <p className="mt-2 text-xs text-zinc-500">
            쇼츠 검색 → 제목 필터 → 각 영상 쇼핑 태그 확인, 약 30초~1분.
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
                  🔎 검색 {result.filter.searched}개 · 제목 필터로{" "}
                  {result.filter.titleFiltered}개 제외 · 쇼핑 태그 없음{" "}
                  {result.filter.noShoppingSkipped ?? 0}개 스킵
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
                    className="w-32 aspect-[9/16] object-cover rounded bg-zinc-100 dark:bg-zinc-800 shrink-0"
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
                      {v.views.toLocaleString()} 조회 · {v.publishedAt}
                    </div>
                    <div className="mt-1 text-xs">
                      <span className="inline-block bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
                        🛍️ 제품 보기 태그 {v.shoppingProducts.length}개
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {v.shoppingProducts.map((p, i) => (
                    <div
                      key={`${v.videoId}-${i}`}
                      className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden"
                    >
                      <a
                        href={p.buyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block"
                      >
                        {p.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.thumbnailUrl}
                            alt={p.title}
                            className="w-full aspect-square object-cover bg-zinc-50 dark:bg-zinc-800"
                          />
                        ) : (
                          <div className="w-full aspect-square bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 text-xs">
                            이미지 없음
                          </div>
                        )}
                      </a>
                      <div className="p-2 space-y-1">
                        <div className="text-xs line-clamp-2 min-h-[2.5rem]">
                          {p.title}
                        </div>
                        {p.price && (
                          <div className="text-sm font-bold">{p.price}</div>
                        )}
                        {p.merchantName && (
                          <div className="text-xs text-zinc-500">
                            {p.merchantName}
                          </div>
                        )}
                        <div className="flex gap-1 pt-1">
                          {p.buyUrl && (
                            <a
                              href={p.buyUrl}
                              target="_blank"
                              rel="noreferrer sponsored"
                              className="flex-1 text-center text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded px-2 py-1"
                            >
                              🛒 구매
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => useThisProduct(p.title)}
                            className="flex-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded px-2 py-1"
                          >
                            이걸로 →
                          </button>
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
