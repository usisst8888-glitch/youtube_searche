"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useProject } from "../context";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

export default function FinalizePage() {
  const {
    generatedScenes,
    sceneAssets,
    ttsAudioUrl,
    setTtsAudioUrl,
    bgmAudioUrl,
    setBgmAudioUrl,
    finalVideoUrl,
    setFinalVideoUrl,
  } = useProject();

  const [ttsLoading, setTtsLoading] = useState(false);
  const [bgmLoading, setBgmLoading] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeProgress, setMergeProgress] = useState("");
  const [error, setError] = useState("");
  const [bgmPrompt, setBgmPrompt] = useState("");
  const [bgmVolume, setBgmVolume] = useState(0.15);

  const ffmpegRef = useRef<FFmpeg | null>(null);

  const getAsset = (idx: number) =>
    sceneAssets.find((a) => a.sceneIndex === idx);

  const allVideosReady =
    generatedScenes.length > 0 &&
    generatedScenes.every((s) => getAsset(s.index)?.videoUrl);

  const fullScriptText = generatedScenes.map((s) => s.text).join(" ");

  const suggestedBgmPrompt = (() => {
    if (generatedScenes.length === 0)
      return "soft ambient instrumental background, warm";
    const emotions = generatedScenes.map((s) => s.emotion);
    return `Korean short-form video background music, vertical short BGM, instrumental, emotional arc: ${emotions.join(
      " → ",
    )}. Modern cinematic production.`;
  })();

  const handleTts = async () => {
    setError("");
    setTtsLoading(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: fullScriptText,
          emotionTone: "normal-1",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "TTS 실패");
      setTtsAudioUrl(data.audioUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setTtsLoading(false);
    }
  };

  const handleBgm = async () => {
    setError("");
    setBgmLoading(true);
    try {
      const prompt = bgmPrompt.trim() || suggestedBgmPrompt;
      const res = await fetch("/api/generate-bgm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, durationSec: 30 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "BGM 생성 실패");
      setBgmAudioUrl(data.audioUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBgmLoading(false);
    }
  };

  const ensureFfmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => {
      if (message.includes("time=")) {
        setMergeProgress(message.slice(0, 80));
      }
    });
    const base = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(
        `${base}/ffmpeg-core.wasm`,
        "application/wasm",
      ),
    });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  const handleMerge = async () => {
    setError("");
    setFinalVideoUrl(null);
    setMergeLoading(true);
    setMergeProgress("FFmpeg 로드 중...");
    try {
      const ffmpeg = await ensureFfmpeg();

      setMergeProgress("비디오 클립 다운로드 중...");
      const clipPaths: string[] = [];
      for (let i = 0; i < generatedScenes.length; i++) {
        const asset = getAsset(generatedScenes[i].index);
        if (!asset?.videoUrl) continue;
        const name = `scene${i}.mp4`;
        await ffmpeg.writeFile(name, await fetchFile(asset.videoUrl));
        clipPaths.push(name);
      }

      if (clipPaths.length === 0) {
        throw new Error("합칠 비디오가 없습니다.");
      }

      // Concat video clips
      const listFile = clipPaths.map((n) => `file '${n}'`).join("\n");
      await ffmpeg.writeFile("list.txt", listFile);

      setMergeProgress("씬 이어붙이는 중...");
      await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "list.txt",
        "-c",
        "copy",
        "merged.mp4",
      ]);

      let videoSource = "merged.mp4";

      // Add TTS and BGM if available
      if (ttsAudioUrl || bgmAudioUrl) {
        setMergeProgress("오디오 합성 중...");
        const filterParts: string[] = [];
        const inputs = ["-i", videoSource];

        let audioInputIdx = 1;
        const audioLabels: string[] = [];

        if (ttsAudioUrl) {
          await ffmpeg.writeFile("tts.mp3", await fetchFile(ttsAudioUrl));
          inputs.push("-i", "tts.mp3");
          audioLabels.push(`[${audioInputIdx}:a]volume=1.0[aTts]`);
          audioInputIdx++;
        }

        if (bgmAudioUrl) {
          await ffmpeg.writeFile("bgm.mp3", await fetchFile(bgmAudioUrl));
          inputs.push("-i", "bgm.mp3");
          audioLabels.push(`[${audioInputIdx}:a]volume=${bgmVolume}[aBgm]`);
          audioInputIdx++;
        }

        if (ttsAudioUrl && bgmAudioUrl) {
          filterParts.push(...audioLabels);
          filterParts.push(
            `[aTts][aBgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
          );
        } else if (ttsAudioUrl) {
          filterParts.push(...audioLabels);
          filterParts.push(`[aTts]anull[aout]`);
        } else if (bgmAudioUrl) {
          filterParts.push(...audioLabels);
          filterParts.push(`[aBgm]anull[aout]`);
        }

        await ffmpeg.exec([
          ...inputs,
          "-filter_complex",
          filterParts.join(";"),
          "-map",
          "0:v",
          "-map",
          "[aout]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-shortest",
          "final.mp4",
        ]);
        videoSource = "final.mp4";
      }

      setMergeProgress("완료!");
      const data = await ffmpeg.readFile(videoSource);
      const bytes =
        data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(data);
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: "video/mp4",
      });
      const url = URL.createObjectURL(blob);
      setFinalVideoUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "병합 오류");
    } finally {
      setMergeLoading(false);
    }
  };

  if (!allVideosReady) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 text-sm rounded-lg px-4 py-3">
        ⚠️{" "}
        <Link href="/create/videos" className="underline">
          4단계 (씬 비디오 생성)
        </Link>
        을 먼저 완료해주세요. 모든 씬에 비디오가 있어야 합성 가능합니다.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-3">🎤 TTS (Typecast)</h2>
        <div className="text-xs text-zinc-500 mb-3">
          전체 대본: {fullScriptText.length}자
        </div>
        <button
          onClick={handleTts}
          disabled={ttsLoading}
          className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          {ttsLoading ? "합성 중..." : ttsAudioUrl ? "다시 합성" : "TTS 생성"}
        </button>
        {ttsAudioUrl && (
          <audio controls src={ttsAudioUrl} className="mt-3 w-full" />
        )}
      </section>

      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-3">🎵 BGM (Stable Audio)</h2>
        <label className="block text-sm font-medium mb-1">
          프롬프트 <span className="text-xs text-zinc-500">(비우면 자동 생성)</span>
        </label>
        <textarea
          rows={2}
          value={bgmPrompt}
          onChange={(e) => setBgmPrompt(e.target.value)}
          placeholder={suggestedBgmPrompt}
          className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm mb-2"
        />
        <div className="mb-3">
          <label className="block text-xs text-zinc-500 mb-1">
            BGM 볼륨: {Math.round(bgmVolume * 100)}%
          </label>
          <input
            type="range"
            min={0}
            max={0.5}
            step={0.01}
            value={bgmVolume}
            onChange={(e) => setBgmVolume(parseFloat(e.target.value))}
            className="w-full accent-red-500"
          />
        </div>
        <button
          onClick={handleBgm}
          disabled={bgmLoading}
          className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          {bgmLoading ? "생성 중..." : bgmAudioUrl ? "다시 생성" : "BGM 생성"}
        </button>
        {bgmAudioUrl && (
          <audio controls src={bgmAudioUrl} className="mt-3 w-full" />
        )}
      </section>

      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-3">🎬 최종 합성 & 다운로드</h2>
        <p className="text-xs text-zinc-500 mb-3">
          씬 비디오들을 이어붙이고 TTS/BGM을 얹습니다. 브라우저 안에서 FFmpeg.wasm으로 처리 (서버 비용 0원).
        </p>
        <button
          onClick={handleMerge}
          disabled={mergeLoading}
          className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          {mergeLoading ? "병합 중..." : "🎬 최종 쇼츠 만들기"}
        </button>
        {mergeProgress && (
          <div className="mt-2 text-xs text-zinc-500 font-mono">
            {mergeProgress}
          </div>
        )}
        {finalVideoUrl && (
          <div className="mt-4">
            <video
              src={finalVideoUrl}
              controls
              className="w-full max-w-xs aspect-[9/16] rounded-lg bg-black mx-auto"
            />
            <div className="mt-3 text-center">
              <a
                href={finalVideoUrl}
                download={`short-${Date.now()}.mp4`}
                className="inline-block bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-5 py-2 rounded-lg"
              >
                ⬇️ MP4 다운로드
              </a>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg px-4 py-3">
          ⚠️ {error}
        </div>
      )}

      <div className="flex justify-between">
        <Link
          href="/create/videos"
          className="text-sm text-zinc-500 hover:underline"
        >
          ← 이전: 씬 비디오
        </Link>
      </div>
    </div>
  );
}
