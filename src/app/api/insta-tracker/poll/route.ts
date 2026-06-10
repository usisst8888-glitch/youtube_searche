import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { getDatasetItems, getRunStatus } from "@/lib/apify";
import { persistPosts, cleanupOldPosts } from "@/lib/insta-tracker";

export const runtime = "nodejs";
export const maxDuration = 60;

// 로컬 환경 / webhook 없이 쓸 때 — UI가 주기적으로 호출해서 결과 받아옴
// query: ?runId=<our ig_check_runs.id>

export async function GET(req: NextRequest) {
  try {
    const runId = req.nextUrl.searchParams.get("runId");
    if (!runId) {
      return NextResponse.json(
        { error: "runId query가 없어요." },
        { status: 400 },
      );
    }

    const sb = getSupabaseServer();
    const { data: runRow, error } = await sb
      .from("ig_check_runs")
      .select("*")
      .eq("id", runId)
      .single();
    if (error || !runRow) {
      return NextResponse.json(
        { error: error?.message || "run을 찾지 못했어요." },
        { status: 404 },
      );
    }

    // 이미 완료된 run
    if (runRow.status === "done" || runRow.status === "failed") {
      return NextResponse.json({
        status: runRow.status,
        savedPostCount: runRow.saved_post_count,
        newPostCount: runRow.new_post_count,
        fetchedPostCount: runRow.fetched_post_count,
        error: runRow.error,
      });
    }

    if (!runRow.apify_run_id) {
      return NextResponse.json({ status: runRow.status, pending: true });
    }

    const info = await getRunStatus(runRow.apify_run_id);

    if (
      info.status === "RUNNING" ||
      info.status === "READY" ||
      info.status === "TIMING-OUT"
    ) {
      return NextResponse.json({ status: "running", apifyStatus: info.status });
    }

    if (info.status !== "SUCCEEDED") {
      await sb
        .from("ig_check_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          error: `Apify ${info.status}`,
        })
        .eq("id", runId);
      return NextResponse.json({
        status: "failed",
        apifyStatus: info.status,
      });
    }

    // SUCCEEDED — 결과 fetch + DB 저장
    if (!info.defaultDatasetId) {
      await sb
        .from("ig_check_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          error: "Apify defaultDatasetId 없음",
        })
        .eq("id", runId);
      return NextResponse.json(
        { status: "failed", error: "datasetId 없음" },
        { status: 500 },
      );
    }

    const posts = await getDatasetItems(info.defaultDatasetId);
    const result = await persistPosts(posts, runId);
    const cleanup = await cleanupOldPosts();
    await sb
      .from("ig_check_runs")
      .update({ finished_at: new Date().toISOString(), status: "done" })
      .eq("id", runId);

    return NextResponse.json({
      status: "done",
      savedPostCount: result.saved,
      newPostCount: result.newSeen,
      skippedOld: result.skippedOld,
      fetchedPostCount: posts.length,
      deletedOldPostCount: cleanup.deleted,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
