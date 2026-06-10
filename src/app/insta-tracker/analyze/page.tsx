"use client";

import { useState } from "react";
import Link from "next/link";
import { AnalysisView, type Analysis } from "../AnalysisView";

export default function AnalyzeStandalonePage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [cached, setCached] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setAnalysis(null);
    setCached(false);
    try {
      const res = await fetch("/api/insta-tracker/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "분석 실패");
        return;
      }
      setAnalysis(json.analysis as Analysis);
      setCached(json.cached === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "분석 실패");
    } finally {
      setLoading(false);
    }
  }

  async function reanalyze() {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/insta-tracker/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), force: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "분석 실패");
        return;
      }
      setAnalysis(json.analysis as Analysis);
      setCached(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "분석 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/insta-tracker"
          className="text-xs text-zinc-500 hover:text-red-500"
        >
          ← 인스타 트래커
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-1">🤖 인스타 영상 분석</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
        인스타그램 릴스/포스트 URL을 붙여넣으면 Gemini가{" "}
        <strong>전사 + 어그로 제목 + 4씬 쇼츠 대본 + 샤오홍슈/도우인 검색 키워드</strong>
        를 한 번에 뽑아드려요.
      </p>

      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 mb-6"
      >
        <label className="block text-sm font-medium mb-2">
          인스타그램 영상 URL
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.instagram.com/reel/{shortcode}/"
            className="flex-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700"
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="text-sm px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-red-500 text-white font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
          >
            {loading ? "분석 중…" : "✨ 분석"}
          </button>
        </div>
        <p className="text-xs text-zinc-400 mt-2">
          DB에 없는 영상이면 Apify로 먼저 받아와요 (1~2분 추가 소요).
        </p>
      </form>

      {error && (
        <div className="mb-4 px-4 py-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-lg text-sm text-rose-700 dark:text-rose-300">
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div className="text-center py-12 text-zinc-400 text-sm">
          Gemini가 영상을 보고 있어요… (30초~2분)
        </div>
      )}

      {analysis && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
          {cached && (
            <div className="mb-4 text-xs text-zinc-500 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-950 rounded inline-block">
              💾 캐시된 결과 — 다시 분석하려면{" "}
              <button
                onClick={reanalyze}
                className="text-red-500 hover:underline"
              >
                재분석
              </button>
            </div>
          )}
          <AnalysisView a={analysis} />
        </div>
      )}
    </div>
  );
}
