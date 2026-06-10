import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { cleanupOldPosts, HOURS_WINDOW } from "@/lib/insta-tracker";

export const runtime = "nodejs";

// 대시보드 — 최근 24시간 이내 발견된 포스트 리스트
// query:
//   ?hours=24               (윈도우, 기본 HOURS_WINDOW=24)
//   ?sort=first_seen|posted|views|likes  (기본: first_seen)
//   ?type=reel|carousel|all (기본: all)
//   ?username=...           (선택, 특정 프로필만)
//   ?limit=200              (기본 200)

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const hours = parseInt(
      params.get("hours") || String(HOURS_WINDOW),
      10,
    );
    const sort = params.get("sort") || "first_seen";
    const type = params.get("type") || "all";
    const username = params.get("username");
    const limit = Math.min(parseInt(params.get("limit") || "200", 10), 500);

    // lazy cleanup — 대시보드 볼 때마다 24h 지난 거 자동 정리 (fire & forget 느낌)
    await cleanupOldPosts();

    const cutoff = new Date(
      Date.now() - hours * 60 * 60 * 1000,
    ).toISOString();

    const sb = getSupabaseServer();
    let q = sb.from("ig_posts").select("*").gte("posted_at", cutoff);
    if (username) q = q.eq("username", username.toLowerCase());
    if (type !== "all") q = q.eq("post_type", type);

    const sortCol =
      sort === "posted"
        ? "posted_at"
        : sort === "views"
          ? "view_count"
          : sort === "likes"
            ? "like_count"
            : "first_seen_at";
    q = q.order(sortCol, { ascending: false, nullsFirst: false }).limit(limit);

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 최근 run 정보
    const { data: lastRun } = await sb
      .from("ig_check_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      posts: data || [],
      lastRun: lastRun || null,
      window: { hours, cutoff },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
