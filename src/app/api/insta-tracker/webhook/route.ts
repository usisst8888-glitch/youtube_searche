import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { getDatasetItems, getRunStatus } from "@/lib/apify";
import { persistPosts, cleanupOldPosts } from "@/lib/insta-tracker";

export const runtime = "nodejs";
export const maxDuration = 60;

// Apify가 POST 호출 — body 형태:
//   {
//     userId, createdAt,
//     eventType: "ACTOR.RUN.SUCCEEDED",
//     eventData: { actorId, actorRunId, ... },
//     resource: { id, actId, status, defaultDatasetId, ... }
//   }
// 우리는 query에 runRecordId 미리 넣어둠 (check-feeds에서 webhook URL 만들 때)

export async function POST(req: NextRequest) {
  try {
    const runRecordId = req.nextUrl.searchParams.get("runRecordId");
    if (!runRecordId) {
      return NextResponse.json(
        { error: "runRecordId query가 없어요." },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const eventType: string = body?.eventType || "";
    const resource = body?.resource || {};
    const apifyRunId: string = resource?.id || body?.eventData?.actorRunId;
    const datasetId: string =
      resource?.defaultDatasetId || body?.eventData?.defaultDatasetId;

    const sb = getSupabaseServer();

    if (eventType !== "ACTOR.RUN.SUCCEEDED") {
      await sb
        .from("ig_check_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          error: `Apify run ${eventType}`,
        })
        .eq("id", runRecordId);
      return NextResponse.json({ ok: true, ignored: eventType });
    }

    if (!datasetId) {
      // 만약 webhook에 datasetId 없으면 Apify에 한 번 더 물어봄
      if (apifyRunId) {
        const info = await getRunStatus(apifyRunId);
        if (info.defaultDatasetId) {
          const posts = await getDatasetItems(info.defaultDatasetId);
          const result = await persistPosts(posts, runRecordId);
          const cleanup = await cleanupOldPosts();
          await sb
            .from("ig_check_runs")
            .update({ finished_at: new Date().toISOString(), status: "done" })
            .eq("id", runRecordId);
          return NextResponse.json({
            ok: true,
            ...result,
            deleted: cleanup.deleted,
          });
        }
      }
      await sb
        .from("ig_check_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          error: "datasetId 없음",
        })
        .eq("id", runRecordId);
      return NextResponse.json(
        { error: "datasetId 없음" },
        { status: 500 },
      );
    }

    const posts = await getDatasetItems(datasetId);
    const result = await persistPosts(posts, runRecordId);
    const cleanup = await cleanupOldPosts();
    await sb
      .from("ig_check_runs")
      .update({ finished_at: new Date().toISOString(), status: "done" })
      .eq("id", runRecordId);

    return NextResponse.json({
      ok: true,
      ...result,
      deleted: cleanup.deleted,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
