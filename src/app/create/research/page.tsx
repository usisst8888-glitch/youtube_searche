"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useProject } from "../context";

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
  sources: { videoId: string; title: string; views: number }[];
  coupang: CoupangProduct[] | null;
  coupangSearchUrl: string;
};

type ApiResponse = {
  topic: string;
  products: ProductResult[];
  videos: Record<string, { title: string; views: number; thumbnail: string }>;
  coupangEnabled: boolean;
  error?: string;
};

export default function CreateResearchPage() {
  const router = useRouter();
  const { setProductName, setStoryTopic } = useProject();
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");

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
        body: JSON.stringify({ topic, maxVideos: 10 }),
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
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-1">🛒 제품 리서치 (선택)</h2>
        <p className="text-xs text-zinc-500 mb-4">
          주제를 입력하면 해당 주제로 바이럴한 YouTube 쇼츠들을 찾아서,
          영상 속에 등장하는 제품을 AI가 추출합니다.
          마음에 드는 제품을 골라 다음 단계로 넘기세요.
          <br />이미 제품이 정해졌다면 이 단계는 건너뛰고 <b>2. 상품 & 대본</b>으로 가세요.
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
            placeholder="예: 자취 1년차 vs 5년차 꿀템 / 30대 필수템 / 후회 없는 소비"
            className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
          />
          <button
            onClick={handleResearch}
            disabled={loading}
            className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white font-semibold px-5 py-2 rounded-lg"
          >
            {loading ? "분석 중..." : "🔍 리서치"}
          </button>
        </div>

        {loading && (
          <p className="mt-3 text-xs text-zinc-500">
            YouTube 검색 → 영상 Gemini 분석 → 제품 추출
            {result?.coupangEnabled ? " → 쿠팡 검색" : ""}, 약 30초~1분 소요.
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
          <section className="flex items-center justify-between">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              주제 <span className="font-semibold">&ldquo;{result.topic}&rdquo;</span>에서
              추출된 제품 <span className="font-semibold">{result.products.length}</span>개
              (영상 {Object.keys(result.videos).length}개 분석)
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
                    <div className="text-xs text-zinc-500 mt-0.5">
                      <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded mr-1">
                        {p.category}
                      </span>
                      {p.sources.length}개 영상 등장
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
