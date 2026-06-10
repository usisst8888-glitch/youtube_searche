// 영상 다운로드(yt-dlp) + 컷 추출(ffmpeg).
//
// 영상은 워크 디렉토리에 캐시되어 동일 videoId의 후속 컷 요청은 인코딩만 수행.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function runProc(
  cmd: string,
  args: string[],
  onLog?: (m: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = "";
    p.stdout.on("data", (d) => onLog?.(d.toString().trim()));
    p.stderr.on("data", (d) => {
      const s = d.toString();
      err += s;
      onLog?.(s.trim());
    });
    p.on("error", (e) => reject(new Error(`${cmd} 실행 실패: ${e.message}`)));
    p.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} exit ${code}: ${err.slice(-500)}`)),
    );
  });
}

/** 원본 영상을 720p mp4로 다운받아 캐시. 이미 있으면 그 경로를 반환. */
export async function ensureSourceVideo(
  url: string,
  videoId: string,
  dataDir: string,
  onLog?: (m: string) => void,
): Promise<string> {
  const workDir = path.join(dataDir, videoId);
  await fs.mkdir(workDir, { recursive: true });

  const files = await fs.readdir(workDir).catch(() => [] as string[]);
  const existing = files.find(
    (f) =>
      f.startsWith("source.") &&
      (f.endsWith(".mp4") || f.endsWith(".mkv") || f.endsWith(".webm")),
  );
  if (existing) {
    return path.join(workDir, existing);
  }

  onLog?.("원본 영상 다운로드 시작 (720p mp4)…");
  await runProc(
    "yt-dlp",
    [
      "-f",
      "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]",
      "--merge-output-format",
      "mp4",
      "--no-warnings",
      "-o",
      "source.%(ext)s",
      "-P",
      workDir,
      url,
    ],
    onLog,
  );

  const files2 = await fs.readdir(workDir);
  const downloaded = files2.find((f) => f.startsWith("source."));
  if (!downloaded) throw new Error("영상 다운로드 후 파일을 찾지 못함");
  return path.join(workDir, downloaded);
}

/** ffmpeg로 [startSec, endSec] 구간을 재인코딩해서 outPath에 저장. */
export async function extractClip(
  sourcePath: string,
  startSec: number,
  endSec: number,
  outPath: string,
  onLog?: (m: string) => void,
): Promise<string> {
  if (endSec <= startSec) throw new Error(`잘못된 컷 범위: ${startSec}~${endSec}`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  // input seek + 정확한 시작점 보정.
  await runProc(
    "ffmpeg",
    [
      "-y",
      "-ss", String(Math.max(0, startSec - 2)),
      "-i", sourcePath,
      "-ss", String(Math.min(2, startSec)),
      "-to", String(endSec - Math.max(0, startSec - 2)),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "22",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outPath,
    ],
    onLog,
  );
  return outPath;
}

export function safeFileName(s: string): string {
  return s.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80);
}
