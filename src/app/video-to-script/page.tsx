"use client";

import { useState } from "react";

type Scene = {
  index: number;
  text: string;
  emotion: string;
  durationSec: number;
};

type FrameStats = {
  extracted: number;
  afterDedup: number;
  sentToModel: number;
  fps: string;
  durationSec: number;
};

type Result = {
  videoSummary: string;
  videoTitle: string;
  storyPremise: string;
  scenes: Scene[];
  frameStats: FrameStats;
};

const EMOTION_COLORS: Record<string, string> = {
  배경: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  디테일:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  문제: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  반전: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
};

export default function VideoToScriptPage() {
  const [file, setFile] = useState<File | null>(null);
  const [hint, setHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit() {
    if (!file) {
      setError("영상 파일을 선택해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    setCopied(false);
    try {
      const fd = new FormData();
      fd.append("video", file);
      if (hint.trim()) fd.append("hint", hint.trim());
      const res = await fetch("/api/analyze-video-frames", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "분석에 실패했어요.");
        return;
      }
      setResult(data as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 중 오류가 발생했어요.");
    } finally {
      setLoading(false);
    }
  }

  function copyScript() {
    if (!result) return;
    const body = result.scenes
      .map((s, i) => `씬 ${i + 1} [${s.emotion}]\n${s.text}`)
      .join("\n\n");
    const full = `${result.videoTitle}\n\n${body}`;
    navigator.clipboard.writeText(full).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">🎞️ 영상 → 대본</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          로컬 영상을 올리면 화면(이미지)만 분석해서 쇼츠 대본을 자동으로 짜드려요.
          자막·설명 없이 영상 자체만 봐요.
        </p>
      </div>

      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 mb-6">
        <label className="block text-sm font-medium mb-2">영상 파일</label>
        <input
          type="file"
          accept="video/*"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setError("");
          }}
          className="block w-full text-sm text-zinc-600 dark:text-zinc-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-red-500 file:text-white hover:file:bg-red-600 file:cursor-pointer"
        />
        {file && (
          <p className="mt-2 text-xs text-zinc-500">
            {file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB
          </p>
        )}

        <label className="block text-sm font-medium mt-5 mb-2">
          힌트 (선택) — 영상 설명이나 원하는 방향
        </label>
        <textarea
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          rows={2}
          placeholder="예: 강아지가 처음 눈을 보는 영상 / 반전 느낌으로 가줘"
          className="w-full text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-700"
        />

        <button
          onClick={handleSubmit}
          disabled={loading || !file}
          className="mt-5 w-full py-2.5 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "분석 중… (프레임 추출 + AI 대본)" : "대본 만들기"}
        </button>

        {error && (
          <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="space-y-5">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs text-zinc-500 mb-1">영상 제목</div>
                <h2 className="text-xl font-bold leading-snug">
                  {result.videoTitle}
                </h2>
              </div>
              <button
                onClick={copyScript}
                className="shrink-0 text-sm px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-red-300 dark:hover:border-red-700"
              >
                {copied ? "복사됨!" : "대본 복사"}
              </button>
            </div>

            {result.videoSummary && (
              <div className="mt-4">
                <div className="text-xs text-zinc-500 mb-1">
                  📺 원본 영상 분석
                </div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                  {result.videoSummary}
                </p>
              </div>
            )}

            {result.storyPremise && (
              <p className="mt-3 text-xs italic text-zinc-500 whitespace-pre-wrap">
                {result.storyPremise}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.scenes.map((s, i) => (
              <div
                key={i}
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-bold">씬 {i + 1}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      EMOTION_COLORS[s.emotion?.trim()] ||
                      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {s.emotion}
                  </span>
                  <span className="ml-auto text-xs text-zinc-400">
                    {s.durationSec}s
                  </span>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {s.text}
                </p>
              </div>
            ))}
          </div>

          <p className="text-xs text-zinc-400">
            프레임 {result.frameStats.extracted}장 추출 → 중복 제거 후{" "}
            {result.frameStats.afterDedup}장 → AI에 {result.frameStats.sentToModel}장 전달
            · 영상 {result.frameStats.durationSec}초 · {result.frameStats.fps}fps
          </p>
        </section>
      )}
    </div>
  );
}
