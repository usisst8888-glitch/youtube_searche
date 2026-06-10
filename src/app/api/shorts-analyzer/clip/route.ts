// 단일 핫존 컷 다운로드 라우트.
//
// POST /api/shorts-analyzer/clip
//   body: { url, videoId, startSec, endSec, label? }
// 응답: video/mp4 스트림 (브라우저가 다운로드 폴더에 자동 저장)

import { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";

import { getDefaultDataDir } from "@/lib/shorts-analyzer/collector";
import { ensureSourceVideo, extractClip, safeFileName } from "@/lib/shorts-analyzer/clipper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

type Body = {
  url?: string;
  videoId?: string;
  startSec?: number;
  endSec?: number;
  label?: string;
};

export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  const { url, videoId, startSec, endSec, label } = body;

  if (!url || !videoId || typeof startSec !== "number" || typeof endSec !== "number") {
    return new Response("missing fields", { status: 400 });
  }
  if (!/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(url)) {
    return new Response("invalid youtube url", { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    return new Response("invalid videoId", { status: 400 });
  }
  if (endSec - startSec < 1 || endSec - startSec > 300) {
    return new Response("clip length out of range (1~300s)", { status: 400 });
  }

  const dataDir = getDefaultDataDir();
  try {
    const sourcePath = await ensureSourceVideo(url, videoId, dataDir);
    const baseName = `${videoId}_${Math.round(startSec)}-${Math.round(endSec)}${label ? "_" + safeFileName(label) : ""}.mp4`;
    const outPath = path.join(dataDir, videoId, "clips", baseName);
    await extractClip(sourcePath, startSec, endSec, outPath);

    // HTTP 헤더는 ASCII만 허용. 한글 포함 시 RFC 6266 형식 사용.
    const asciiName = baseName.replace(/[^\x20-\x7E]/g, "_");
    const encodedName = encodeURIComponent(baseName);
    const buffer = await fs.readFile(outPath);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[clip] error:", e);
    return Response.json(
      { error: (e as Error).message || String(e) },
      { status: 500 },
    );
  }
}
