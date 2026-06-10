// Vercel Cron — 매일 결과 영상 자동 청소
// 24h 지난 (output_expires_at <= now) 영상을 Supabase Storage에서 삭제 + DB row에는 만료 표시

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { bulkDeleteOutputs } from "@/lib/supabase-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel cron 보안 — CRON_SECRET 필수
  const auth = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = getSupabaseServer();
    const nowIso = new Date().toISOString();

    // 만료된 row 찾기 (output_storage_path 아직 있는 것만)
    const { data: expired, error } = await sb
      .from("subtitle_erase_jobs")
      .select("id, output_storage_path")
      .lte("output_expires_at", nowIso)
      .not("output_storage_path", "is", null)
      .limit(500); // 한 번에 너무 많이 처리 안 하게

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!expired || expired.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0, message: "만료된 파일 없음" });
    }

    const paths = expired
      .map((r) => r.output_storage_path as string)
      .filter(Boolean);
    const ids = expired.map((r) => r.id as string);

    // Supabase Storage에서 일괄 삭제
    const deleted = await bulkDeleteOutputs(paths);

    // DB row의 output_storage_path를 null로 마킹 (만료 표시)
    if (ids.length > 0) {
      await sb
        .from("subtitle_erase_jobs")
        .update({ output_storage_path: null })
        .in("id", ids);
    }

    return NextResponse.json({
      ok: true,
      considered: expired.length,
      deleted,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
