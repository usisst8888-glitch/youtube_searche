// Modal 상태 폴링 + 완료 시 결과를 Supabase Storage에 24h 임시 보관.
// 로컬 디스크 사용 안 함 (Vercel 호환).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import {
  deleteInputVideo,
  uploadOutputVideo,
} from "@/lib/supabase-storage";
import { getModalJobStatus, fetchModalResult } from "@/lib/modal-client";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseServer();
    const jobIdParam = req.nextUrl.searchParams.get("jobId");
    const predictionIdParam = req.nextUrl.searchParams.get("id");

    let job: Record<string, unknown> | null = null;
    if (jobIdParam) {
      const { data } = await sb
        .from("subtitle_erase_jobs")
        .select("*")
        .eq("id", jobIdParam)
        .single();
      job = data;
    } else if (predictionIdParam) {
      const { data } = await sb
        .from("subtitle_erase_jobs")
        .select("*")
        .eq("prediction_id", predictionIdParam)
        .single();
      job = data;
    }
    if (!job) {
      return NextResponse.json({ error: "job 없음" }, { status: 404 });
    }

    const jobId = job.id as string;
    const modalJobId = job.prediction_id as string | null;

    // 이미 완료된 job — output_storage_path 있고 만료 안 됨
    if (job.status === "succeeded" && job.output_storage_path) {
      const expiresAt = job.output_expires_at
        ? new Date(job.output_expires_at as string)
        : null;
      if (!expiresAt || expiresAt.getTime() > Date.now()) {
        return NextResponse.json(serializeJob(job));
      }
      // 만료됐으면 expired 상태로 응답
      return NextResponse.json({
        ...serializeJob(job),
        status: "expired",
      });
    }
    if (job.status === "failed" || job.status === "canceled") {
      return NextResponse.json(serializeJob(job));
    }
    if (!modalJobId) {
      return NextResponse.json(
        { ...serializeJob(job), error: "Modal job_id 없음" },
        { status: 500 },
      );
    }

    // Modal 상태 조회
    const modalStatus = await getModalJobStatus(modalJobId);

    // 입력 영상 자동 삭제 헬퍼
    async function cleanupInput() {
      const path = job?.input_storage_path as string | undefined;
      if (!path) return;
      await deleteInputVideo(path);
      await sb
        .from("subtitle_erase_jobs")
        .update({ input_storage_path: null })
        .eq("id", jobId);
    }

    if (modalStatus.status === "running") {
      return NextResponse.json({
        ...serializeJob(job),
        status: "processing",
      });
    }

    if (modalStatus.status === "failed" || modalStatus.status === "expired") {
      await sb
        .from("subtitle_erase_jobs")
        .update({
          status: "failed",
          error: modalStatus.error || `Modal ${modalStatus.status}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      await cleanupInput();
      const { data: updated } = await sb
        .from("subtitle_erase_jobs")
        .select("*")
        .eq("id", jobId)
        .single();
      return NextResponse.json(serializeJob(updated || job));
    }

    // status === "done" → Modal 결과 다운로드 + Supabase에 업로드 (멱등)
    if (!job.output_storage_path) {
      try {
        const resultBuf = await fetchModalResult(modalJobId);
        const { path: outputPath, expiresAt } = await uploadOutputVideo({
          jobId,
          buffer: resultBuf,
        });
        await sb
          .from("subtitle_erase_jobs")
          .update({
            status: "succeeded",
            output_storage_path: outputPath,
            output_storage_size_bytes: resultBuf.byteLength,
            output_expires_at: expiresAt.toISOString(),
            output_extension: "mp4",
            completed_at: new Date().toISOString(),
            saved_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      } catch (e) {
        await sb
          .from("subtitle_erase_jobs")
          .update({
            status: "succeeded",
            error: `결과 저장 실패: ${e instanceof Error ? e.message : "unknown"}`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }
    }

    await cleanupInput();

    const { data: finalRow } = await sb
      .from("subtitle_erase_jobs")
      .select("*")
      .eq("id", jobId)
      .single();
    return NextResponse.json(serializeJob(finalRow || job));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}

function serializeJob(row: Record<string, unknown>) {
  const expiresAt = row.output_expires_at as string | null;
  const isExpired = expiresAt
    ? new Date(expiresAt).getTime() <= Date.now()
    : false;
  return {
    jobId: row.id,
    predictionId: row.prediction_id,
    status: row.status,
    originalFilename: row.original_filename,
    error: row.error,
    detection: row.detection,
    videoMeta: row.video_meta,
    predictTimeSec: row.predict_time_sec,
    // file/{id} 라우트가 signed URL로 redirect — 만료 안 된 경우만
    fileUrl:
      row.output_storage_path && !isExpired
        ? `/api/erase-subtitle/file/${row.id}`
        : null,
    fileSize: row.output_storage_size_bytes,
    expiresAt: expiresAt,
    isExpired,
    completedAt: row.completed_at,
    savedAt: row.saved_at,
  };
}
