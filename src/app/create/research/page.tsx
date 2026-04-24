"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useProject } from "../context";

type SuggestedTopic = {
  title: string;
  format: string;
  hook: string;
};

type CoupangProduct = {
  productId: number;
  productName: string;
  productImage: string;
  productPrice: number;
  productUrl: string;
  categoryName?: string;
  isRocket?: boolean;
  isFreeShipping?: boolean;
};

type ProductResult = {
  name: string;
  category: string;
  context: string;
  productUrls: string[];
  source: string;
  sources: {
    videoId: string;
    title: string;
    views: number;
    urls: string[];
  }[];
  coupang: CoupangProduct[] | null;
  coupangSearchUrl: string;
};

type ApiResponse = {
  topic: string;
  products: ProductResult[];
  videos: Record<string, { title: string; views: number; thumbnail: string }>;
  coupangEnabled: boolean;
  filter?: {
    prefilteredOut: number;
    analyzed: number;
    zeroProductSkipped: number;
    kept: number;
  };
  error?: string;
};

export default function CreateResearchPage() {
  const router = useRouter();
  const { setProductName, setStoryTopic } = useProject();

  // Section 1: 주제 추천받기
  const [topicKeyword, setTopicKeyword] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedTopics, setSuggestedTopics] = useState<SuggestedTopic[]>([]);
  const [referenceTitles, setReferenceTitles] = useState<string[]>([]);

  // Section 2: 주제로 제품 찾기
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);

  const [error, setError] = useState("");

  const handleSuggestTopics = async () => {
    setError("");
    if (!topicKeyword.trim()) {
      setError("주제 찾기용 키워드를 입력하세요.");
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
      setError("주제를 입력하세요 (또는 위 섹션에서 추천받기).");
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
          // 긴 주제 제목은 YouTube 검색에 부적합 → 위 섹션의 원래 키워드 사용
          searchKeyword: topicKeyword.trim() || topic,
          maxVideos: 10,
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

  const useThisProduct = (productName: string) => {
    setProductName(productName);
    setStoryTopic(topic);
    router.push("/create/analyze");
  };

  return (
    <div className="space-y-6">
      {/* Section 1: 주제 추천받기 */}
      <section className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl p-6">
        <h2 className="font-semibold mb-1">① 주제 아이디어 찾기 (선택)</h2>
        <p className="text-xs text-zinc-500 mb-4">
          키워드로 YouTube 트렌드 분석 → 상품을 띄울 바이럴 주제 10개 추천.
          주제가 이미 있으면 이 단계 건너뛰고 아래로.
        </p>

        <div className="flex gap-2">
          <input
            type="text"
            value={topicKeyword}
            onChange={(e) => setTopicKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !suggesting) handleSuggestTopics();
            }}
            placeholder="예: 자취 꿀템 / 30대 필수템 / 후회 없는 소비"
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
          <div className="mt-3 space-y-2">
            <p className="text-xs text-zinc-500">
              👇 클릭하면 아래 주제 필드에 자동 입력됩니다
            </p>
            <ol className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {suggestedTopics.map((t, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => setTopic(t.title)}
                    className={`w-full text-left border rounded-lg p-2.5 transition-colors ${
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
                </li>
              ))}
            </ol>
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
          </div>
        )}
      </section>

      {/* Section 2: 주제로 제품 찾기 */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-1">② 주제로 제품 찾기</h2>
        <p className="text-xs text-zinc-500 mb-4">
          해당 주제로 바이럴한 YouTube 쇼츠들을 찾고, 설명·고정댓글·영상에서
          등장하는 제품을 추출합니다.
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
            placeholder="예: 자취 1년차 vs 5년차 꿀템 (또는 위 섹션에서 추천받기)"
            className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
          />
          <button
            onClick={handleResearch}
            disabled={loading}
            className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white font-semibold px-5 py-2 rounded-lg whitespace-nowrap"
          >
            {loading ? "분석 중..." : "🔍 제품 찾기"}
          </button>
        </div>
        {topicKeyword.trim() && (
          <p className="mt-1 text-xs text-zinc-500">
            YouTube 검색은 위 섹션의 키워드{" "}
            <code className="px-1 bg-zinc-100 dark:bg-zinc-800 rounded">
              {topicKeyword}
            </code>
            로 진행됩니다. (긴 주제 제목이 매칭되지 않는 문제 방지)
          </p>
        )}

        {loading && (
          <p className="mt-3 text-xs text-zinc-500">
            YouTube 검색 → 설명·댓글·영상 분석 → 제품 추출
            {result?.coupangEnabled ? " → 쿠팡 검색" : ""}, 약 30초~1분.
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
                주제 <span className="font-semibold">&ldquo;{result.topic}&rdquo;</span>에서
                추출된 제품 <span className="font-semibold">{result.products.length}</span>개
                (제품 있는 영상 {Object.keys(result.videos).length}개)
              </div>
              {result.filter && (
                <div className="text-xs text-zinc-500">
                  🔎 사전 필터 <b>{result.filter.prefilteredOut}</b>개 제외
                  (쇼핑 신호 없음) · 분석한 영상{" "}
                  <b>{result.filter.analyzed}</b>개 중{" "}
                  <b>{result.filter.zeroProductSkipped}</b>개는 제품 추출 실패로 스킵
                </div>
              )}
            </div>
            {!result.coupangEnabled && (
              <div className="text-xs text-amber-600 dark:text-amber-400">
                ⚠️ 쿠팡 파트너스 키 미설정 — 검색 링크만 표시
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.products.map((p, i) => (
              <div
                key={`${p.name}-${i}`}
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold">{p.name}</h3>
                    <div className="text-xs text-zinc-500 mt-0.5 flex flex-wrap gap-1 items-center">
                      <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded">
                        {p.category}
                      </span>
                      <span>{p.sources.length}개 영상 등장</span>
                      <span>·</span>
                      <span className="text-zinc-400">출처: {p.source}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {p.context}
                    </p>
                  </div>
                  <button
                    onClick={() => useThisProduct(p.name)}
                    className="shrink-0 text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg whitespace-nowrap"
                  >
                    이걸로 →
                  </button>
                </div>

                {p.productUrls.length > 0 && (
                  <div className="mt-3 text-xs">
                    <div className="text-zinc-500 mb-1">
                      🔗 영상에서 발견한 판매 링크:
                    </div>
                    <ul className="space-y-0.5">
                      {p.productUrls.map((u) => (
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

                {p.coupang && p.coupang.length > 0 ? (
                  <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                    <div className="text-xs font-medium text-zinc-500 mb-2">
                      🛒 쿠팡 상품
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {p.coupang.map((c) => (
                        <a
                          key={c.productId}
                          href={c.productUrl}
                          target="_blank"
                          rel="noreferrer sponsored"
                          className="block border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden hover:border-red-400"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={c.productImage}
                            alt={c.productName}
                            className="w-full aspect-square object-cover bg-zinc-50 dark:bg-zinc-800"
                          />
                          <div className="p-1.5">
                            <div className="text-[10px] line-clamp-2 text-zinc-700 dark:text-zinc-300">
                              {c.productName}
                            </div>
                            <div className="text-xs font-bold mt-1">
                              {c.productPrice.toLocaleString()}원
                            </div>
                            <div className="flex gap-1 mt-0.5">
                              {c.isRocket && (
                                <span className="text-[9px] bg-blue-500 text-white px-1 rounded">
                                  로켓
                                </span>
                              )}
                              {c.isFreeShipping && (
                                <span className="text-[9px] bg-zinc-500 text-white px-1 rounded">
                                  무배
                                </span>
                              )}
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : (
                  <a
                    href={p.coupangSearchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 block text-center text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 px-3 py-2 rounded-lg"
                  >
                    🛒 쿠팡에서 &ldquo;{p.name}&rdquo; 검색
                  </a>
                )}

                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-zinc-500">
                    🎬 등장 영상 {p.sources.length}개
                  </summary>
                  <ul className="mt-1 space-y-0.5 ml-4 list-disc">
                    {p.sources.map((s) => (
                      <li key={s.videoId}>
                        <a
                          href={`https://www.youtube.com/watch?v=${s.videoId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-500 hover:underline"
                        >
                          {s.title}
                        </a>
                        <span className="text-zinc-500 ml-1">
                          ({s.views.toLocaleString()} 조회)
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ))}
          </section>

          {result.products.length === 0 && (
            <div className="text-center text-zinc-500 py-8">
              제품을 추출하지 못했습니다. 다른 주제로 시도해보세요.
            </div>
          )}
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
