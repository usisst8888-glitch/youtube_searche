"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { useProject, WebSceneAsset } from "../context";
import { authFetch } from "@/lib/auth-fetch";
import {
  getCachedAsset,
  setCachedAsset,
  clearAssetCache,
  getCacheStats,
} from "@/lib/asset-cache";

// 기본 쇼츠 템플릿 (3:7 default — 비율은 UI에서 조절)
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

// 영상 자산 다운로드 URL 추출 (썸네일 X, 실제 재생 가능한 URL)
function assetToVideoUrl(a: WebSceneAsset): string | null {
  if (a.kind === "youtube-short") return a.watchUrl;
  if (a.kind === "tiktok") return a.playUrl || a.watchUrl;
  return null;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  // 한국어는 단어 분리가 안 되는 경우 많아서 글자 단위 fallback
  if (lines.length === 1 && ctx.measureText(text).width > maxWidth) {
    const chars: string[] = [];
    let cur = "";
    for (const ch of text) {
      const t = cur + ch;
      if (ctx.measureText(t).width > maxWidth && cur) {
        chars.push(cur);
        cur = ch;
      } else {
        cur = t;
      }
    }
    if (cur) chars.push(cur);
    return chars;
  }
  return lines;
}

async function renderTitleBarPng(args: {
  width: number;
  height: number;
  text: string;
  bgColor: string;
  textColor: string;
  fontSize: number;
}): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = args.width;
  canvas.height = args.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d 컨텍스트 없음");
  ctx.fillStyle = args.bgColor;
  ctx.fillRect(0, 0, args.width, args.height);
  ctx.fillStyle = args.textColor;
  ctx.font = `900 ${args.fontSize}px "Apple SD Gothic Neo", "Noto Sans KR", "Pretendard", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const padding = 40;
  const lines = wrapText(ctx, args.text, args.width - padding * 2);
  const lineHeight = args.fontSize * 1.25;
  const startY = args.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, args.width / 2, startY + i * lineHeight);
  });
  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob(res, "image/png"),
  );
  if (!blob) throw new Error("PNG blob 생성 실패");
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
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

  // 템플릿 설정
  const [bgColor, setBgColor] = useState("#FFE600");
  const [textColor, setTextColor] = useState("#000000");
  const [fontSize, setFontSize] = useState(72);
  const [topRatio, setTopRatio] = useState(0.3); // 상단 비율 (0.1 ~ 0.6)
  const [headerText, setHeaderText] = useState("");

  // storyTopic 바뀌면 헤더 기본값 동기화 (사용자가 수정 안 했을 때만)
  useEffect(() => {
    setHeaderText((cur) => cur || storyTopic || "");
  }, [storyTopic]);

  // 비율을 짝수 픽셀로 정렬 (libx264는 짝수 해상도 요구)
  const TOP_HEIGHT =
    Math.round((TEMPLATE.height * topRatio) / 2) * 2;
  const BOTTOM_HEIGHT = TEMPLATE.height - TOP_HEIGHT;

  const [ttsLoading, setTtsLoading] = useState(false);
  const [bgmLoading, setBgmLoading] = useState(false);
  const [bgmPrompt, setBgmPrompt] = useState("");
  const [composeLoading, setComposeLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  // 미리보기
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);

  // 씬 순서 및 씬별 길이 (편집)
  const [sceneOrder, setSceneOrder] = useState<number[]>([]);
  const [sceneDurations, setSceneDurations] = useState<Record<number, number>>(
    {},
  );

  // 씬 데이터 변경 시 순서/길이 초기화
  useEffect(() => {
    if (generatedScenes.length === 0) return;
    setSceneOrder((prev) => {
      const fresh = generatedScenes.map((s) => s.index);
      // 이미 동일하면 유지
      if (
        prev.length === fresh.length &&
        prev.every((v, i) => v === fresh[i])
      ) {
        return prev;
      }
      return fresh;
    });
    setSceneDurations((prev) => {
      const next: Record<number, number> = { ...prev };
      for (const s of generatedScenes) {
        if (next[s.index] === undefined) next[s.index] = s.durationSec || 10;
      }
      return next;
    });
  }, [generatedScenes]);

  // 캐시 통계
  const [cacheStats, setCacheStats] = useState<{
    count: number;
    totalBytes: number;
  } | null>(null);
  const refreshCacheStats = async () => {
    setCacheStats(await getCacheStats());
  };
  useEffect(() => {
    refreshCacheStats();
  }, []);

  const moveScene = (sceneIdx: number, delta: -1 | 1) => {
    setSceneOrder((prev) => {
      const pos = prev.indexOf(sceneIdx);
      if (pos < 0) return prev;
      const newPos = pos + delta;
      if (newPos < 0 || newPos >= prev.length) return prev;
      const next = [...prev];
      [next[pos], next[newPos]] = [next[newPos], next[pos]];
      return next;
    });
  };

  const setSceneDuration = (sceneIdx: number, dur: number) => {
    setSceneDurations((prev) => ({ ...prev, [sceneIdx]: dur }));
  };

  const totalDurationCustom = sceneOrder.reduce(
    (sum, idx) => sum + (sceneDurations[idx] || 10),
    0,
  );

  const allReady =
    generatedScenes.length > 0 &&
    generatedScenes.every(
      (s) => (selectedSceneAssets[s.index] || []).length > 0,
    );

  const fullScript = generatedScenes.map((s) => s.text).join(" ");
  const totalDuration = totalDurationCustom || 0;

  const headerTextResolved = (headerText || storyTopic || "").trim();

  // 라이브 미리보기 (씬 1)
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || generatedScenes.length === 0) return;
    canvas.width = 360;
    canvas.height = 640;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 배경 (전체)
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, 360, 640);
    // 상단 영역
    const topH = Math.round(640 * topRatio);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 360, topH);
    // 텍스트
    ctx.fillStyle = textColor;
    const previewFontSize = Math.round(fontSize * 0.5);
    ctx.font = `900 ${previewFontSize}px "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const padding = 20;
    const lines = wrapText(ctx, headerTextResolved, 360 - padding * 2);
    const lineHeight = previewFontSize * 1.25;
    const startY = topH / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, 360 / 2, startY + i * lineHeight);
    });
    // 하단 영역 placeholder
    ctx.fillStyle = "#333";
    ctx.fillRect(0, topH, 360, 640 - topH);
    ctx.fillStyle = "#888";
    ctx.font = "16px sans-serif";
    ctx.fillText("[ 영상/이미지 영역 ]", 180, topH + (640 - topH) / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgColor, textColor, fontSize, headerTextResolved, generatedScenes, topRatio]);

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

  const suggestedBgmPrompt = (() => {
    if (generatedScenes.length === 0)
      return "soft cinematic instrumental background, emotional, modern Korean short-form video BGM";
    const moods = generatedScenes.map((s) => s.emotion).join(" → ");
    return `${totalDuration}-second instrumental, mood arc: ${moods}. Warm, modern, Korean short-form video background music. No vocals.`;
  })();

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
    // 1) IndexedDB 캐시 확인
    const cached = await getCachedAsset(url);
    if (cached) return cached.bytes;

    // 2) 다운로드
    let bytes: Uint8Array;
    let ct = "application/octet-stream";
    try {
      const res = await fetch(`/api/proxy-asset?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error("proxy fetch failed");
      ct = res.headers.get("content-type") || ct;
      const buf = await res.arrayBuffer();
      bytes = new Uint8Array(buf);
    } catch {
      const data = await fetchFile(url);
      bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    }

    // 3) 캐시 저장 (best-effort)
    void setCachedAsset(url, bytes, ct);
    void refreshCacheStats();
    return bytes;
  };

  const downloadVideoCached = async (videoUrl: string): Promise<Uint8Array> => {
    const cacheKey = `video::${videoUrl}`;
    const cached = await getCachedAsset(cacheKey);
    if (cached) return cached.bytes;
    const res = await fetch(
      `/api/download-video?url=${encodeURIComponent(videoUrl)}`,
    );
    if (!res.ok) throw new Error(`download ${res.status}`);
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    void setCachedAsset(cacheKey, bytes, "video/mp4");
    void refreshCacheStats();
    return bytes;
  };

  const handleCompose = async () => {
    setError("");
    setFinalVideoUrl(null);
    setComposeLoading(true);
    setProgress("FFmpeg 로드 중...");
    try {
      const ffmpeg = await ensureFfmpeg();

      const sceneClips: string[] = [];

      const orderedScenes = sceneOrder
        .map((sceneIdx) => generatedScenes.find((s) => s.index === sceneIdx))
        .filter((s): s is NonNullable<typeof s> => !!s);

      for (let i = 0; i < orderedScenes.length; i++) {
        const scene = orderedScenes[i];
        const assets = selectedSceneAssets[scene.index] || [];
        if (assets.length === 0)
          throw new Error(`씬 ${scene.index + 1}에 소재 없음`);

        const dur = sceneDurations[scene.index] || scene.durationSec || 10;
        const perAsset = Math.max(1, Math.floor(dur / Math.max(1, assets.length)));
        // 이 변수 사용 — i 가 ordered position (file 이름 prefix 용)
        void i;

        // 1) 상단 타이틀 바 PNG (Canvas)
        setProgress(`씬 ${i + 1}/${generatedScenes.length} · 타이틀 렌더`);
        const titlePng = await renderTitleBarPng({
          width: TEMPLATE.width,
          height: TOP_HEIGHT,
          text: headerTextResolved,
          bgColor,
          textColor,
          fontSize,
        });
        await ffmpeg.writeFile(`title_${i}.png`, titlePng);

        // 2) 하단 영역 — 각 소재를 720x896 클립으로 정규화 후 concat
        //    영상 자산: 실제 영상 다운로드 → 처음부터 perAsset 초만 사용
        //    이미지 자산: Ken Burns 효과로 perAsset 초 클립 생성
        const bottomClips: string[] = [];
        for (let j = 0; j < assets.length; j++) {
          const a = assets[j];
          const videoUrl = assetToVideoUrl(a);
          const bottomName = `b${i}_${j}.mp4`;

          if (videoUrl) {
            // 영상 다운로드 시도 (캐시 우선)
            setProgress(
              `씬 ${i + 1} · 영상 ${j + 1}/${assets.length} 로드`,
            );
            try {
              const buf = await downloadVideoCached(videoUrl);
              const inName = `vs${i}_${j}.mp4`;
              await ffmpeg.writeFile(inName, buf);

              setProgress(`씬 ${i + 1} · 영상 ${j + 1} 클립화...`);
              await ffmpeg.exec([
                "-y",
                "-ss",
                "0",
                "-t",
                String(perAsset),
                "-i",
                inName,
                "-vf",
                `scale=${TEMPLATE.width}:${BOTTOM_HEIGHT}:force_original_aspect_ratio=increase,crop=${TEMPLATE.width}:${BOTTOM_HEIGHT},fps=${TEMPLATE.fps}`,
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-an",
                bottomName,
              ]);
              bottomClips.push(bottomName);
              continue;
            } catch (err) {
              // 다운로드 실패 → 썸네일 fallback
              setProgress(
                `씬 ${i + 1} · 영상 다운로드 실패 (${err instanceof Error ? err.message : "오류"}), 썸네일로 대체`,
              );
            }
          }

          // 이미지 (또는 영상 다운로드 실패 시 썸네일)
          const imgUrl = assetToImageUrl(a);
          if (!imgUrl) continue;
          setProgress(
            `씬 ${i + 1} · 이미지 ${j + 1}/${assets.length} 다운로드`,
          );
          const bytes = await downloadAndProxy(imgUrl);
          const ext =
            imgUrl.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)?.[1]?.toLowerCase() ||
            "jpg";
          const inName = `s${i}_${j}.${ext}`;
          await ffmpeg.writeFile(inName, bytes);

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
            `scale=${Math.round(TEMPLATE.width * 1.1)}:${Math.round(BOTTOM_HEIGHT * 1.1)}:force_original_aspect_ratio=increase,crop=${TEMPLATE.width}:${BOTTOM_HEIGHT},zoompan=z='min(zoom+0.0008,1.15)':d=${perAsset * TEMPLATE.fps}:s=${TEMPLATE.width}x${BOTTOM_HEIGHT}:fps=${TEMPLATE.fps}`,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-an",
            bottomName,
          ]);
          bottomClips.push(bottomName);
        }

        // 하단 클립 concat
        const bottomConcat = `bottom_${i}.mp4`;
        if (bottomClips.length === 1) {
          await ffmpeg.exec([
            "-y",
            "-i",
            bottomClips[0],
            "-c",
            "copy",
            bottomConcat,
          ]);
        } else {
          const list = bottomClips.map((n) => `file '${n}'`).join("\n");
          await ffmpeg.writeFile(`blist_${i}.txt`, list);
          await ffmpeg.exec([
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            `blist_${i}.txt`,
            "-c",
            "copy",
            bottomConcat,
          ]);
        }

        // 3) 타이틀 PNG → 비디오 클립 (씬 전체 길이)
        const titleClip = `title_${i}.mp4`;
        await ffmpeg.exec([
          "-y",
          "-loop",
          "1",
          "-framerate",
          String(TEMPLATE.fps),
          "-i",
          `title_${i}.png`,
          "-t",
          String(dur),
          "-vf",
          `scale=${TEMPLATE.width}:${TOP_HEIGHT},fps=${TEMPLATE.fps}`,
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-an",
          titleClip,
        ]);

        // 4) vstack: 타이틀(상단) + 소재(하단)
        setProgress(`씬 ${i + 1} · 합치기`);
        const sceneOut = `scene_${i}.mp4`;
        await ffmpeg.exec([
          "-y",
          "-i",
          titleClip,
          "-i",
          bottomConcat,
          "-filter_complex",
          "[0:v][1:v]vstack=inputs=2[v]",
          "-map",
          "[v]",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          sceneOut,
        ]);
        sceneClips.push(sceneOut);
      }

      // 5) 모든 씬 concat
      setProgress("전체 씬 이어붙이는 중...");
      const list = sceneClips.map((n) => `file '${n}'`).join("\n");
      await ffmpeg.writeFile("scenes.txt", list);
      await ffmpeg.exec([
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "scenes.txt",
        "-c",
        "copy",
        "concat.mp4",
      ]);

      let videoSrc = "concat.mp4";

      // 6) 오디오 mix
      const hasTts = !!ttsAudioUrl;
      const hasBgm = !!bgmAudioUrl;
      if (hasTts || hasBgm) {
        setProgress("오디오 합성 중...");
        const inputs: string[] = ["-i", videoSrc];
        const filters: string[] = [];
        let inputIdx = 1;
        if (hasTts) {
          await ffmpeg.writeFile(
            "tts.mp3",
            await downloadAndProxy(ttsAudioUrl!),
          );
          inputs.push("-i", "tts.mp3");
          filters.push(`[${inputIdx}:a]volume=${TEMPLATE.ttsVolume}[aTts]`);
          inputIdx++;
        }
        if (hasBgm) {
          await ffmpeg.writeFile(
            "bgm.mp3",
            await downloadAndProxy(bgmAudioUrl!),
          );
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

      setProgress("MP4 마무리...");
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
            씬 {generatedScenes.length}개 · 총 {totalDuration}초 ({TEMPLATE.width}×
            {TEMPLATE.height}, {TEMPLATE.fps}fps)
          </div>
        </div>
      </section>

      {/* 템플릿 에디터 */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
        <h2 className="font-semibold mb-3">🎨 템플릿 (상단 30% / 하단 70%)</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 미리보기 */}
          <div>
            <div className="text-xs text-zinc-500 mb-1">씬 1 미리보기</div>
            <canvas
              ref={previewCanvasRef}
              className="w-full max-w-[180px] aspect-[9/16] rounded border border-zinc-200 dark:border-zinc-800 bg-black"
            />
          </div>

          {/* 컨트롤 */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1">
                상단 배경색
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer border border-zinc-300 dark:border-zinc-700"
                />
                <input
                  type="text"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded px-2 py-1 text-xs font-mono"
                />
                <div className="flex gap-1">
                  {["#FFE600", "#FF3B30", "#000000", "#FFFFFF", "#0070F3"].map(
                    (c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setBgColor(c)}
                        className="w-6 h-6 rounded border border-zinc-300 dark:border-zinc-700"
                        style={{ background: c }}
                        title={c}
                      />
                    ),
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">텍스트 색</label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer border border-zinc-300 dark:border-zinc-700"
                />
                <input
                  type="text"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded px-2 py-1 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">
                폰트 크기: {fontSize}px
              </label>
              <input
                type="range"
                min={40}
                max={120}
                step={4}
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
                className="w-full accent-red-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1">
                상단 비율: {Math.round(topRatio * 100)}% / 하단{" "}
                {Math.round((1 - topRatio) * 100)}%
              </label>
              <input
                type="range"
                min={0.1}
                max={0.6}
                step={0.05}
                value={topRatio}
                onChange={(e) => setTopRatio(parseFloat(e.target.value))}
                className="w-full accent-red-500"
              />
              <div className="mt-1 flex flex-wrap gap-1">
                {[
                  { v: 0.2, label: "2:8" },
                  { v: 0.3, label: "3:7" },
                  { v: 0.4, label: "4:6" },
                  { v: 0.5, label: "5:5" },
                ].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setTopRatio(p.v)}
                    className={`text-[10px] px-2 py-0.5 rounded ${
                      Math.abs(topRatio - p.v) < 0.01
                        ? "bg-red-500 text-white"
                        : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 헤더 텍스트 (모든 씬 동일 — 주제 자동 입력) */}
        <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-3">
          <label className="block text-xs font-medium mb-1">
            상단 헤더 텍스트{" "}
            <span className="text-zinc-500">
              (모든 씬에 동일하게 표시 — 비우면 주제 사용)
            </span>
          </label>
          <input
            type="text"
            value={headerText}
            onChange={(e) => setHeaderText(e.target.value)}
            placeholder={storyTopic || "예: 왜 동그란 모양일까?"}
            className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
          />
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

      {/* 씬 편집 — 순서/길이 */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
        <h2 className="font-semibold mb-2">🎞 영상 편집</h2>
        <p className="text-xs text-zinc-500 mb-3">
          씬 순서를 바꾸거나 각 씬의 길이를 조정. 합성 시 이 설정대로 적용.
        </p>
        <ul className="space-y-2">
          {sceneOrder.map((sceneIdx, pos) => {
            const scene = generatedScenes.find((s) => s.index === sceneIdx);
            if (!scene) return null;
            const dur = sceneDurations[sceneIdx] || 10;
            const assets = selectedSceneAssets[sceneIdx] || [];
            const firstAsset = assets[0];
            const thumb = firstAsset
              ? assetToImageUrl(firstAsset)
              : "";
            return (
              <li
                key={sceneIdx}
                className="flex gap-3 items-start border border-zinc-200 dark:border-zinc-800 rounded-lg p-2"
              >
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt=""
                    className="w-12 h-20 object-cover rounded shrink-0 bg-zinc-100 dark:bg-zinc-800"
                  />
                ) : (
                  <div className="w-12 h-20 bg-zinc-100 dark:bg-zinc-800 rounded shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold">{pos + 1}.</span>
                    <span className="text-zinc-500">
                      원본 씬 {sceneIdx + 1}
                    </span>
                    <span className="text-zinc-400">·</span>
                    <span className="text-red-500">{scene.emotion}</span>
                    <span className="text-zinc-400">·</span>
                    <span className="text-zinc-500">소재 {assets.length}개</span>
                  </div>
                  <p className="text-xs text-zinc-700 dark:text-zinc-300 line-clamp-2 mt-0.5">
                    {scene.text}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="range"
                      min={3}
                      max={20}
                      step={1}
                      value={dur}
                      onChange={(e) =>
                        setSceneDuration(sceneIdx, parseInt(e.target.value, 10))
                      }
                      className="flex-1 accent-red-500"
                    />
                    <span className="text-xs font-mono w-10 text-right">
                      {dur}초
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveScene(sceneIdx, -1)}
                    disabled={pos === 0}
                    className="text-xs px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 rounded"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveScene(sceneIdx, 1)}
                    disabled={pos === sceneOrder.length - 1}
                    className="text-xs px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 rounded"
                  >
                    ↓
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 text-xs text-zinc-500">
          예상 총 길이: <b>{totalDurationCustom}초</b>
        </div>
      </section>

      {/* 로컬 미디어 캐시 */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">💾 로컬 미디어 캐시</h2>
            <p className="text-xs text-zinc-500 mt-1">
              {cacheStats
                ? `${cacheStats.count}개 항목 · ${(
                    cacheStats.totalBytes /
                    1024 /
                    1024
                  ).toFixed(1)} MB`
                : "확인 중..."}{" "}
              · 다운로드한 영상·이미지·오디오는 브라우저(IndexedDB)에 저장되어
              재합성 시 재사용됩니다.
            </p>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={refreshCacheStats}
              className="text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 px-2 py-1 rounded"
            >
              새로고침
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!confirm("로컬 캐시를 모두 삭제할까요?")) return;
                await clearAssetCache();
                await refreshCacheStats();
              }}
              className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 px-2 py-1 rounded"
            >
              비우기
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
        <h2 className="font-semibold mb-2">🎬 최종 합성</h2>
        <p className="text-xs text-zinc-500 mb-3">
          템플릿 (상단 30% 색상+텍스트 / 하단 70% 영상·이미지) 적용 →
          씬 이어붙이기 → TTS·BGM mix → MP4. 브라우저 안에서 처리.
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
