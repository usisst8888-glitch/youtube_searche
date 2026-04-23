"use client";

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
    visualStyle,
    setVisualStyle,
    customStylePrompt,
    setCustomStylePrompt,
    generatedScenes,
  } = useProject();

  return (
    <div className="space-y-6">
      {generatedScenes.length === 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 text-sm rounded-lg px-4 py-3">
          ⚠️ 먼저{" "}
          <Link href="/create/analyze" className="underline">
            1단계 (상품 조사 + 대본 생성)
          </Link>
          을 완료해주세요.
        </div>
      )}

      {productImages.length > 0 && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <h2 className="font-semibold mb-3">
            📦 업로드된 상품 이미지{" "}
            <span className="text-xs text-zinc-500">
              ({productImages.length}장 — 1단계에서 업로드됨)
            </span>
          </h2>
          <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
            {productImages.map((img) => (
              <div
                key={img.id}
                className="rounded overflow-hidden border border-zinc-200 dark:border-zinc-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="w-full aspect-square object-cover"
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            이미지 수정이 필요하면{" "}
            <Link href="/create/analyze" className="text-blue-500 underline">
              1단계
            </Link>
            로 돌아가세요.
          </p>
        </section>
      )}

      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-3">🎨 비주얼 스타일 선택</h2>
        <p className="text-xs text-zinc-500 mb-4">
          씬 이미지 생성에 쓰일 아트 스타일입니다. 스토리텔링에는 실사보다 스타일라이즈가 더 잘 어울립니다.
        </p>

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
          ← 이전: 상품 조사 + 대본
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
