// 저장된 인스타 영상 분석 목록 — "내 분석" 탭에서 사용
// query:
//   ?limit=50          (기본 50, 최대 200)
//   ?offset=0
//   ?q=검색어          (title/transcript/source_url에 like)

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const limit = Math.min(parseInt(params.get("limit") || "50", 10), 200);
    const offset = parseInt(params.get("offset") || "0", 10);
    const q = params.get("q")?.trim();

    const sb = getSupabaseServer();
    let query = sb
      .from("ig_post_analyses")
      .select(
        "shortcode, source_url, video_url, video_storage_path, video_expires_at, title, video_summary, product_keywords, model, analyzed_at",
        { count: "exact" },
      );

    if (q) {
      // ilike — title 또는 source_url 또는 video_summary 부분 일치
      query = query.or(
        `title.ilike.%${q}%,video_summary.ilike.%${q}%,source_url.ilike.%${q}%`,
      );
    }

    query = query
      .order("analyzed_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      analyses: data || [],
      total: count || 0,
      limit,
      offset,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 },
    );
  }
}

// DELETE ?shortcode=... — 분석 삭제 (Storage 영상도 같이)
export async function DELETE(req: NextRequest) {
  const shortcode = req.nextUrl.searchParams.get("shortcode");
  if (!shortcode) {
    return NextResponse.json(
      { error: "shortcode가 필요합니다." },
      { status: 400 },
    );
  }
  const sb = getSupabaseServer();

  // 1) Storage path 조회
  const { data: row } = await sb
    .from("ig_post_analyses")
    .select("video_storage_path")
    .eq("shortcode", shortcode)
    .maybeSingle();

  // 2) Storage 파일 삭제 (있으면)
  if (row?.video_storage_path) {
    await sb.storage
      .from("insta-videos")
      .remove([row.video_storage_path])
      .catch(() => {});
  }

  // 3) DB row 삭제
  const { error } = await sb
    .from("ig_post_analyses")
    .delete()
    .eq("shortcode", shortcode);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
