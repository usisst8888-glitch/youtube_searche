// Vercel Cron — 24h 지난 인스타 분석 영상 자동 청소
// video_expires_at <= now 인 row의 video_storage_path를 Storage에서 삭제 + path/expires 컬럼 null로 마킹
// 분석 결과 텍스트(transcript, title, scenes, keywords)는 계속 남음 — 영상 파일만 만료

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { bulkDeleteInstaVideos } from "@/lib/supabase-storage";

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

    const { data: expired, error } = await sb
      .from("ig_post_analyses")
      .select("shortcode, video_storage_path")
      .lte("video_expires_at", nowIso)
      .not("video_storage_path", "is", null)
      .limit(500);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!expired || expired.length === 0) {
      return NextResponse.json({
        ok: true,
        deleted: 0,
        message: "만료된 인스타 영상 없음",
      });
    }

    const paths = expired
      .map((r) => r.video_storage_path as string)
      .filter(Boolean);
    const shortcodes = expired.map((r) => r.shortcode as string);

    const deleted = await bulkDeleteInstaVideos(paths);

    // DB row의 video_storage_path / video_expires_at null로 마킹
    if (shortcodes.length > 0) {
      await sb
        .from("ig_post_analyses")
        .update({
          video_storage_path: null,
          video_expires_at: null,
        })
        .in("shortcode", shortcodes);
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
