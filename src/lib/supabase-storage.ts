// Supabase Storage 헬퍼
//   - 입력 영상: subtitle-inputs 버킷 (public, Modal이 fetch함), 처리 끝나면 즉시 삭제
//   - 결과 영상: subtitle-outputs 버킷 (private, signed URL로만 접근), 24h 후 자동 삭제

import { getSupabaseServer } from "@/lib/supabase";

const INPUT_BUCKET = "subtitle-inputs";
const OUTPUT_BUCKET = "subtitle-outputs";
const OUTPUT_RETENTION_HOURS = 24;
const OUTPUT_SIGNED_URL_TTL_SEC = 60 * 60; // 1시간

/**
 * 영상을 Supabase Storage에 업로드.
 * - 경로: {jobId}.{ext}  (URL에 확장자 들어가야 Replicate 모델이 인식)
 * - 공개 URL 반환
 * - bucket이 없으면 자동 생성
 */
export async function uploadInputVideo({
  jobId,
  buffer,
  ext,
  contentType,
}: {
  jobId: string;
  buffer: Buffer;
  ext: string;
  contentType: string;
}): Promise<{ path: string; publicUrl: string }> {
  const sb = getSupabaseServer();

  // bucket 보장 (멱등)
  await ensureBucket();

  const safeExt = ext.replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "mp4";
  const path = `${jobId}.${safeExt}`;

  const { error: upErr } = await sb.storage
    .from(INPUT_BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: true,
      cacheControl: "60",
    });
  if (upErr) {
    throw new Error(`Supabase 업로드 실패: ${upErr.message}`);
  }

  const { data: pub } = sb.storage.from(INPUT_BUCKET).getPublicUrl(path);
  return { path, publicUrl: pub.publicUrl };
}

/** storage path → 공개 URL 재구성 (DB에 path만 저장하고 URL은 재계산) */
export function inputVideoPublicUrl(path: string): string {
  const sb = getSupabaseServer();
  const { data } = sb.storage.from(INPUT_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** 처리 끝난 입력 영상 자동 삭제 */
export async function deleteInputVideo(path: string): Promise<boolean> {
  if (!path) return false;
  const sb = getSupabaseServer();
  const { error } = await sb.storage.from(INPUT_BUCKET).remove([path]);
  if (error) {
    console.error(
      "[supabase-storage] deleteInputVideo 실패:",
      error.message,
    );
    return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────
// 결과 영상 (output) — 처리 끝난 영상을 24h 임시 보관
// ────────────────────────────────────────────────────────────────────

export const OUTPUT_RETENTION = OUTPUT_RETENTION_HOURS;

/**
 * 결과 영상을 subtitle-outputs 버킷에 업로드.
 * Returns: { path, expiresAt }
 */
export async function uploadOutputVideo({
  jobId,
  buffer,
}: {
  jobId: string;
  buffer: Buffer;
}): Promise<{ path: string; expiresAt: Date }> {
  const sb = getSupabaseServer();
  await ensureOutputBucket();

  const path = `${jobId}.mp4`;
  const { error } = await sb.storage
    .from(OUTPUT_BUCKET)
    .upload(path, buffer, {
      contentType: "video/mp4",
      upsert: true,
      cacheControl: "3600",
    });
  if (error) {
    throw new Error(`결과 영상 업로드 실패: ${error.message}`);
  }

  const expiresAt = new Date(
    Date.now() + OUTPUT_RETENTION_HOURS * 60 * 60 * 1000,
  );
  return { path, expiresAt };
}

/** 다운로드용 signed URL (private 버킷이라 필수). 1시간 유효. */
export async function getOutputSignedUrl(
  path: string,
  options?: { download?: boolean; filename?: string },
): Promise<string> {
  const sb = getSupabaseServer();
  const { data, error } = await sb.storage
    .from(OUTPUT_BUCKET)
    .createSignedUrl(path, OUTPUT_SIGNED_URL_TTL_SEC, {
      download: options?.download ? options?.filename || true : false,
    });
  if (error || !data?.signedUrl) {
    throw new Error(`signed URL 발급 실패: ${error?.message || "unknown"}`);
  }
  return data.signedUrl;
}

/** 결과 영상 삭제 (cron 자동 청소 or 수동 삭제) */
export async function deleteOutputVideo(path: string): Promise<boolean> {
  if (!path) return false;
  const sb = getSupabaseServer();
  const { error } = await sb.storage.from(OUTPUT_BUCKET).remove([path]);
  if (error) {
    console.error(
      "[supabase-storage] deleteOutputVideo 실패:",
      error.message,
    );
    return false;
  }
  return true;
}

/** 만료된 결과 영상 일괄 삭제 (cron용) */
export async function bulkDeleteOutputs(paths: string[]): Promise<number> {
  if (paths.length === 0) return 0;
  const sb = getSupabaseServer();
  // Supabase remove는 100개씩 권장
  const batches: string[][] = [];
  for (let i = 0; i < paths.length; i += 100) {
    batches.push(paths.slice(i, i + 100));
  }
  let deleted = 0;
  for (const batch of batches) {
    const { error, data } = await sb.storage
      .from(OUTPUT_BUCKET)
      .remove(batch);
    if (!error) deleted += (data || []).length;
  }
  return deleted;
}

let outputBucketEnsured = false;
async function ensureOutputBucket(): Promise<void> {
  if (outputBucketEnsured) return;
  const sb = getSupabaseServer();
  try {
    const { error } = await sb.storage.createBucket(OUTPUT_BUCKET, {
      public: false,
      fileSizeLimit: 500 * 1024 * 1024,
    });
    if (error && !/already exists|Duplicate/i.test(error.message)) {
      throw error;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already exists|Duplicate/i.test(msg)) throw e;
  }
  outputBucketEnsured = true;
}

// ────────────────────────────────────────────────────────────────────
// 인스타 분석 영상 (insta-videos) — Gemini 분석용으로 다운받은 영상
//   - 24h 임시 보관 (cron이 자동 삭제)
//   - private 버킷 (signed URL로만 접근)
// ────────────────────────────────────────────────────────────────────

const INSTA_VIDEO_BUCKET = "insta-videos";
const INSTA_VIDEO_RETENTION_HOURS = 24;
export const INSTA_VIDEO_RETENTION = INSTA_VIDEO_RETENTION_HOURS;

export async function uploadInstaVideo({
  shortcode,
  buffer,
  contentType,
}: {
  shortcode: string;
  buffer: Buffer;
  contentType: string;
}): Promise<{ path: string; expiresAt: Date }> {
  const sb = getSupabaseServer();
  await ensureInstaVideoBucket();

  // content-type → 확장자 결정 (없으면 mp4)
  const ext =
    contentType.includes("webm")
      ? "webm"
      : contentType.includes("quicktime") || contentType.includes("mov")
        ? "mov"
        : "mp4";
  const path = `${shortcode}.${ext}`;

  const { error } = await sb.storage
    .from(INSTA_VIDEO_BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: true,
      cacheControl: "3600",
    });
  if (error) {
    throw new Error(`인스타 영상 업로드 실패: ${error.message}`);
  }

  const expiresAt = new Date(
    Date.now() + INSTA_VIDEO_RETENTION_HOURS * 60 * 60 * 1000,
  );
  return { path, expiresAt };
}

/** 다운로드용 signed URL (10분) */
export async function getInstaVideoSignedUrl(path: string): Promise<string> {
  const sb = getSupabaseServer();
  const { data, error } = await sb.storage
    .from(INSTA_VIDEO_BUCKET)
    .createSignedUrl(path, 600);
  if (error || !data?.signedUrl) {
    throw new Error(`signed URL 발급 실패: ${error?.message || "unknown"}`);
  }
  return data.signedUrl;
}

export async function bulkDeleteInstaVideos(paths: string[]): Promise<number> {
  if (paths.length === 0) return 0;
  const sb = getSupabaseServer();
  const batches: string[][] = [];
  for (let i = 0; i < paths.length; i += 100) {
    batches.push(paths.slice(i, i + 100));
  }
  let deleted = 0;
  for (const batch of batches) {
    const { error, data } = await sb.storage
      .from(INSTA_VIDEO_BUCKET)
      .remove(batch);
    if (!error) deleted += (data || []).length;
  }
  return deleted;
}

let instaVideoBucketEnsured = false;
async function ensureInstaVideoBucket(): Promise<void> {
  if (instaVideoBucketEnsured) return;
  const sb = getSupabaseServer();
  try {
    const { error } = await sb.storage.createBucket(INSTA_VIDEO_BUCKET, {
      public: false,
      fileSizeLimit: 100 * 1024 * 1024, // 100MB
    });
    if (error && !/already exists|Duplicate/i.test(error.message)) {
      throw error;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already exists|Duplicate/i.test(msg)) throw e;
  }
  instaVideoBucketEnsured = true;
}

let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const sb = getSupabaseServer();
  // 이미 있으면 createBucket이 에러를 던지므로 try/catch
  try {
    const { error } = await sb.storage.createBucket(INPUT_BUCKET, {
      public: true,
      fileSizeLimit: 250 * 1024 * 1024, // 250MB
    });
    if (error && !/already exists|Duplicate/i.test(error.message)) {
      throw error;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already exists|Duplicate/i.test(msg)) {
      throw e;
    }
  }
  bucketEnsured = true;
}
