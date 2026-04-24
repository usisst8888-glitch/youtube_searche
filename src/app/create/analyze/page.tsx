"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useProject } from "../context";

type SuggestedTopic = {
  title: string;
  format: string;
  hook: string;
};

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
    productImages,
    setProductImages,
    generatedScenes,
    setGeneratedScenes,
    setAnalysis,
  } = useProject();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const [topicKeyword, setTopicKeyword] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedTopics, setSuggestedTopics] = useState<SuggestedTopic[]>([]);
  const [referenceTitles, setReferenceTitles] = useState<string[]>([]);

  useEffect(() => {
    const prefill = localStorage.getItem("yt_prefill_product");
    if (prefill) {
      setProductName(prefill);
      localStorage.removeItem("yt_prefill_product");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        body: JSON.stringify({
          keyword: topicKeyword,
          productName,
        }),
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

  const readFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (arr.length === 0) {
        setError("이미지 파일만 업로드 가능합니다.");
        return;
      }
      const datas = await Promise.all(
        arr.map(
          (f) =>
            new Promise<{ id: string; dataUrl: string; name: string }>(
              (resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve({
                    id: `${f.name}-${Date.now()}-${Math.random()}`,
                    dataUrl: reader.result as string,
                    name: f.name,
                  });
                reader.onerror = reject;
                reader.readAsDataURL(f);
              },
            ),
        ),
      );
      setProductImages([...productImages, ...datas]);
      setError("");
    },
    [productImages, setProductImages],
  );

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
          productImageDataUrls: productImages.map((p) => p.dataUrl),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "생성 실패");
      setGeneratedScenes(data.scenes || []);
      setProductResearch(data.productResearch || "");
      setStoryPremise(data.storyPremise || "");
      setAnalysis(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-4">입력</h2>

        <div className="space-y-4">
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-4">
            <label className="block text-sm font-medium mb-1">
              🔍 주제 아이디어 찾기
              <span className="ml-2 text-xs text-zinc-500">
                (선택 — 키워드 주면 YouTube 트렌드 분석해서 주제 10개 추천)
              </span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={topicKeyword}
                onChange={(e) => setTopicKeyword(e.target.value)}
                placeholder="예: 자취 꿀템 / 30대 필수템 / 후회 안 하는 소비"
                className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !suggesting) handleSuggestTopics();
                }}
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
                        onClick={() => setStoryTopic(t.title)}
                        className={`w-full text-left border rounded-lg p-2.5 transition-colors ${
                          storyTopic === t.title
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
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              🎭 스토리 주제 / 장면
              <span className="ml-2 text-xs text-zinc-500">
                (이게 중심, 제품은 소품으로 녹아듦)
              </span>
            </label>
            <textarea
              rows={2}
              value={storyTopic}
              onChange={(e) => setStoryTopic(e.target.value)}
              placeholder="예: 자취 1년차 vs 5년차 필수템 비교 (위에서 추천받거나 직접 입력)"
              className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
            />
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4">
            <label className="block text-sm font-medium mb-1">상품명</label>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="예: 다이슨 V15 무선청소기"
              className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
            />
            <p className="mt-1 text-xs text-zinc-500">
              주제가 스토리의 뼈대이고, 이 상품은 장면 속 소품으로 자연스럽게 등장합니다.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              상품 이미지 (여러 장 가능)
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                readFiles(e.dataTransfer.files);
              }}
              className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors ${
                dragging
                  ? "border-red-400 bg-red-50 dark:bg-red-950/20"
                  : "border-zinc-300 dark:border-zinc-700"
              }`}
            >
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">
                📦 이미지를 드래그하거나
              </p>
              <label className="inline-block bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg cursor-pointer">
                파일 선택
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) readFiles(e.target.files);
                  }}
                />
              </label>
            </div>
            {productImages.length > 0 && (
              <div className="mt-3 grid grid-cols-4 md:grid-cols-6 gap-2">
                {productImages.map((img) => (
                  <div
                    key={img.id}
                    className="relative group rounded overflow-hidden border border-zinc-200 dark:border-zinc-800"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="w-full aspect-square object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setProductImages(
                          productImages.filter((p) => p.id !== img.id),
                        )
                      }
                      className="absolute top-0.5 right-0.5 bg-black/60 hover:bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white font-semibold px-5 py-2.5 rounded-lg"
          >
            {loading ? "생성 중... (20~40초)" : "🎬 스토리 생성"}
          </button>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400">
              ⚠️ {error}
            </div>
          )}
        </div>
      </section>

      {productResearch && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <h2 className="font-semibold mb-3">🔎 상품 리서치 (웹 검색)</h2>
          <div className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
            {productResearch}
          </div>
        </section>
      )}

      {storyPremise && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <h2 className="font-semibold mb-2">🎭 스토리 프레미스</h2>
          <p className="text-sm whitespace-pre-wrap">{storyPremise}</p>
        </section>
      )}

      {generatedScenes.length > 0 && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <h2 className="font-semibold mb-3">🎬 생성된 씬별 대본</h2>
          <ol className="space-y-3">
            {generatedScenes.map((s) => (
              <li
                key={s.index}
                className="border-l-4 border-red-400 pl-4 py-1"
              >
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>씬 {s.index + 1}</span>
                  <span>·</span>
                  <span>{s.durationSec}초</span>
                  <span>·</span>
                  <span className="text-red-500">{s.emotion}</span>
                </div>
                <p className="mt-1 text-sm">{s.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex justify-end">
            <Link
              href="/create/images"
              className="text-sm text-blue-500 hover:underline"
            >
              다음: 비주얼 스타일 선택 →
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
