"use client";

import { useState } from "react";
import Link from "next/link";
import { useProject, WebSceneAsset } from "../context";

export default function AnalyzePage() {
  const {
    storyTopic,
    setStoryTopic,
    productName,
    setProductName,
    productResearch,
    setProductResearch,
    storyPremise,
    setStoryPremise,
    generatedScenes,
    setGeneratedScenes,
    setAnalysis,
    fetchedSceneAssets,
    setFetchedSceneAssets,
    selectedSceneAssets,
    setSelectedSceneAssets,
    storyAngleData,
  } = useProject();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fetchingSceneIndex, setFetchingSceneIndex] = useState<number | null>(
    null,
  );
  const [activeSceneIndex, setActiveSceneIndex] = useState<number | null>(
    null,
  );
  const [queriesBySceneIndex, setQueriesBySceneIndex] = useState<
    Record<number, { videoQueries: string[]; imageQueries: string[] }>
  >({});
  const [hoveredAssetKey, setHoveredAssetKey] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setError("");
    if (!productName.trim()) return setError("상품명을 입력하세요.");

    setLoading(true);
    try {
      const res = await fetch("/api/analyze-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyTopic,
          productName,
          productImageDataUrls: [],
          angleData: storyAngleData,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "생성 실패");
      setGeneratedScenes(data.scenes || []);
      setProductResearch(data.productResearch || "");
      setStoryPremise(data.storyPremise || "");
      setAnalysis(null);
      setFetchedSceneAssets({});
      setSelectedSceneAssets({});
      setActiveSceneIndex(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  };

  const fetchAssetsForScene = async (sceneIndex: number) => {
    const scene = generatedScenes[sceneIndex];
    if (!scene) return;
    setFetchingSceneIndex(sceneIndex);
    setError("");
    try {
      const res = await fetch("/api/fetch-scene-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneText: scene.text,
          emotion: scene.emotion,
          productName,
          region: "",
          lang: "en",
          ytLimit: 8,
          imgLimit: 6,
          tiktokLimit: 3,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "소재 수집 실패");
      setFetchedSceneAssets((prev) => ({
        ...prev,
        [sceneIndex]: data.assets as WebSceneAsset[],
      }));
      setQueriesBySceneIndex((prev) => ({
        ...prev,
        [sceneIndex]: {
          videoQueries: data.videoQueries || [],
          imageQueries: data.imageQueries || [],
        },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setFetchingSceneIndex(null);
    }
  };

  const assetKey = (a: WebSceneAsset): string => {
    if (a.kind === "youtube-short") return `yt:${a.videoId}`;
    if (a.kind === "web-image") return `img:${a.imageUrl}`;
    return `tt:${a.videoId}`;
  };

  const isAssetSelected = (
    sceneIndex: number,
    asset: WebSceneAsset,
  ): boolean => {
    const list = selectedSceneAssets[sceneIndex] || [];
    const k = assetKey(asset);
    return list.some((a) => assetKey(a) === k);
  };

  const toggleAsset = (sceneIndex: number, asset: WebSceneAsset) => {
    setSelectedSceneAssets((prev) => {
      const list = prev[sceneIndex] || [];
      const k = assetKey(asset);
      const existing = list.findIndex((a) => assetKey(a) === k);
      const next =
        existing >= 0
          ? list.filter((_, i) => i !== existing)
          : [...list, asset];
      return { ...prev, [sceneIndex]: next };
    });
  };

  const clearAssets = (sceneIndex: number) => {
    setSelectedSceneAssets((prev) => {
      const next = { ...prev };
      delete next[sceneIndex];
      return next;
    });
  };

  const assetThumb = (a: WebSceneAsset): string => {
    if (a.kind === "youtube-short") return a.thumbnail;
    if (a.kind === "web-image") return a.imageUrl;
    return a.coverUrl;
  };

  const assetLabel = (a: WebSceneAsset): string => {
    if (a.kind === "youtube-short") return "🎬 YouTube Shorts";
    if (a.kind === "web-image") return "🖼️ 제품 이미지";
    return "🎵 TikTok";
  };

  const assetSource = (a: WebSceneAsset): string => {
    if (a.kind === "youtube-short") return a.channel;
    if (a.kind === "web-image") return a.siteName || "웹";
    return a.author;
  };

  const assetLink = (a: WebSceneAsset): string => {
    if (a.kind === "youtube-short") return a.watchUrl;
    if (a.kind === "web-image") return a.sourceUrl;
    return a.watchUrl;
  };

  return (
    <div className="space-y-6">
      {/* 입력 */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-1">입력</h2>
        <p className="text-xs text-zinc-500 mb-4">
          주제·상품명은{" "}
          <Link
            href="/create/research"
            className="text-blue-500 hover:underline"
          >
            0단계 썰 라이브러리
          </Link>
          에서 선택하면 자동 입력. 대본 생성 후 각 씬마다 YouTube /
          쇼핑이미지 / TikTok에서 소재를 가져와서 고를 수 있어요.
        </p>

        {storyAngleData && (
          <div className="mb-4 border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3">
            <div className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1">
              📚 썰 라이브러리에서 선택된 썰 (이 내용으로 대본 생성)
            </div>
            <div className="text-sm font-semibold">{storyAngleData.angle}</div>
            {storyAngleData.hook && (
              <div className="mt-1 text-xs italic text-zinc-700 dark:text-zinc-300">
                &ldquo;{storyAngleData.hook}&rdquo;
              </div>
            )}
            {storyAngleData.fact && (
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                {storyAngleData.fact}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              🎭 스토리 주제
            </label>
            <textarea
              rows={2}
              value={storyTopic}
              onChange={(e) => setStoryTopic(e.target.value)}
              placeholder="예: 왜 항아리 모양인지 아세요?"
              className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">상품명</label>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="예: 빙그레 바나나맛 우유"
              className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white font-semibold px-5 py-2.5 rounded-lg"
          >
            {loading ? "대본 생성 중... (20~40초)" : "🎬 대본 생성"}
          </button>
          {error && (
            <span className="text-sm text-red-600 dark:text-red-400">
              ⚠️ {error}
            </span>
          )}
        </div>
      </section>

      {/* 스토리 프레미스 */}
      {storyPremise && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
          <div className="text-xs font-medium text-zinc-500 mb-1">
            🎭 스토리 프레미스
          </div>
          <p className="text-sm whitespace-pre-wrap">{storyPremise}</p>
        </section>
      )}

      {/* 대본 + 씬별 소재 */}
      {generatedScenes.length > 0 && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 왼쪽: 씬 리스트 */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-2">
            <h3 className="font-semibold mb-2">🎬 씬별 대본</h3>
            {generatedScenes.map((s) => {
              const selectedList = selectedSceneAssets[s.index] || [];
              const isActive = activeSceneIndex === s.index;
              return (
                <button
                  key={s.index}
                  type="button"
                  onClick={() => setActiveSceneIndex(s.index)}
                  className={`w-full text-left border rounded-lg p-3 transition-colors ${
                    isActive
                      ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                      : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold">씬 {s.index + 1}</span>
                      <span className="text-zinc-400">·</span>
                      <span className="text-zinc-500">{s.durationSec}초</span>
                      <span className="text-zinc-400">·</span>
                      <span className="text-red-500">{s.emotion}</span>
                    </div>
                    {selectedList.length > 0 ? (
                      <span className="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
                        ✅ 소재 {selectedList.length}개 선택
                      </span>
                    ) : (
                      <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded">
                        소재 없음
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-snug">{s.text}</p>
                  {selectedList.length > 0 && (
                    <div className="mt-2 flex gap-1 overflow-x-auto">
                      {selectedList.map((sel, i) => (
                        <div
                          key={`${assetKey(sel)}-${i}`}
                          className="relative shrink-0"
                          title={assetLabel(sel)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={assetThumb(sel)}
                            alt=""
                            className="w-10 h-10 object-cover rounded bg-zinc-100 dark:bg-zinc-800"
                          />
                          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] rounded-full w-3.5 h-3.5 flex items-center justify-center">
                            {i + 1}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* 오른쪽: 선택된 씬의 소재 패널 */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
            {activeSceneIndex === null ? (
              <div className="text-sm text-zinc-500 py-8 text-center">
                왼쪽에서 씬을 선택하면 소재 후보가 여기 표시됩니다.
              </div>
            ) : (
              (() => {
                const scene = generatedScenes[activeSceneIndex];
                const assets = fetchedSceneAssets[activeSceneIndex] || [];
                const selectedList =
                  selectedSceneAssets[activeSceneIndex] || [];
                return (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-sm">
                        씬 {activeSceneIndex + 1} 소재 ({selectedList.length}{" "}
                        선택됨)
                      </h3>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => fetchAssetsForScene(activeSceneIndex)}
                          disabled={fetchingSceneIndex !== null}
                          className="text-xs bg-sky-600 hover:bg-sky-700 disabled:bg-zinc-400 text-white px-3 py-1.5 rounded-lg"
                        >
                          {fetchingSceneIndex === activeSceneIndex
                            ? "검색 중..."
                            : assets.length === 0
                              ? "🔍 소재 찾기"
                              : "🔄 다시 찾기"}
                        </button>
                        {selectedList.length > 0 && (
                          <button
                            type="button"
                            onClick={() => clearAssets(activeSceneIndex)}
                            className="text-xs bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 px-2 py-1.5 rounded-lg"
                          >
                            전부 해제
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3 italic">
                      &ldquo;{scene?.text}&rdquo;
                    </p>
                    <p className="text-xs text-zinc-500 mb-2">
                      🎬 YouTube 영상 8개 · 🖼 이미지 6개 · 🎵 TikTok 3개 (가능 시) ·
                      여러 개 선택 가능. 한국 채널은 자동 배제.
                    </p>
                    {queriesBySceneIndex[activeSceneIndex] && (
                      <div className="mb-3 text-[10px] text-zinc-500 space-y-0.5">
                        <div>
                          🎬 영상 검색어:{" "}
                          {queriesBySceneIndex[
                            activeSceneIndex
                          ].videoQueries.map((q, i) => (
                            <code
                              key={i}
                              className="px-1 mr-1 bg-zinc-100 dark:bg-zinc-800 rounded"
                            >
                              {q}
                            </code>
                          ))}
                        </div>
                        <div>
                          🖼 이미지 검색어:{" "}
                          {queriesBySceneIndex[
                            activeSceneIndex
                          ].imageQueries.map((q, i) => (
                            <code
                              key={i}
                              className="px-1 mr-1 bg-zinc-100 dark:bg-zinc-800 rounded"
                            >
                              {q}
                            </code>
                          ))}
                        </div>
                      </div>
                    )}

                    {assets.length === 0 ? (
                      <div className="text-sm text-zinc-500 py-6 text-center">
                        {fetchingSceneIndex === activeSceneIndex
                          ? "YouTube · 쇼핑 페이지 · TikTok 검색 중..."
                          : "아직 소재를 찾지 않았습니다. 위 버튼을 눌러주세요."}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {assets.map((a, idx) => {
                          const thumb = assetThumb(a);
                          const isSelected = isAssetSelected(
                            activeSceneIndex,
                            a,
                          );
                          const selectionOrder = isSelected
                            ? selectedList.findIndex(
                                (sel) => assetKey(sel) === assetKey(a),
                              ) + 1
                            : 0;
                          const k = assetKey(a);
                          const isHovered = hoveredAssetKey === k;
                          const isVideo =
                            a.kind === "youtube-short" || a.kind === "tiktok";
                          const previewUrl =
                            a.kind === "youtube-short"
                              ? `https://www.youtube.com/embed/${a.videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${a.videoId}&modestbranding=1`
                              : a.kind === "tiktok"
                                ? `https://www.tiktok.com/embed/v2/${a.videoId}?autoplay=1&music_info=0`
                                : "";
                          return (
                            <div
                              key={`${a.kind}-${idx}`}
                              role="button"
                              tabIndex={0}
                              onClick={() =>
                                toggleAsset(activeSceneIndex, a)
                              }
                              onMouseEnter={() => setHoveredAssetKey(k)}
                              onMouseLeave={() =>
                                setHoveredAssetKey((cur) =>
                                  cur === k ? null : cur,
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggleAsset(activeSceneIndex, a);
                                }
                              }}
                              className={`relative text-left border rounded-lg overflow-hidden cursor-pointer hover:border-red-400 ${
                                isSelected
                                  ? "border-red-500 ring-2 ring-red-500"
                                  : "border-zinc-200 dark:border-zinc-800"
                              }`}
                            >
                              <div className="relative w-full aspect-[9/16] bg-zinc-100 dark:bg-zinc-800">
                                {isHovered && isVideo && previewUrl ? (
                                  <iframe
                                    src={previewUrl}
                                    title="preview"
                                    allow="autoplay; encrypted-media"
                                    className="absolute inset-0 w-full h-full pointer-events-none"
                                  />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={thumb}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover"
                                  />
                                )}
                                {isVideo && !isHovered && (
                                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="bg-black/50 rounded-full w-9 h-9 flex items-center justify-center text-white text-base">
                                      ▶
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="absolute top-1 left-1 text-[9px] bg-black/70 text-white px-1.5 py-0.5 rounded">
                                {assetLabel(a)}
                              </div>
                              {isSelected && (
                                <div className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                                  {selectionOrder}
                                </div>
                              )}
                              <div className="p-1.5">
                                <div className="text-[10px] line-clamp-2 leading-tight">
                                  {a.kind === "youtube-short"
                                    ? a.title
                                    : a.kind === "web-image"
                                      ? a.title || a.siteName
                                      : a.title || "TikTok 영상"}
                                </div>
                                <div className="text-[9px] text-zinc-500 mt-0.5 flex items-center justify-between">
                                  <span className="truncate">
                                    {assetSource(a)}
                                  </span>
                                  <a
                                    href={assetLink(a)}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-blue-500 hover:underline shrink-0 ml-1"
                                  >
                                    원본 ↗
                                  </a>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        </section>
      )}

      {/* 제품 리서치 (접이식) */}
      {productResearch && (
        <details className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            🔎 제품 사용 맥락 (리서치 결과)
          </summary>
          <div className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300 mt-3">
            {productResearch}
          </div>
        </details>
      )}

      {generatedScenes.length > 0 && (
        <div className="flex justify-between">
          <Link
            href="/create/research"
            className="text-sm text-zinc-500 hover:underline"
          >
            ← 이전: 제품 리서치
          </Link>
          <Link
            href="/create/finalize"
            className="text-sm font-medium text-red-500 hover:underline"
          >
            다음: 영상 합성 →
          </Link>
        </div>
      )}
    </div>
  );
}
