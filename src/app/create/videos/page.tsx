"use client";

import { useState } from "react";
import Link from "next/link";
import { useProject } from "../context";

export default function VideosPage() {
  const { generatedScenes, sceneAssets, setSceneAssets } = useProject();

  const [progressIndex, setProgressIndex] = useState<number | null>(null);
  const [error, setError] = useState("");

  const getAsset = (idx: number) =>
    sceneAssets.find((a) => a.sceneIndex === idx);

  const generateOne = async (idx: number) => {
    const scene = generatedScenes[idx];
    const asset = getAsset(idx);
    if (!scene || !asset?.imageDataUrl) {
      setError(`씬 ${idx + 1} 이미지가 먼저 필요합니다.`);
      return;
    }
    setError("");
    setProgressIndex(idx);
    try {
      const res = await fetch("/api/generate-scene-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl: asset.imageDataUrl,
          sceneText: scene.text,
          emotion: scene.emotion,
          durationSec: scene.durationSec,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "비디오 생성 실패");

      const next = [...sceneAssets.filter((a) => a.sceneIndex !== idx)];
      next.push({
        sceneIndex: idx,
        imageDataUrl: asset.imageDataUrl,
        videoUrl: data.videoUrl,
      });
      next.sort((a, b) => a.sceneIndex - b.sceneIndex);
      setSceneAssets(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setProgressIndex(null);
    }
  };

  const generateAll = async () => {
    for (let i = 0; i < generatedScenes.length; i++) {
      if (getAsset(i)?.videoUrl) continue;
      await generateOne(i);
    }
  };

  const hasAnyImage = sceneAssets.some((a) => a.imageDataUrl);

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

  if (!hasAnyImage) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 text-sm rounded-lg px-4 py-3">
        ⚠️{" "}
        <Link href="/create/scenes" className="underline">
          3단계 (씬 이미지 생성)
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
            <h2 className="font-semibold">씬별 비디오 생성 (LTX-Video)</h2>
            <p className="text-xs text-zinc-500 mt-1">
              각 씬 이미지에 움직임을 추가해 영상 클립으로 변환합니다. 씬당 약 1~2분 소요.
            </p>
          </div>
          <button
            onClick={generateAll}
            disabled={progressIndex !== null}
            className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            {progressIndex !== null
              ? `생성 중 (${progressIndex + 1}/${generatedScenes.length})...`
              : "⚡ 전체 비디오 자동 생성"}
          </button>
        </div>

        {error && (
          <div className="mt-2 text-sm text-red-600 dark:text-red-400">
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
                  disabled={progressIndex !== null || !asset?.imageDataUrl}
                  className="text-xs text-blue-500 hover:underline disabled:text-zinc-400"
                >
                  {asset?.videoUrl ? "다시 생성" : "생성"}
                </button>
              </div>
              <div className="aspect-[9/16] bg-zinc-100 dark:bg-zinc-800 rounded-lg overflow-hidden flex items-center justify-center relative">
                {asset?.videoUrl ? (
                  <video
                    src={asset.videoUrl}
                    controls
                    loop
                    className="w-full h-full object-cover"
                  />
                ) : asset?.imageDataUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.imageDataUrl}
                      alt=""
                      className="w-full h-full object-cover opacity-40"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-xs text-zinc-200 bg-black/60 px-3 py-1 rounded">
                        {isGenerating ? "🎬 생성 중 (1~2분)..." : "아직 비디오 없음"}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-zinc-400">이미지부터 생성 필요</div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <div className="flex justify-between">
        <Link
          href="/create/scenes"
          className="text-sm text-zinc-500 hover:underline"
        >
          ← 이전: 씬 이미지
        </Link>
        <Link
          href="/create/finalize"
          className="text-sm font-medium text-red-500 hover:underline"
        >
          다음: 최종 합성 →
        </Link>
      </div>
    </div>
  );
}
