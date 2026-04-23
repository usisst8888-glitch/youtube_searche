"use client";

import { useState } from "react";
import Link from "next/link";
import { useProject, GeneratedSceneAsset } from "../context";
import { buildStylePrompt } from "@/lib/style-prompts";

export default function ScenesPage() {
  const {
    generatedScenes,
    productImages,
    visualStyle,
    customStylePrompt,
    sceneAssets,
    setSceneAssets,
  } = useProject();

  const [progressIndex, setProgressIndex] = useState<number | null>(null);
  const [error, setError] = useState("");

  const stylePrompt = buildStylePrompt(visualStyle, customStylePrompt);

  const getAsset = (idx: number) =>
    sceneAssets.find((a) => a.sceneIndex === idx);

  const callGenerate = async (
    idx: number,
    prevImage: string | undefined,
  ) => {
    const scene = generatedScenes[idx];
    if (!scene) throw new Error(`씬 ${idx + 1}이 존재하지 않습니다.`);
    const res = await fetch("/api/generate-scene-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sceneIndex: idx,
        sceneText: scene.text,
        emotion: scene.emotion,
        stylePrompt,
        productDataUrls: productImages.map((p) => p.dataUrl),
        previousImageDataUrl: prevImage,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "이미지 생성 실패");
    return data.imageDataUrl as string;
  };

  const upsertAsset = (
    assets: GeneratedSceneAsset[],
    idx: number,
    imageDataUrl: string,
  ): GeneratedSceneAsset[] => {
    const existing = assets.find((a) => a.sceneIndex === idx);
    const next = assets.filter((a) => a.sceneIndex !== idx);
    next.push({
      sceneIndex: idx,
      imageDataUrl,
      videoUrl: existing?.videoUrl,
    });
    next.sort((a, b) => a.sceneIndex - b.sceneIndex);
    return next;
  };

  const generateOne = async (idx: number) => {
    setError("");
    setProgressIndex(idx);
    try {
      const prevImage = idx > 0 ? getAsset(idx - 1)?.imageDataUrl : undefined;
      const imageDataUrl = await callGenerate(idx, prevImage);
      setSceneAssets(upsertAsset(sceneAssets, idx, imageDataUrl));
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setProgressIndex(null);
    }
  };

  const generateAll = async () => {
    setError("");
    // Keep a local working copy to avoid stale closure over sceneAssets
    let working: GeneratedSceneAsset[] = [...sceneAssets];
    for (let i = 0; i < generatedScenes.length; i++) {
      setProgressIndex(i);
      try {
        const prevImage =
          i > 0
            ? working.find((a) => a.sceneIndex === i - 1)?.imageDataUrl
            : undefined;
        const imageDataUrl = await callGenerate(i, prevImage);
        working = upsertAsset(working, i, imageDataUrl);
        setSceneAssets([...working]);
      } catch (e) {
        setError(
          `씬 ${i + 1} 생성 실패: ${
            e instanceof Error ? e.message : "오류"
          }`,
        );
        break;
      }
    }
    setProgressIndex(null);
  };

  if (generatedScenes.length === 0) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 text-sm rounded-lg px-4 py-3">
        ⚠️{" "}
        <Link href="/create/analyze" className="underline">
          1단계 (대본 분석)
        </Link>
        부터 완료해주세요.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <div className="flex flex-wrap justify-between gap-3 mb-3">
          <div>
            <h2 className="font-semibold">씬별 이미지 생성 (Nano Banana)</h2>
            <p className="text-xs text-zinc-500 mt-1">
              각 씬마다 상품 이미지 + 스타일 + 이전 씬을 참고해 일관성 있게 생성합니다.
            </p>
          </div>
          <button
            onClick={generateAll}
            disabled={progressIndex !== null}
            className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            {progressIndex !== null
              ? `생성 중 (${progressIndex + 1}/${generatedScenes.length})...`
              : "⚡ 전체 씬 자동 생성"}
          </button>
        </div>

        <div className="text-xs text-zinc-500">
          적용 스타일: <code className="font-mono">{stylePrompt}</code>
        </div>

        {productImages.length === 0 && (
          <div className="mt-3 text-sm text-amber-600 dark:text-amber-400">
            ⚠️ 상품 이미지가 없습니다.{" "}
            <Link href="/create/images" className="underline">
              2단계
            </Link>
            에서 업로드하면 결과 품질이 훨씬 올라갑니다.
          </div>
        )}

        {error && (
          <div className="mt-3 text-sm text-red-600 dark:text-red-400">
            ⚠️ {error}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {generatedScenes.map((scene) => {
          const asset = getAsset(scene.index);
          const isGenerating = progressIndex === scene.index;
          return (
            <div
              key={scene.index}
              className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">
                  씬 {scene.index + 1}
                  <span className="ml-2 text-xs text-red-500">
                    {scene.emotion}
                  </span>
                </div>
                <button
                  onClick={() => generateOne(scene.index)}
                  disabled={progressIndex !== null}
                  className="text-xs text-blue-500 hover:underline disabled:text-zinc-400"
                >
                  {asset?.imageDataUrl ? "다시 생성" : "생성"}
                </button>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
                {scene.text}
              </p>
              <div className="aspect-[9/16] bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-hidden flex items-center justify-center">
                {asset?.imageDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.imageDataUrl}
                    alt={`Scene ${scene.index + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : isGenerating ? (
                  <div className="text-xs text-zinc-500">
                    🎨 생성 중...
                  </div>
                ) : (
                  <div className="text-xs text-zinc-400">아직 생성 안 됨</div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <div className="flex justify-between">
        <Link
          href="/create/images"
          className="text-sm text-zinc-500 hover:underline"
        >
          ← 이전: 상품 이미지
        </Link>
        <Link
          href="/create/videos"
          className="text-sm font-medium text-red-500 hover:underline"
        >
          다음: 씬 비디오 생성 →
        </Link>
      </div>
    </div>
  );
}
