"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { useProject, WebSceneAsset } from "../context";
import { authFetch } from "@/lib/auth-fetch";

// 기본 쇼츠 템플릿 상수
const TEMPLATE = {
  width: 720,
  height: 1280,
  fps: 30,
  bgmVolume: 0.15,
  ttsVolume: 1.0,
};

function assetToImageUrl(a: WebSceneAsset): string {
  if (a.kind === "youtube-short") return a.thumbnail;
  if (a.kind === "web-image") return a.imageUrl;
  return a.coverUrl;
}

export default function FinalizePage() {
  const {
    generatedScenes,
    selectedSceneAssets,
    storyTopic,
    productName,
    ttsAudioUrl,
    setTtsAudioUrl,
    bgmAudioUrl,
    setBgmAudioUrl,
    finalVideoUrl,
    setFinalVideoUrl,
  } = useProject();

  const [ttsLoading, setTtsLoading] = useState(false);
  const [bgmLoading, setBgmLoading] = useState(false);
  const [bgmPrompt, setBgmPrompt] = useState("");
  const [composeLoading, setComposeLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const ffmpegRef = useRef<FFmpeg | null>(null);

  const allReady =
    generatedScenes.length > 0 &&
    generatedScenes.every(
      (s) => (selectedSceneAssets[s.index] || []).length > 0,
    );

  const fullScript = generatedScenes.map((s) => s.text).join(" ");
  const totalDuration = generatedScenes.reduce(
    (sum, s) => sum + (s.durationSec || 10),
    0,
  );

  const suggestedBgmPrompt = (() => {
    if (generatedScenes.length === 0)
      return "soft cinematic instrumental background, emotional, modern Korean short-form video BGM";
    const moods = generatedScenes.map((s) => s.emotion).join(" → ");
    return `${totalDuration}-second instrumental, mood arc: ${moods}. Warm, modern, Korean short-form video background music. No vocals.`;
  })();

  const handleTts = async () => {
    setError("");
    setTtsLoading(true);
    try {
      const res = await authFetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fullScript, emotionTone: "normal-1" }),
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
      const res = await authFetch("/api/generate-bgm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, durationSec: totalDuration }),
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
        setProgress(message.slice(0, 100));
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

  const downloadAndProxy = async (url: string): Promise<Uint8Array> => {
    // 외부 이미지 CORS 우회: 서버 프록시 통해 다운로드
    try {
      const res = await fetch(`/api/proxy-asset?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error("proxy fetch failed");
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      // fallback 직접 fetch (CORS 허용된 경우)
      const data = await fetchFile(url);
      return data instanceof Uint8Array ? data : new Uint8Array(data);
    }
  };

  const handleCompose = async () => {
    setError("");
    setFinalVideoUrl(null);
    setComposeLoading(true);
    setProgress("FFmpeg 로드 중...");
    try {
      const ffmpeg = await ensureFfmpeg();

      // 1. 각 씬: 선택한 첫 번째 소재 → 정사이즈 10초 클립으로 정규화
      const clipNames: string[] = [];
      for (let i = 0; i < generatedScenes.length; i++) {
        const scene = generatedScenes[i];
        const assets = selectedSceneAssets[scene.index] || [];
        if (assets.length === 0) {
          throw new Error(`씬 ${scene.index + 1} 에 소재가 없습니다.`);
        }
        const dur = scene.durationSec || 10;
        const perAsset = Math.max(1, Math.floor(dur / assets.length));
        // 멀티-소재일 경우 N개를 분할해서 사용

        for (let j = 0; j < assets.length; j++) {
          const a = assets[j];
          const url = assetToImageUrl(a);
          if (!url) continue;

          setProgress(
            `씬 ${i + 1}/${generatedScenes.length} · 소재 ${j + 1}/${assets.length} 다운로드`,
          );
          const bytes = await downloadAndProxy(url);

          const ext = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)?.[1]?.toLowerCase() || "jpg";
          const inName = `s${i}_${j}.${ext}`;
          const outName = `c${i}_${j}.mp4`;
          await ffmpeg.writeFile(inName, bytes);

          setProgress(`씬 ${i + 1} 클립화...`);
          // 이미지 → 슬로 줌 (Ken Burns) + 9:16 크롭
          await ffmpeg.exec([
            "-y",
            "-loop",
            "1",
            "-framerate",
            String(TEMPLATE.fps),
            "-i",
            inName,
            "-t",
            String(perAsset),
            "-vf",
            `scale=${TEMPLATE.width * 1.1}:${TEMPLATE.height * 1.1}:force_original_aspect_ratio=increase,crop=${TEMPLATE.width}:${TEMPLATE.height},zoompan=z='min(zoom+0.0008,1.15)':d=${perAsset * TEMPLATE.fps}:s=${TEMPLATE.width}x${TEMPLATE.height}:fps=${TEMPLATE.fps}`,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-an",
            outName,
          ]);
          clipNames.push(outName);
        }
      }

      if (clipNames.length === 0) {
        throw new Error("생성된 클립이 없습니다.");
      }

      // 2. 클립 이어붙이기
      setProgress("클립 이어붙이는 중...");
      const list = clipNames.map((n) => `file '${n}'`).join("\n");
      await ffmpeg.writeFile("list.txt", list);
      await ffmpeg.exec([
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "list.txt",
        "-c",
        "copy",
        "concat.mp4",
      ]);

      let videoSrc = "concat.mp4";

      // 3. 오디오 합성 (TTS + BGM)
      const hasTts = !!ttsAudioUrl;
      const hasBgm = !!bgmAudioUrl;

      if (hasTts || hasBgm) {
        setProgress("오디오 합성 중...");
        const inputs: string[] = ["-i", videoSrc];
        const filters: string[] = [];
        let inputIdx = 1;

        if (hasTts) {
          const ttsBytes = await downloadAndProxy(ttsAudioUrl!);
          await ffmpeg.writeFile("tts.mp3", ttsBytes);
          inputs.push("-i", "tts.mp3");
          filters.push(`[${inputIdx}:a]volume=${TEMPLATE.ttsVolume}[aTts]`);
          inputIdx++;
        }
        if (hasBgm) {
          const bgmBytes = await downloadAndProxy(bgmAudioUrl!);
          await ffmpeg.writeFile("bgm.mp3", bgmBytes);
          inputs.push("-i", "bgm.mp3");
          filters.push(`[${inputIdx}:a]volume=${TEMPLATE.bgmVolume}[aBgm]`);
          inputIdx++;
        }

        let mixLabel = "";
        if (hasTts && hasBgm) {
          filters.push(
            `[aTts][aBgm]amix=inputs=2:duration=longest:dropout_transition=2[aout]`,
          );
          mixLabel = "[aout]";
        } else if (hasTts) {
          mixLabel = "[aTts]";
        } else {
          mixLabel = "[aBgm]";
        }

        await ffmpeg.exec([
          ...inputs,
          "-filter_complex",
          filters.join(";"),
          "-map",
          "0:v",
          "-map",
          mixLabel,
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-shortest",
          "final.mp4",
        ]);
        videoSrc = "final.mp4";
      }

      setProgress("MP4 생성 완료, blob URL 생성 중...");
      const data = await ffmpeg.readFile(videoSrc);
      const bytes =
        data instanceof Uint8Array
          ? new Uint8Array(data)
          : new TextEncoder().encode(data);
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: "video/mp4",
      });
      const url = URL.createObjectURL(blob);
      setFinalVideoUrl(url);
      setProgress("✅ 완료");
    } catch (e) {
      setError(e instanceof Error ? e.message : "합성 오류");
    } finally {
      setComposeLoading(false);
    }
  };

  if (!allReady) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 text-sm rounded-lg px-4 py-3">
        ⚠️ 모든 씬에 소재가 선택되어야 합성 가능합니다.{" "}
        <Link href="/create/analyze" className="underline">
          2단계로 돌아가
        </Link>
        서 각 씬에 소재를 1개 이상 선택해주세요.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
        <h2 className="font-semibold mb-2">📋 합성 요약</h2>
        <div className="text-xs text-zinc-500 space-y-0.5">
          <div>
            제품:{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {productName}
            </span>
          </div>
          <div>주제: {storyTopic || "—"}</div>
          <div>
            씬 {generatedScenes.length}개 · 총 {totalDuration}초 (9:16, {TEMPLATE.fps}fps,{" "}
            {TEMPLATE.width}×{TEMPLATE.height})
          </div>
          <div>
            소재 합계{" "}
            {generatedScenes.reduce(
              (sum, s) => sum + (selectedSceneAssets[s.index] || []).length,
              0,
            )}
            개
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
        <h2 className="font-semibold mb-2">🎤 TTS (Typecast)</h2>
        <div className="text-xs text-zinc-500 mb-2">
          전체 대본: {fullScript.length}자
        </div>
        <button
          onClick={handleTts}
          disabled={ttsLoading}
          className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          {ttsLoading ? "합성 중..." : ttsAudioUrl ? "🔄 다시 합성" : "🎤 TTS 생성"}
        </button>
        {ttsAudioUrl && (
          <audio controls src={ttsAudioUrl} className="mt-3 w-full" />
        )}
      </section>

      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
        <h2 className="font-semibold mb-2">🎵 BGM (Stable Audio)</h2>
        <textarea
          rows={2}
          value={bgmPrompt}
          onChange={(e) => setBgmPrompt(e.target.value)}
          placeholder={suggestedBgmPrompt}
          className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm mb-2"
        />
        <button
          onClick={handleBgm}
          disabled={bgmLoading}
          className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          {bgmLoading ? "생성 중..." : bgmAudioUrl ? "🔄 다시 생성" : "🎵 BGM 생성"}
        </button>
        {bgmAudioUrl && (
          <audio controls src={bgmAudioUrl} className="mt-3 w-full" />
        )}
      </section>

      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
        <h2 className="font-semibold mb-2">🎬 최종 합성</h2>
        <p className="text-xs text-zinc-500 mb-3">
          선택된 소재를 기본 쇼츠 템플릿(9:16, {TEMPLATE.fps}fps, 씬당 10초,
          slow zoom)으로 클립화 → 이어붙이기 → 오디오 mix → MP4. 브라우저 안에서
          FFmpeg.wasm 처리.
        </p>
        <button
          onClick={handleCompose}
          disabled={composeLoading}
          className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white font-semibold px-5 py-2 rounded-lg"
        >
          {composeLoading ? "합성 중..." : "🎬 영상 만들기"}
        </button>
        {progress && (
          <div className="mt-2 text-xs text-zinc-500 font-mono">{progress}</div>
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
                download={`shorts-${Date.now()}.mp4`}
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
          href="/create/analyze"
          className="text-sm text-zinc-500 hover:underline"
        >
          ← 이전: 대본 + 소재
        </Link>
      </div>
    </div>
  );
}
