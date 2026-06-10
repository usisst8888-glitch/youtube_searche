// 영상 업로드 → Supabase Storage → Modal 호출 (Replicate 대신).
// Modal이 PaddleOCR + LaMa로 풀자동 처리 → 결과는 poll에서 받음.
//
// 1단계 라우트(prepare)도 더 이상 필요 없음. 이 라우트에 영상 올리면 끝.

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getSupabaseServer } from "@/lib/supabase";
import {
  uploadInputVideo,
  inputVideoPublicUrl,
} from "@/lib/supabase-storage";
import { startModalJob } from "@/lib/modal-client";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 200 * 1024 * 1024;
const COMPRESS_THRESHOLD = 30 * 1024 * 1024;

const execFileAsync = promisify(execFile);

// ── ffmpeg 경로 ────────────────────────────────────────────────────────
let ffmpegPath: string | null = null;
let ffprobePath: string | null = null;
async function resolveBinary(
  envVar: string,
  bin: string,
  candidates: string[],
): Promise<string> {
  if (process.env[envVar]) return process.env[envVar] as string;
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {}
  }
  return bin;
}
async function getFfmpeg() {
  if (!ffmpegPath) {
    ffmpegPath = await resolveBinary("FFMPEG_PATH", "ffmpeg", [
      "/opt/homebrew/bin/ffmpeg",
      "/usr/local/bin/ffmpeg",
      "/usr/bin/ffmpeg",
    ]);
  }
  return ffmpegPath;
}
async function getFfprobe() {
  if (!ffprobePath) {
    ffprobePath = await resolveBinary("FFPROBE_PATH", "ffprobe", [
      "/opt/homebrew/bin/ffprobe",
      "/usr/local/bin/ffprobe",
      "/usr/bin/ffprobe",
    ]);
  }
  return ffprobePath;
}

async function probeVideo(inputPath: string) {
  const ffprobe = await getFfprobe();
  const { stdout } = await execFileAsync(ffprobe, [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate:format=duration",
    "-of",
    "json",
    inputPath,
  ]);
  const j = JSON.parse(stdout);
  const rfr = (j?.streams?.[0]?.r_frame_rate as string | undefined) || "0/1";
  const [num, den] = rfr.split("/").map((s) => parseFloat(s));
  const fps = den && num ? num / den : 0;
  return {
    width: parseInt(j?.streams?.[0]?.width || "0", 10),
    height: parseInt(j?.streams?.[0]?.height || "0", 10),
    durationSec: parseFloat(j?.format?.duration || "0"),
    fps: Math.round(fps * 100) / 100,
  };
}

// ── POST ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let workDir: string | null = null;
  try {
    const form = await req.formData();
    const file = form.get("video");
    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "video 파일이 필요해요." },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `영상이 너무 커요 (>${MAX_BYTES / 1024 / 1024}MB).` },
        { status: 400 },
      );
    }

    // 1) 임시 작업폴더 + 영상 저장
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "erase-"));
    const ext = path.extname(file.name) || ".mp4";
    const inputPath = path.join(workDir, `input${ext}`);
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, buf);

    // 2) 메타데이터
    const meta = await probeVideo(inputPath);
    if (!meta.width || !meta.height) {
      return NextResponse.json(
        { error: "영상 해상도를 읽지 못했어요." },
        { status: 422 },
      );
    }

    // 3) jobId + Supabase 업로드 (필요 시 압축)
    const jobId = randomUUID();
    const extPlain = ext.replace(/^\./, "") || "mp4";

    let uploadBuf = buf;
    let uploadExt = extPlain;
    let uploadContentType = file.type || "video/mp4";
    if (buf.byteLength > COMPRESS_THRESHOLD) {
      const ffmpeg = await getFfmpeg();
      const compressedPath = path.join(workDir, "compressed.mp4");
      await execFileAsync(
        ffmpeg,
        [
          "-i",
          inputPath,
          "-c:v",
          "libx264",
          "-crf",
          "26",
          "-preset",
          "fast",
          "-c:a",
          "aac",
          "-b:a",
          "96k",
          "-movflags",
          "+faststart",
          "-y",
          compressedPath,
        ],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      uploadBuf = await fs.readFile(compressedPath);
      uploadExt = "mp4";
      uploadContentType = "video/mp4";
    }

    const { path: inputStoragePath } = await uploadInputVideo({
      jobId,
      buffer: uploadBuf,
      ext: uploadExt,
      contentType: uploadContentType,
    });

    // 4) Modal로 작업 시작
    const videoUrl = inputVideoPublicUrl(inputStoragePath);
    let modalJobId: string;
    try {
      modalJobId = await startModalJob(videoUrl);
    } catch (e) {
      return NextResponse.json(
        {
          error: `Modal 호출 실패: ${e instanceof Error ? e.message : "unknown"}. \`modal deploy\`로 함수가 배포됐는지, .env.local에 MODAL_*_URL이 설정됐는지 확인.`,
        },
        { status: 500 },
      );
    }

    // 5) DB 저장
    const sb = getSupabaseServer();
    const { error: insertErr } = await sb
      .from("subtitle_erase_jobs")
      .insert({
        id: jobId,
        prediction_id: modalJobId, // Modal job_id를 prediction_id에 저장 (호환)
        original_filename: file.name,
        original_size_bytes: file.size,
        status: "processing",
        video_meta: meta,
        input_storage_path: inputStoragePath,
        detection: { provider: "modal-paddleocr-lama" },
      });
    if (insertErr) {
      console.error("[erase-subtitle] DB insert 실패:", insertErr.message);
    }

    return NextResponse.json({
      jobId,
      predictionId: modalJobId,
      status: "processing",
      videoMeta: meta,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  } finally {
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
