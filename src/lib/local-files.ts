// 로컬 디스크에 결과 영상 저장 — Supabase Storage 안 씀
// 경로: ./data/erase-subtitle/{jobId}.{ext}

import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";

const BASE_DIR = path.join(process.cwd(), "data", "erase-subtitle");

export async function ensureBaseDir(): Promise<void> {
  await fs.mkdir(BASE_DIR, { recursive: true });
}

export function jobFilePath(jobId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "mp4";
  return path.join(BASE_DIR, `${jobId}.${safeExt}`);
}

/** URL에서 다운로드해서 로컬에 저장 */
export async function downloadToFile(
  url: string,
  filePath: string,
): Promise<{ bytes: number; contentType: string | null }> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`다운로드 실패: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(filePath, buf);
  return {
    bytes: buf.byteLength,
    contentType: res.headers.get("content-type"),
  };
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function getFileStats(
  filePath: string,
): Promise<{ size: number } | null> {
  try {
    const stat = await fs.stat(filePath);
    return { size: stat.size };
  } catch {
    return null;
  }
}

export async function deleteFile(filePath: string): Promise<boolean> {
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Web stream으로 변환 — Next.js Response에 직접 흘려보낼 때 */
export function fileToWebStream(
  filePath: string,
): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(filePath);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer | string) => {
        const u8 =
          typeof chunk === "string"
            ? new TextEncoder().encode(chunk)
            : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        controller.enqueue(u8);
      });
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

/** URL에서 ext 추출 — replicate output URL은 보통 ".mp4"로 끝남 */
export function extFromUrl(url: string, fallback = "mp4"): string {
  const m = url.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/);
  return (m?.[1] || fallback).toLowerCase();
}
