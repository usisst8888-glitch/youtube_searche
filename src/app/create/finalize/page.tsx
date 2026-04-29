"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import JSZip from "jszip";
import { fetchFile } from "@ffmpeg/util";
import { useProject, WebSceneAsset } from "../context";
import { getCachedAsset, setCachedAsset } from "@/lib/asset-cache";

// 씬 대본을 N개의 자막 청크로 자동 분할 (스크립트.txt 작성용)
function splitTextIntoChunks(text: string, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [text.trim()];
  const trimmed = text.trim();
  const sentences = trimmed
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length >= n) {
    const chunks: string[] = [];
    const perChunk = Math.ceil(sentences.length / n);
    for (let i = 0; i < n; i++) {
      const piece = sentences
        .slice(i * perChunk, (i + 1) * perChunk)
        .join(" ");
      if (piece) chunks.push(piece);
    }
    while (chunks.length < n) chunks.push("");
    return chunks.slice(0, n);
  }
  const phrases = trimmed
    .split(/(?<=[,;])\s+|\s+(?=그런데|그래서|근데|하지만|그리고|또)/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (phrases.length >= n) {
    const chunks: string[] = [];
    const perChunk = Math.ceil(phrases.length / n);
    for (let i = 0; i < n; i++) {
      const piece = phrases
        .slice(i * perChunk, (i + 1) * perChunk)
        .join(" ");
      if (piece) chunks.push(piece);
    }
    while (chunks.length < n) chunks.push("");
    return chunks.slice(0, n);
  }
  const len = Math.ceil(trimmed.length / n);
  const chunks: string[] = [];
  for (let i = 0; i < n; i++) {
    chunks.push(trimmed.slice(i * len, (i + 1) * len));
  }
  return chunks;
}

function assetToImageUrl(a: WebSceneAsset): string {
  if (a.kind === "youtube-short") return a.thumbnail;
  if (a.kind === "web-image") return a.imageUrl;
  return a.coverUrl;
}

function assetSourceLabel(a: WebSceneAsset): string {
  if (a.kind === "youtube-short") return "🎬 YouTube";
  if (a.kind === "web-image") {
    if (a.siteName === "기사 원본") return "📰 기사";
    if (a.siteName === "AI 생성") return "🎨 AI";
    return "🖼️ 웹";
  }
  return "🎵 TikTok";
}

function assetOriginalUrl(a: WebSceneAsset): string {
  if (a.kind === "youtube-short") return a.watchUrl;
  if (a.kind === "web-image") return a.sourceUrl || a.imageUrl;
  return a.watchUrl;
}

export default function FinalizePage() {
  const {
    generatedScenes,
    selectedSceneAssets,
    storyTopic,
    videoTitle,
    productName,
    clipCaptions,
    setClipCaptions,
  } = useProject();

  const [error, setError] = useState("");
  const [downloadProgress, setDownloadProgress] = useState("");

  const headerTextResolved = (videoTitle || storyTopic || "").trim();

  // 자동 자막 분할 (script.txt 채워주는 용)
  useEffect(() => {
    if (generatedScenes.length === 0) return;
    setClipCaptions((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const scene of generatedScenes) {
        const assets = selectedSceneAssets[scene.index] || [];
        if (assets.length === 0) continue;
        const existing = next[scene.index];
        if (!existing || existing.length !== assets.length) {
          next[scene.index] = splitTextIntoChunks(scene.text, assets.length);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [generatedScenes, selectedSceneAssets, setClipCaptions]);

  const totalDuration = generatedScenes.reduce(
    (s, sc) => s + (sc.durationSec || 10),
    0,
  );
  const totalClips = generatedScenes.reduce(
    (s, sc) => s + (selectedSceneAssets[sc.index] || []).length,
    0,
  );

  // === 미디어 다운로드 헬퍼 (IndexedDB 캐시 활용) ===
  const downloadAndProxy = async (url: string): Promise<Uint8Array> => {
    const cached = await getCachedAsset(url);
    if (cached) return cached.bytes;
    let bytes: Uint8Array;
    let ct = "application/octet-stream";
    try {
      const res = await fetch(
        `/api/proxy-asset?url=${encodeURIComponent(url)}`,
      );
      if (!res.ok) throw new Error("proxy fetch failed");
      ct = res.headers.get("content-type") || ct;
      const buf = await res.arrayBuffer();
      bytes = new Uint8Array(buf);
    } catch {
      const data = await fetchFile(url);
      bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    }
    void setCachedAsset(url, bytes, ct);
    return bytes;
  };

  const downloadVideoCached = async (
    videoUrl: string,
  ): Promise<Uint8Array> => {
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
    return bytes;
  };

  // 대본 한 줄로 — 씬 텍스트만 이어붙임 (TTS 입력용)
  const buildPlainScript = (): string => {
    return generatedScenes
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join(" ");
  };

  // === 대본 + 메타 상세 텍스트 (zip 루트에 들어감) ===
  const buildScriptText = (): string => {
    const lines: string[] = [];
    lines.push("=".repeat(60));
    lines.push(`영상 제목: ${headerTextResolved || "(제목 없음)"}`);
    lines.push(`상품: ${productName || "—"}`);
    lines.push(`총 길이: ${totalDuration}초`);
    lines.push(`씬: ${generatedScenes.length}개 · 클립: ${totalClips}개`);
    lines.push("=".repeat(60));
    lines.push("");

    generatedScenes.forEach((scene, pos) => {
      const dur = scene.durationSec || 10;
      const assets = selectedSceneAssets[scene.index] || [];
      const captions = clipCaptions[scene.index] || [];
      const perClip = assets.length > 0 ? dur / assets.length : 0;

      lines.push(`[씬 ${pos + 1}] ${scene.emotion} · ${dur}초`);
      lines.push(`대본: ${scene.text}`);
      lines.push("");
      if (assets.length > 0) {
        lines.push(`  클립 ${assets.length}개 (각 ${perClip.toFixed(1)}초):`);
        assets.forEach((asset, idx) => {
          const kind = assetSourceLabel(asset);
          const url = assetOriginalUrl(asset);
          lines.push(`    [${idx + 1}] ${kind}`);
          lines.push(`        자막: ${captions[idx] || "(없음)"}`);
          lines.push(
            `        파일: scene-${String(pos + 1).padStart(2, "0")}/clip-${String(idx + 1).padStart(2, "0")}`,
          );
          if (url) lines.push(`        원본: ${url}`);
        });
      }
      lines.push("");
    });

    return lines.join("\n");
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const safeFileName = (s: string, fallback: string): string => {
    const cleaned = s.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60);
    return cleaned || fallback;
  };

  const downloadScriptOnly = () => {
    // 한 줄 대본 (씬 합쳐서) — TTS / 캡컷에 그대로 붙여넣기 좋게
    const txt = buildPlainScript();
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    triggerDownload(
      blob,
      `${safeFileName(headerTextResolved, "shorts-script")}.txt`,
    );
  };

  const guessExt = (url: string): string => {
    const m = url.match(/\.(jpg|jpeg|png|webp|gif|mp4|mov|webm)(\?|$)/i);
    if (m) return m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase();
    return "jpg";
  };

  const downloadAllSources = async () => {
    setError("");
    setDownloadProgress("ZIP 만들기 시작...");
    try {
      const zip = new JSZip();

      // 1a) 한 줄 대본 (TTS/캡컷에 바로 붙여넣기 용)
      zip.file("script.txt", buildPlainScript());
      // 1b) 상세 메타 (제목/씬별 클립 정보/원본 URL)
      zip.file("script-detail.txt", buildScriptText());

      // 2) 씬별 클립 + 씬 대본 파일
      for (let pos = 0; pos < generatedScenes.length; pos++) {
        const scene = generatedScenes[pos];
        const assets = selectedSceneAssets[scene.index] || [];
        const sceneDir = `scene-${String(pos + 1).padStart(2, "0")}`;

        // 씬별 대본 한 줄 — TTS / 캡컷에 바로 붙여넣기 용
        zip.file(`${sceneDir}/script.txt`, scene.text.trim());

        if (assets.length === 0) continue;

        for (let j = 0; j < assets.length; j++) {
          const a = assets[j];
          const clipPrefix = `clip-${String(j + 1).padStart(2, "0")}`;
          setDownloadProgress(
            `씬 ${pos + 1}/${generatedScenes.length} · 클립 ${j + 1}/${assets.length} 다운로드`,
          );
          try {
            if (a.kind === "youtube-short") {
              const bytes = await downloadVideoCached(a.watchUrl);
              zip.file(`${sceneDir}/${clipPrefix}.mp4`, bytes);
            } else if (a.kind === "web-image") {
              if (a.imageUrl.startsWith("data:")) {
                // AI 생성 dataUrl
                const m = a.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
                if (m) {
                  const ct = m[1];
                  const ext = ct.includes("png")
                    ? "png"
                    : ct.includes("webp")
                      ? "webp"
                      : "jpg";
                  const bin = Uint8Array.from(atob(m[2]), (c) =>
                    c.charCodeAt(0),
                  );
                  zip.file(`${sceneDir}/${clipPrefix}-AI.${ext}`, bin);
                }
              } else {
                const bytes = await downloadAndProxy(a.imageUrl);
                const ext = guessExt(a.imageUrl);
                zip.file(`${sceneDir}/${clipPrefix}.${ext}`, bytes);
              }
            } else if (a.kind === "tiktok") {
              const url = a.playUrl || a.watchUrl;
              const bytes = await downloadAndProxy(url);
              zip.file(`${sceneDir}/${clipPrefix}.mp4`, bytes);
            }
          } catch (e) {
            zip.file(
              `${sceneDir}/${clipPrefix}-FAILED.txt`,
              `다운로드 실패: ${e instanceof Error ? e.message : "오류"}\n원본 URL: ${assetOriginalUrl(a)}`,
            );
          }
        }
      }

      setDownloadProgress("ZIP 압축 중...");
      const blob = await zip.generateAsync(
        { type: "blob", compression: "STORE" },
        (meta) => {
          setDownloadProgress(`ZIP 압축 ${meta.percent.toFixed(0)}%`);
        },
      );
      triggerDownload(
        blob,
        `${safeFileName(headerTextResolved, "shorts-sources")}.zip`,
      );
      setDownloadProgress("✅ 다운로드 완료");
    } catch (e) {
      setError(e instanceof Error ? e.message : "다운로드 실패");
      setDownloadProgress("");
    }
  };

  // === 미리보기 ===
  if (generatedScenes.length === 0) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-300 dark:border-yellow-800 rounded-xl p-8 text-center">
        <h2 className="font-semibold mb-2">대본이 없습니다</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
          먼저 분석 페이지에서 대본을 생성하고 컷을 구성해주세요.
        </p>
        <Link
          href="/create/analyze"
          className="inline-block bg-red-500 hover:bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          ← 분석 페이지로
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 다운로드 — 핵심 액션 */}
      <section className="bg-gradient-to-br from-emerald-50 to-sky-50 dark:from-emerald-950/20 dark:to-sky-950/20 border border-emerald-300 dark:border-emerald-900/50 rounded-xl p-6">
        <h2 className="font-semibold mb-2 text-lg">
          📥 대본 + 소스 다운로드
        </h2>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-4">
          영상 편집은 CapCut · Premiere Pro · DaVinci Resolve 같은 외부
          편집기에서 진행하세요. ZIP 안에:
        </p>
        <ul className="text-xs text-zinc-600 dark:text-zinc-400 mb-4 list-disc list-inside space-y-0.5">
          <li>
            <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
              script.txt
            </code>{" "}
            — 전체 대본 한 줄 (TTS/캡컷에 그대로 붙여넣기)
          </li>
          <li>
            <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
              script-detail.txt
            </code>{" "}
            — 영상 제목·씬별 클립 정보·원본 URL (참고용)
          </li>
          <li>
            <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
              scene-01/script.txt
            </code>{" "}
            — 씬 1 대본 한 줄, 클립 미디어 (clip-01, clip-02, ...)
          </li>
          <li>
            클립 미디어: 📰 기사 사진 · 🖼️ Bing 사진 · 🎨 AI 이미지 · 🤣 짤
            (mp4/gif)
          </li>
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadScriptOnly}
            disabled={!!downloadProgress}
            className="bg-zinc-700 hover:bg-zinc-800 disabled:bg-zinc-300 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            📄 대본만 (.txt)
          </button>
          <button
            type="button"
            onClick={downloadAllSources}
            disabled={!!downloadProgress}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 text-white text-sm font-semibold px-5 py-2 rounded-lg"
          >
            📦 전체 소스 (.zip) — 추천
          </button>
          {downloadProgress && (
            <span className="text-xs text-emerald-700 dark:text-emerald-300">
              {downloadProgress}
            </span>
          )}
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            ⚠️ {error}
          </p>
        )}
      </section>

      {/* 영상 정보 요약 */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
        <h2 className="font-semibold mb-3">📋 영상 정보</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-zinc-500">영상 제목</dt>
            <dd className="font-medium">
              {headerTextResolved || "(제목 없음)"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">상품</dt>
            <dd>{productName || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">씬</dt>
            <dd>{generatedScenes.length}개</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">예상 길이</dt>
            <dd>{totalDuration}초</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">총 클립</dt>
            <dd>{totalClips}개</dd>
          </div>
        </dl>
      </section>

      {/* 씬 미리보기 — 다운로드될 내용 확인용 (편집 X) */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
        <h2 className="font-semibold mb-3">
          🎞 다운로드 미리보기 ({generatedScenes.length}개 씬)
        </h2>
        <div className="space-y-3">
          {generatedScenes.map((scene, pos) => {
            const assets = selectedSceneAssets[scene.index] || [];
            const captions = clipCaptions[scene.index] || [];
            return (
              <div
                key={scene.index}
                className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 bg-zinc-50/50 dark:bg-zinc-900/50"
              >
                <div className="flex items-center gap-2 text-xs mb-1">
                  <span className="font-bold text-sm">
                    씬 {pos + 1}
                  </span>
                  <span className="text-zinc-400">·</span>
                  <span className="text-red-500">{scene.emotion}</span>
                  <span className="text-zinc-400">·</span>
                  <span className="text-zinc-500">
                    {scene.durationSec || 10}초
                  </span>
                  <span className="text-zinc-400">·</span>
                  <span className="text-zinc-500">
                    클립 {assets.length}개
                  </span>
                </div>
                <p className="text-xs text-zinc-700 dark:text-zinc-300 mb-2 italic">
                  &ldquo;{scene.text}&rdquo;
                </p>
                {assets.length > 0 ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {assets.map((asset, idx) => {
                      const thumb = assetToImageUrl(asset);
                      return (
                        <div
                          key={`${scene.index}-${idx}`}
                          className="shrink-0 w-24 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded overflow-hidden"
                        >
                          <div className="relative w-full aspect-[9/16] bg-zinc-100 dark:bg-zinc-800">
                            {thumb && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={thumb}
                                alt=""
                                loading="lazy"
                                className="absolute inset-0 w-full h-full object-cover"
                              />
                            )}
                            <div className="absolute top-0.5 left-0.5 bg-black/70 text-white text-[8px] px-1 py-0.5 rounded font-bold">
                              {idx + 1}
                            </div>
                            <div className="absolute top-0.5 right-0.5 bg-black/70 text-white text-[8px] px-1 py-0.5 rounded">
                              {assetSourceLabel(asset)}
                            </div>
                          </div>
                          <div className="p-1 text-[9px] text-zinc-700 dark:text-zinc-300 leading-tight line-clamp-3 min-h-8">
                            {captions[idx] || "—"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400 italic">
                    클립 없음 — 분석 페이지에서 자동 컷 구성을 실행해주세요.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 네비 */}
      <div className="flex justify-between">
        <Link
          href="/create/analyze"
          className="text-sm text-zinc-500 hover:underline"
        >
          ← 이전: 분석
        </Link>
      </div>
    </div>
  );
}
