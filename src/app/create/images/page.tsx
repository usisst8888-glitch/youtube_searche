"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useProject, VisualStyle } from "../context";

const VISUAL_STYLES: { id: VisualStyle; label: string; hint: string }[] = [
  { id: "flat-2d", label: "2D 플랫 일러스트", hint: "책 삽화/브런치 스타일" },
  { id: "3d-cartoon", label: "3D 카툰", hint: "픽사/디즈니풍" },
  { id: "anime", label: "일본 애니메이션", hint: "스튜디오 지브리/신카이풍" },
  { id: "stick-figure", label: "졸라맨", hint: "미니멀/손그림" },
  { id: "watercolor", label: "수채화/수묵화", hint: "부드러운 감성" },
  { id: "low-poly-3d", label: "로우폴리 3D", hint: "각진 3D" },
  { id: "cyberpunk", label: "사이버펑크/네온", hint: "SF 미래적 분위기" },
  { id: "custom", label: "직접 입력", hint: "프롬프트 자유 작성" },
];

export default function ImagesPage() {
  const {
    productImages,
    setProductImages,
    visualStyle,
    setVisualStyle,
    customStylePrompt,
    setCustomStylePrompt,
    generatedScenes,
  } = useProject();

  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const readFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
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
  }, [productImages, setProductImages]);

  return (
    <div className="space-y-6">
      {generatedScenes.length === 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 text-sm rounded-lg px-4 py-3">
          ⚠️ 먼저{" "}
          <Link href="/create/analyze" className="underline">
            1단계 (대본 분석)
          </Link>
          을 완료해주세요. 씬별 대본이 있어야 이미지 생성 프롬프트에 쓸 수 있습니다.
        </div>
      )}

      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-3">상품 이미지 업로드</h2>

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
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            dragging
              ? "border-red-400 bg-red-50 dark:bg-red-950/20"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
            📦 상품 사진을 여기에 드래그 앤 드롭하거나
          </p>
          <label className="inline-block bg-red-500 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer">
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
          <p className="mt-2 text-xs text-zinc-500">
            여러 장 가능 (다양한 각도/배경/사용 장면 넣으면 결과 좋아짐)
          </p>
        </div>

        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">⚠️ {error}</p>
        )}

        {productImages.length > 0 && (
          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {productImages.map((img) => (
              <div
                key={img.id}
                className="relative group rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800"
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
                  className="absolute top-1 right-1 bg-black/60 hover:bg-red-500 text-white text-xs w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="제거"
                >
                  ×
                </button>
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent text-white text-xs p-1 truncate">
                  {img.name}
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="mt-3 text-xs text-zinc-500">
          업로드된 이미지 {productImages.length}장
        </p>
      </section>

      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-3">비주얼 스타일 선택</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {VISUAL_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setVisualStyle(s.id)}
              className={`text-left border rounded-lg p-3 transition-colors ${
                visualStyle === s.id
                  ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                  : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
              }`}
            >
              <div className="text-sm font-medium">{s.label}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{s.hint}</div>
            </button>
          ))}
        </div>

        {visualStyle === "custom" && (
          <div className="mt-4">
            <label className="block text-sm font-medium mb-1">
              커스텀 스타일 프롬프트
            </label>
            <textarea
              rows={2}
              value={customStylePrompt}
              onChange={(e) => setCustomStylePrompt(e.target.value)}
              placeholder="예: vaporwave aesthetic, neon pink and blue, retro CRT glitch"
              className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        )}
      </section>

      <div className="flex justify-between">
        <Link
          href="/create/analyze"
          className="text-sm text-zinc-500 hover:underline"
        >
          ← 이전: 대본 분석
        </Link>
        <Link
          href="/create/scenes"
          className="text-sm font-medium text-red-500 hover:underline"
        >
          다음: 씬 이미지 생성 →
        </Link>
      </div>
    </div>
  );
}
