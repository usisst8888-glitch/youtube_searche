"use client";

import { useState } from "react";
import { useProject } from "../context";

export default function AnalyzePage() {
  const {
    analysis,
    setAnalysis,
    newScriptTopic,
    setNewScriptTopic,
    generatedScenes,
    setGeneratedScenes,
  } = useProject();

  const [url, setUrl] = useState(analysis?.referenceUrl || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAnalyze = async () => {
    setError("");
    if (!url.trim()) {
      setError("YouTube URL을 입력하세요.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/analyze-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, topic: newScriptTopic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "분석 실패");
      setAnalysis(data.analysis);
      setGeneratedScenes(data.scenes || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-4">참고 영상 + 새 대본 주제</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              참고 YouTube 영상 URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/shorts/..."
              className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
            />
            <p className="mt-1 text-xs text-zinc-500">
              대본 구조/스타일만 참고합니다. 비주얼은 다음 단계에서 선택.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              만들 쇼츠의 주제 / 상품 스토리
            </label>
            <textarea
              rows={3}
              value={newScriptTopic}
              onChange={(e) => setNewScriptTopic(e.target.value)}
              placeholder="예: 자취생을 위한 혁신 무선 이어폰. 출근길 지옥철에서 구원받은 이야기 스토리."
              className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2"
            />
          </div>

          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white font-semibold px-5 py-2.5 rounded-lg"
          >
            {loading ? "분석 중..." : "📝 대본 분석 + 생성"}
          </button>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400">
              ⚠️ {error}
            </div>
          )}
        </div>
      </section>

      {analysis && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
          <h2 className="font-semibold mb-3">📊 참고 영상 분석</h2>
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
            <a
              href="/create/images"
              className="text-sm text-blue-500 hover:underline"
            >
              다음: 상품 이미지 업로드 →
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
