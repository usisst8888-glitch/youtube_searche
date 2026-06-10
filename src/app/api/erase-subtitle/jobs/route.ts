import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { deleteOutputVideo, deleteInputVideo } from "@/lib/supabase-storage";

export const runtime = "nodejs";

// ── GET: 작업 히스토리 (최신순) ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(
      parseInt(req.nextUrl.searchParams.get("limit") || "30", 10),
      200,
    );
    const sb = getSupabaseServer();
    const { data, error } = await sb
      .from("subtitle_erase_jobs")
      .select(
        "id, prediction_id, status, original_filename, original_size_bytes, error, detection, video_meta, predict_time_sec, output_storage_path, output_storage_size_bytes, output_expires_at, output_extension, created_at, completed_at, saved_at",
      )
      .neq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      jobs: (data || []).map((j: Record<string, unknown>) => {
        const expiresAt = j.output_expires_at as string | null;
        const isExpired = expiresAt
          ? new Date(expiresAt).getTime() <= Date.now()
          : !j.output_storage_path;
        return {
          jobId: j.id,
          predictionId: j.prediction_id,
          status: j.status,
          originalFilename: j.original_filename,
          originalSize: j.original_size_bytes,
          error: j.error,
          detection: j.detection,
          videoMeta: j.video_meta,
          predictTimeSec: j.predict_time_sec,
          fileUrl:
            j.output_storage_path && !isExpired
              ? `/api/erase-subtitle/file/${j.id}`
              : null,
          fileSize: j.output_storage_size_bytes,
          expiresAt,
          isExpired,
          createdAt: j.created_at,
          completedAt: j.completed_at,
          savedAt: j.saved_at,
        };
      }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}

// ── DELETE: 작업 삭제 (Storage 파일 + DB row) ──────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "id 쿼리가 필요해요." },
        { status: 400 },
      );
    }
    const sb = getSupabaseServer();
    const { data: row } = await sb
      .from("subtitle_erase_jobs")
      .select("output_storage_path, input_storage_path")
      .eq("id", id)
      .single();

    // Supabase Storage 정리
    if (row?.output_storage_path) {
      await deleteOutputVideo(row.output_storage_path as string);
    }
    if (row?.input_storage_path) {
      await deleteInputVideo(row.input_storage_path as string);
    }

    const { error } = await sb
      .from("subtitle_erase_jobs")
      .delete()
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
