"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useProject } from "../context";

export default function AnalyzePage() {
  const {
    analysis,
    setAnalysis,
    productName,
    setProductName,
    productResearch,
    setProductResearch,
    productImages,
    setProductImages,
    generatedScenes,
    setGeneratedScenes,
  } = useProject();

  const [url, setUrl] = useState(analysis?.referenceUrl || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

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
    if (!url.trim()) return setError("참고 YouTube URL을 입력하세요.");
    if (!productName.trim()) return setError("상품명을 입력하세요.");

    setLoading(true);
    try {
      const res = await fetch("/api/analyze-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          productName,
          productImageDataUrls: productImages.map((p) => p.dataUrl),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "분석 실패");
      setAnalysis(data.analysis);
      setGeneratedScenes(data.scenes || []);
      setProductResearch(data.productResearch || "");
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
          <div>
            <label className="block text-sm font-medium mb-1">
              참고 YouTube 쇼츠 URL
              <span className="ml-2 text-xs text-zinc-500">
                (대본 구조/스타일만 참고)
              </span>
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/shorts/..."
              className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">상품명</label>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="예: 다이슨 V15 무선청소기, 벤큐 SW272U 모니터"
              className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Gemini가 웹 검색으로 타겟, 페인포인트, 셀링포인트를 자동 조사합니다.
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
            {loading ? "분석 중... (20~40초)" : "🔍 상품 조사 + 대본 생성"}
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
          <h2 className="font-semibold mb-3">🔎 상품 리서치 결과 (웹 검색)</h2>
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
            {productResearch}
          </div>
        </section>
      )}

      {analysis && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <h2 className="font-semibold mb-3">📊 참고 영상 대본 스타일</h2>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="font-medium text-zinc-500">스타일 요약</dt>
              <dd className="mt-0.5">{analysis.styleSummary}</dd>
            </div>
            <div>
              <dt className="font-medium text-zinc-500">훅 패턴</dt>
              <dd className="mt-0.5">{analysis.hookPattern}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="font-medium text-zinc-500">구조 노트</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">
                {analysis.structureNotes}
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="font-medium text-zinc-500">톤 태그</dt>
              <dd className="mt-0.5 flex flex-wrap gap-1">
                {analysis.toneTags.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded"
                  >
                    {t}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
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
